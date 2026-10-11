/* catalog.js — the «Каталог» screen: free audiobooks from the Internet Archive (its LibriVox collection: volunteer readings, public domain).
 *   - search, listen online and read the licence: free for everybody
 *   - download into a library folder: Premium (see premium-ui.js `gate('download')`)
 * The only remote host is archive.org (CSP, Android network rules). Nothing about the person is sent: just the search words.
 * A book from the catalog is an ordinary library book with `source` (where it came from, under which licence):
 *   online: true   the files are https links (streamed)
 *   online: false  downloaded: the files are in the person's folder (content://) and keep working offline, for good
 */
import { state, escapeHtml, plugin, isNative, uid, main, $ } from './state.js';
import { saveBooks } from './storage.js';
import { showToast, openModal, closeModal, bookCover, fmt, iconBtn } from './ui-utils.js';
import { header } from './header.js';
import { act } from './router.js';
import { gate } from './premium-ui.js';
import { isPremium } from './premium.js';
import { t, getLang } from './i18n.js';

const HOST = 'https://archive.org';
const PAGE = 20;
export const DL_DIR = 'AudioShelf';                       // sub-folder created inside the library folder that receives the books

/* ---------------- the Internet Archive API ---------------- */

const LANGS = { ru: 'Russian', en: 'English' };
let cat = { q: '', lang: getLang() === 'ru' ? 'ru' : 'en', page: 1, items: [], total: 0, loading: false, error: '', token: 0 };

async function getJson(url, ms = 15000){
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if(!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}

const one = v => Array.isArray(v) ? String(v[0] || '') : String(v || '');
const clean = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const quote = s => '"' + String(s).replace(/["\\]/g, ' ') + '"';

export function searchUrl({ q, lang, page }){
  const parts = ['collection:librivoxaudio', 'mediatype:audio'];
  if(LANGS[lang]) parts.push(`language:(${LANGS[lang]})`);
  const words = String(q || '').trim();
  if(words) parts.push(`(title:(${quote(words)}) OR creator:(${quote(words)}))`);
  const fl = ['identifier', 'title', 'creator', 'language', 'downloads'].map(f => 'fl%5B%5D=' + f).join('&');
  return `${HOST}/advancedsearch.php?q=${encodeURIComponent(parts.join(' AND '))}&${fl}&rows=${PAGE}&page=${page}&output=json&sort%5B%5D=downloads+desc`;
}

export function parseSearch(json){
  const docs = json?.response?.docs || [];
  return {
    total: Number(json?.response?.numFound) || 0,
    items: docs.filter(d => d.identifier).map(d => ({
      id: String(d.identifier), title: clean(one(d.title)) || String(d.identifier), author: clean(one(d.creator)), language: one(d.language)
    }))
  };
}

/** "1234.5" | "20:34" | "1:02:03" -> seconds */
export function parseLength(v){
  const s = String(v ?? '').trim();
  if(!s) return 0;
  if(s.includes(':')) return s.split(':').reduce((a, p) => a * 60 + (Number(p) || 0), 0);
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Which licence the item carries, in words a person understands. LibriVox recordings are public domain. */
export function licenseOf(meta){
  const url = one(meta?.licenseurl).trim();
  const m = url.match(/creativecommons\.org\/(licenses|publicdomain)\/([\w-]+)\/?([\d.]*)/i);
  if(m){
    if(m[1].toLowerCase() === 'publicdomain') return { name: m[2].toLowerCase() === 'zero' ? 'CC0 (общественное достояние)' : 'Общественное достояние', url };
    return { name: ('CC ' + m[2].toUpperCase() + ' ' + m[3]).trim(), url };
  }
  return { name: 'Общественное достояние (LibriVox)', url: url || 'https://librivox.org/pages/public-domain/' };
}

/** The chapter files of an item: ONE set (the smallest speech-quality MP3), in reading order */
export function pickFiles(id, files){
  const mp3 = (files || []).filter(f => f && f.name && /mp3/i.test(f.format || '') && !/zip|m3u|metadata/i.test(f.format || '') && /\.mp3$/i.test(f.name));
  const order = ['64Kbps MP3', '128Kbps MP3', 'VBR MP3', 'MP3'];
  let set = [];
  for(const fmtName of order){ set = mp3.filter(f => (f.format || '').toLowerCase() === fmtName.toLowerCase()); if(set.length) break; }
  if(!set.length) set = mp3;
  const withTrack = set.every(f => Number(f.track) > 0);
  set = [...set].sort(withTrack ? (a, b) => Number(a.track) - Number(b.track) : (a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  return set.map((f, i) => ({
    name: clean(f.title) || t('Глава') + ' ' + (i + 1),
    fileName: f.name,
    uri: `${HOST}/download/${encodeURIComponent(id)}/${f.name.split('/').map(encodeURIComponent).join('/')}`,
    duration: parseLength(f.length),
    size: Number(f.size) || 0
  }));
}

export async function loadItem(id){
  const j = await getJson(`${HOST}/metadata/${encodeURIComponent(id)}`);
  const m = j.metadata || {};
  const files = pickFiles(id, j.files);
  if(!files.length) throw new Error('no audio');
  const lic = licenseOf(m);
  return {
    id, title: clean(one(m.title)) || id, author: clean(one(m.creator)), language: one(m.language),
    description: clean(one(m.description)).slice(0, 700), license: lic.name, licenseUrl: lic.url,
    files, duration: files.reduce((a, f) => a + f.duration, 0), size: files.reduce((a, f) => a + f.size, 0)
  };
}

const coverUrl = id => `${HOST}/services/img/${encodeURIComponent(id)}`;

/* ---------------- the screen ---------------- */

function subtitle(){ return escapeHtml(t('Свободные аудиокниги · LibriVox')); }

export function renderCatalog(){
  const chips = [['ru', t('Русские')], ['en', t('Английские')], ['all', t('Все языки')]]
    .map(([k, name]) => `<button type="button" class="filter-chip ${cat.lang === k ? 'active' : ''}" data-clang="${k}">${name}</button>`).join('');
  main.innerHTML = `<section class="screen catalog-screen">${header(t('Каталог'), subtitle(), iconBtn('refresh', t('Обновить'), 'catalogReload'))}
    <form class="cat-search" id="catForm"><input class="field" id="catQ" type="search" enterkeyhint="search" autocomplete="off" placeholder="${t('Название или автор')}" value="${escapeHtml(cat.q)}"><button class="primary" type="submit">${t('Найти')}</button></form>
    <div class="library-filters-bar">${chips}</div>
    <div id="catList"></div></section>`;
  $('catForm').onsubmit = e => { e.preventDefault(); cat.q = $('catQ').value.trim(); runSearch(true); };
  document.querySelectorAll('[data-clang]').forEach(b => b.onclick = () => {
    cat.lang = b.dataset.clang;
    document.querySelectorAll('[data-clang]').forEach(x => x.classList.toggle('active', x === b));
    runSearch(true);
  });
  $('catList').onclick = e => {
    const row = e.target.closest('[data-cat-id]');
    if(row) openCatalogItem(row.dataset.catId);
    else if(e.target.closest('#catMore')) runSearch(false);
    else if(e.target.closest('#catRetry')) runSearch(cat.page <= 1);
  };
  if(!cat.items.length && !cat.loading) runSearch(true); else drawList();
}

const langName = l => l === 'Russian' ? t('Русский') : l === 'English' ? 'English' : (l || '');

function row(it){
  const have = state.books.find(b => b.source?.id === it.id);
  const tag = have ? (have.online ? t('В библиотеке') : t('Скачано')) : '';
  return `<div class="library-book-item" data-cat-id="${escapeHtml(it.id)}">
    <div class="lib-row-main"><div class="lib-thumb">${bookCover({ title: it.title, cover: coverUrl(it.id) })}</div>
    <div class="lib-info"><div class="lib-title">${escapeHtml(it.title)}</div><div class="lib-author">${escapeHtml(it.author || t('Автор не указан'))}</div>
    <div class="lib-meta">${escapeHtml(langName(it.language))}${tag ? ` &middot; <span class="lib-done">${escapeHtml(tag)}</span>` : ''}</div></div></div></div>`;
}

function drawList(){
  const host = $('catList');
  if(!host) return;
  let h = '';
  if(cat.items.length) h += `<div class="shelf-list">${cat.items.map(row).join('')}</div>`;
  if(cat.loading) h += `<div class="cat-note">${t('Ищем…')}</div>`;
  else if(cat.error) h += `<div class="cat-note">${escapeHtml(cat.error)}<br><button class="secondary" id="catRetry">${t('Повторить')}</button></div>`;
  else if(!cat.items.length) h += `<div class="cat-note">${t('Ничего не найдено')}</div>`;
  else if(cat.items.length < cat.total) h += `<div class="cat-note"><button class="secondary" id="catMore">${t('Показать ещё')}</button></div>`;
  h += `<p class="cat-credit">${t('Записи добровольцев LibriVox, находятся в общественном достоянии. Хранятся на archive.org.')}</p>`;
  host.innerHTML = h;
}

async function runSearch(reset){
  if(cat.loading && !reset) return;
  const token = ++cat.token;
  if(reset){ cat.page = 1; cat.items = []; cat.total = 0; }
  else cat.page++;
  cat.loading = true; cat.error = '';
  drawList();
  try {
    const r = parseSearch(await getJson(searchUrl(cat)));
    if(token !== cat.token) return;
    cat.items = cat.items.concat(r.items.filter(n => !cat.items.some(o => o.id === n.id)));
    cat.total = r.total;
  } catch {
    if(token !== cat.token) return;
    cat.error = t('Нет связи с каталогом. Проверьте интернет.');
    if(!reset) cat.page--;
  }
  cat.loading = false;
  if(state.screen === 'catalog') drawList();
}

export function reloadCatalog(){ runSearch(true); }

/* ---------------- one book ---------------- */

const durText = sec => sec > 0 ? fmt(sec) : '—';

export async function openCatalogItem(id){
  openModal(`<h3>${t('Загрузка…')}</h3><div class="modal-actions"><button class="secondary" data-close>${t('Закрыть')}</button></div>`);
  let item;
  try { item = await loadItem(id); }
  catch { openModal(`<h3>${t('Не удалось загрузить книгу')}</h3><p class="cat-note">${t('Нет связи с каталогом. Проверьте интернет.')}</p><div class="modal-actions"><button class="secondary" data-close>${t('Закрыть')}</button></div>`); return; }
  drawItem(item);
}

function drawItem(item){
  const have = state.books.find(b => b.source?.id === item.id);
  const saved = have && !have.online;
  const job = have && downloads.get(have.id);
  const mb = item.size ? ` &middot; ${Math.max(1, Math.round(item.size / 1048576))} ${t('МБ')}` : '';
  openModal(`<div class="cat-card"><div class="cat-cover">${bookCover({ title: item.title, cover: coverUrl(item.id) })}</div>
    <div class="cat-head"><h3>${escapeHtml(item.title)}</h3><div class="lib-author">${escapeHtml(item.author || t('Автор не указан'))}</div>
    <div class="lib-meta">${item.files.length} ${t('глав')} &middot; ${durText(item.duration)}${mb}</div></div></div>
    ${item.description ? `<p class="cat-desc">${escapeHtml(item.description)}</p>` : ''}
    <div class="cat-lic"><b>${t('Лицензия')}:</b> ${escapeHtml(t(item.license))}<br><a href="${escapeHtml(item.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.licenseUrl)}</a><br>
    <b>${t('Источник')}:</b> <a href="${HOST}/details/${encodeURIComponent(item.id)}" target="_blank" rel="noopener noreferrer">archive.org/details/${escapeHtml(item.id)}</a></div>
    ${job ? `<div class="cat-note" id="catDl">${escapeHtml(dlText(job))}</div>` : ''}
    <button class="primary" id="catListen" style="width:100%">${t(have ? 'Слушать' : 'Слушать онлайн')}</button>
    ${saved ? `<div class="cat-note">${t('Скачано в вашу папку. Книга остаётся у вас и работает без интернета.')}</div>`
      : `<button class="secondary" id="catSave" style="width:100%;margin-top:8px"${job ? ' disabled' : ''}>${t('Скачать')} ${isPremium() ? '' : '· Premium'}</button>`}
    <div class="modal-actions"><button class="secondary" data-close>${t('Закрыть')}</button></div>`);
  $('catListen').onclick = async () => { const b = await ensureBook(item); closeModal(); if(b) act('playBook', b.id); };
  const sv = $('catSave');
  if(sv) sv.onclick = () => saveBook(item);
}

/** The library record of a catalog book (made on first use) */
export async function ensureBook(item){
  let b = state.books.find(x => x.source?.id === item.id);
  if(b) return b;
  b = {
    id: uid(), title: item.title, author: item.author, cover: '', coverChecked: true, files: item.files.map(f => ({ ...f })),
    srcPath: 'archive:' + item.id, added: Date.now(), pos: { i: 0, t: 0 }, marks: [], online: true,
    source: { kind: 'archive', id: item.id, url: `${HOST}/details/${encodeURIComponent(item.id)}`, license: item.license, licenseUrl: item.licenseUrl, language: item.language }
  };
  state.books.unshift(b);
  await saveBooks();
  fetchCover(b);
  return b;
}

/** Keep the cover on the device, so the library does not need the network to show it */
async function fetchCover(b){
  try {
    const r = await fetch(coverUrl(b.source.id), { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if(!r.ok) throw new Error('cover');
    const blob = await r.blob();
    if(!blob.size || blob.size > 2_000_000) throw new Error('cover');
    b.cover = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.onerror = no; fr.readAsDataURL(blob); });
  } catch { b.cover = coverUrl(b.source.id); }
  await saveBooks();
  if(state.screen === 'shelf') act('updateShelf');
}

/* ---------------- downloads (Premium) ---------------- */

export const downloads = new Map();       // bookId -> { index, total, bytes, size, cancel }
const dlText = j => j.error ? j.error : t('Скачивание: {i} из {n}', { i: Math.min(j.index + 1, j.total), n: j.total });

async function pickFolderForDownload(){
  if(!isNative()){ showToast(t('Скачивание работает в приложении на телефоне')); return null; }
  if(!state.folders.length){ showToast(t('Сначала добавьте папку в библиотеку: книги скачаются в неё')); act('openAddSheet'); return null; }
  if(state.folders.length === 1) return state.folders[0];
  let want = ''; try { want = localStorage.getItem('dl.folder') || ''; } catch {}
  const known = state.folders.find(f => f.id === want);
  if(known) return known;
  return new Promise(resolve => {
    openModal(`<h3>${t('Куда скачивать?')}</h3>${state.folders.map(f => `<div class="modal-row" data-f="${escapeHtml(f.id)}"><span style="flex:1">${escapeHtml(f.name)}</span></div>`).join('')}<div class="modal-actions"><button class="secondary" data-close>${t('Отмена')}</button></div>`);
    document.querySelectorAll('[data-f]').forEach(el => el.onclick = () => {
      try { localStorage.setItem('dl.folder', el.dataset.f); } catch {}
      closeModal(); resolve(state.folders.find(f => f.id === el.dataset.f) || null);
    });
    $('modalBack')?.addEventListener('click', e => { if(e.target.id === 'modalBack' || e.target.closest('[data-close]')) resolve(null); });
  });
}

const safeName = s => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'book';

export async function saveBook(item){
  if(!gate('download', isPremium())) return;
  const P = plugin('ShelfFiles');
  if(!P?.downloadFile){ showToast(t('Скачивание работает в приложении на телефоне')); return; }
  const folder = await pickFolderForDownload();
  if(!folder) return;
  const b = await ensureBook(item);
  if(downloads.has(b.id)) return;
  const dir = `${DL_DIR}/${safeName(item.title)}`;
  const job = { index: 0, total: item.files.length, bytes: 0, cancel: false, error: '' };
  downloads.set(b.id, job);
  showToast(t('Скачивание началось'));
  drawItem(item);
  const done = [];
  try {
    for(let i = 0; i < item.files.length; i++){
      if(job.cancel) throw new Error('cancelled');
      job.index = i;
      const f = item.files[i];
      const name = String(i + 1).padStart(3, '0') + ' - ' + safeName(f.name) + '.mp3';
      const r = await P.downloadFile({ treeUri: folder.uri, dir, name, url: f.uri, size: f.size, bookId: b.id, index: i, total: item.files.length });
      done.push({ ...f, uri: r.uri, size: Number(r.size) || f.size, fileName: name });
      paintDl(b.id);
    }
    b.files = done; b.online = false; b.downloadedAt = Date.now(); b.sourceFolderId = folder.id;
    b.srcPath = `${folder.id}:${dir}`;               // a later folder scan updates this very book instead of adding a copy
    await saveBooks();
    showToast(t('Книга скачана: {title}', { title: b.title }));
  } catch(e) {
    const m = String(e?.message || e?.errorMessage || e || '');
    if(job.cancel || m === 'cancelled') showToast(t('Скачивание остановлено'));
    else if(m === 'denied') showToast(t('Нет доступа на запись в папку. Добавьте папку в библиотеку заново.'));
    else if(m === 'nospace') showToast(t('Не хватает места на устройстве'));
    else showToast(t('Не удалось скачать. Проверьте интернет и попробуйте снова.'));
  } finally {
    downloads.delete(b.id);
    if(state.screen === 'shelf') act('updateShelf');
    if(state.screen === 'catalog') drawList();
  }
}

export function cancelDownload(bookId){
  const j = downloads.get(bookId);
  if(!j) return;
  j.cancel = true;
  plugin('ShelfFiles')?.cancelDownload?.({ bookId });
}

function paintDl(bookId){
  const j = downloads.get(bookId);
  const el = $('catDl');
  if(j && el) el.textContent = dlText(j);
}

export function initDownloadEvents(){
  const P = plugin('ShelfFiles');
  if(!P?.addListener) return;
  P.addListener('downloadProgress', e => {
    const j = downloads.get(e.bookId);
    if(!j) return;
    j.index = Number(e.index) || j.index;
    j.bytes = Number(e.bytes) || 0;
    paintDl(e.bookId);
  });
}

/** One line for the library row: where the book is from and under which licence */
export function sourceLine(b){
  if(!b?.source) return '';
  return `${t(b.online ? 'Онлайн' : 'Скачано')} · ${t(b.source.license)}`;
}

/** Sheet "About this book": source and licence of a catalog book (opened from the player menu) */
export function openSourceInfo(id){
  const b = state.books.find(x => x.id === id);
  if(!b?.source) return;
  const s = b.source;
  openModal(`<h3>${escapeHtml(b.title)}</h3>
    <div class="cat-lic"><b>${t('Лицензия')}:</b> ${escapeHtml(t(s.license))}<br><a href="${escapeHtml(s.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.licenseUrl)}</a><br>
    <b>${t('Источник')}:</b> <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.url.replace(/^https:\/\//, ''))}</a><br>
    <b>${t('Статус')}:</b> ${t(b.online ? 'Онлайн: слушается из интернета' : 'Скачано: хранится на устройстве')}</div>
    <div class="modal-actions"><button class="secondary" data-close>${t('Закрыть')}</button></div>`);
}

