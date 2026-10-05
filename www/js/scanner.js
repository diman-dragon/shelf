/* scanner.js — Folder picker, Native scan listener, file import */
import { state, icon, escapeHtml, plugin, plural, isNative, $, uid, modalRoot, durationOfBook, cleanTitle, cleanFolderName } from './state.js';
import { persist, saveBooksSoon, flushBooks } from './storage.js';
import { dbSet } from './db.js';
import { openModal, closeModal, showToast } from './ui-utils.js';
import { render, act } from './router.js';

let nativeScanListenersReady = false;
let scanRenderTimer = null;
const SCAN_BATCH_MS = 400;     // UI refresh interval during a scan (rows are appended incrementally, see library.updateShelfList)
// folderId -> {total, processed, done, started}: several folders scan one after another, the dock shows the sum
const scanJobs = new Map();

export function openFolderSheet(){
  const folders = state.folders;
  const selected = folders.filter(f => state.selectedFolderIds.includes(f.id));
  modalRoot.innerHTML = `<div class="modal-back" id="folderBack"><div class="sheet" id="folderSheet"><div class="sheet-head"><button class="sheet-close" id="folderClose" aria-label="Закрыть">${icon('close')}</button><h2>Выбор папок</h2><span style="font-size:11px;color:var(--muted)">${selected.length} выбрано</span></div>
    <div class="scan-hero"><strong>Папки с аудио</strong><p>Добавляйте несколько папок. Доступ к ним сохраняется на устройстве, а вложенные каталоги сканируются автоматически.</p></div>
    <div id="folderList">${folders.length?folders.map(folderRow).join(''):`<div style="padding:25px 4px;text-align:center;color:var(--muted)">Папки ещё не выбраны.</div>`}</div>
    <button class="primary" id="scanNow" style="margin-top:12px">${icon('refresh')} Сканировать выбранные</button>
    <button class="secondary" id="addFolderNow" style="margin-top:8px">${icon('folderPlus')} Добавить папку</button>
    <div class="section-title">Состояние</div><div id="scanInfo" class="scan-hero"><strong>${selected.length} ${plural(selected.length,'папка выбрана','папки выбрано','папок выбрано')}</strong><p>После сканирования приложение вернётся в библиотеку.</p></div>
    <div id="scanProgress" class="scan-progress hidden"><div class="progress-bar"><i id="scanBar"></i></div><div class="scan-text" id="scanText"></div></div>
    <div id="scanFound"></div>
  </div></div>`;

  $('folderClose').onclick = closeModal;
  $('folderBack').onclick = e => { if(e.target.id === 'folderBack') closeModal(); };
  $('addFolderNow').onclick = pickFolder;
  $('scanNow').onclick = () => scanAllFolders({silent: false, returnToShelf: true});

  document.querySelectorAll('[data-folder]').forEach(el => el.onclick = e => {
    if(e.target.closest('[data-folder-delete]')) return;
    toggleFolder(el.dataset.folder);
  });
  document.querySelectorAll('[data-folder-delete]').forEach(el => el.onclick = e => {
    e.stopPropagation();
    deleteFolder(el.dataset.folderDelete);
  });
}

function folderRow(f){
  const on = state.selectedFolderIds.includes(f.id);
  return `<div class="folder-card ${on?'selected':''}" data-folder="${escapeHtml(f.id)}"><div class="check"></div><div class="folder-info"><div class="folder-name">${escapeHtml(cleanFolderName(f.name))}</div><div class="folder-path">${escapeHtml(f.uri)}</div></div><button class="folder-delete" data-folder-delete="${escapeHtml(f.id)}" aria-label="Удалить папку">${icon('trash')}</button></div>`;
}

async function toggleFolder(id){
  state.selectedFolderIds.includes(id) ? state.selectedFolderIds = state.selectedFolderIds.filter(x => x !== id) : state.selectedFolderIds.push(id);
  await dbSet('foldersSelected', state.selectedFolderIds);
  openFolderSheet();
}

async function deleteFolder(id){
  const f = state.folders.find(x => x.id === id);
  if(!f) return;
  openModal(`<h3>Удалить папку?</h3><p style="color:var(--muted);font-size:13px">Папка «${escapeHtml(f.name)}» перестанет сканироваться. Файлы на телефоне не удаляются.</p><div class="modal-actions"><button class="secondary" data-close>Отмена</button><button class="primary" id="folderDeleteConfirm" style="background:var(--danger);color:#fff">Удалить</button></div>`);
  $('folderDeleteConfirm').onclick = async () => {
    state.folders = state.folders.filter(x => x.id !== id);
    state.selectedFolderIds = state.selectedFolderIds.filter(x => x !== id);
    state.books = state.books.filter(b => b.sourceFolderId !== id);
    state.playlists.forEach(p => p.bookIds = (p.bookIds || []).filter(bid => state.books.some(b => b.id === bid)));
    if(state.current?.sourceFolderId === id){
      act('unloadCurrent');                                  // stops <audio> + the native service + its notification
      if(state.screen === 'player') state.screen = 'shelf';
    }
    await persist();
    await dbSet('foldersSelected', state.selectedFolderIds);
    closeModal();
    render();
    openFolderSheet();
  };
}

export async function pickFolder(){
  const P = plugin('ShelfFiles');
  if(!P){ showToast('Модуль доступа к папкам не загружен'); return; }
  try {
    const f = await P.pickFolder();
    if(!f?.uri) return;
    let old = state.folders.find(x => x.uri === f.uri);
    if(!old){ old = {id:uid(), name:cleanFolderName(f.name), uri:f.uri}; state.folders.push(old); }
    if(!state.selectedFolderIds.includes(old.id)) state.selectedFolderIds.push(old.id);
    await persist();
    await dbSet('foldersSelected', state.selectedFolderIds);
    closeModal();
    state.screen = 'shelf';
    beginScan([old], old.name);
    render();
    await startFolderScan(old);
  } catch(e) { showToast(e?.message || e?.errorMessage || 'Не удалось выбрать папку'); }
}

/* ---------------- scan progress model ---------------- */

/** Starts (or joins, if a scan is already running) a scan session for the given folders */
function beginScan(folders, name, silent = false){
  const running = !!state.scan?.active && [...scanJobs.values()].some(j => !j.done);
  if(!running){
    scanJobs.clear();
    state.scan = {active:true, total:0, processed:0, books:0, skipped:0, errors:0, timeouts:0, firstError:'', counting:true, name, silent};
    dupIndex = null;
  }
  folders.forEach(f => {
    const j = scanJobs.get(f.id);
    if(!j || j.done) scanJobs.set(f.id, {total:0, processed:0, done:false, started:false});
  });
  state.scan.name = scanJobs.size > 1 ? 'Сканирование папок' : name;
  syncScan();
}

function jobFor(id){
  let j = scanJobs.get(id);
  if(!j){ j = {total:0, processed:0, done:false, started:true}; scanJobs.set(id, j); }
  return j;
}

/** Totals over all folders of the session */
function syncScan(){
  let total = 0, processed = 0, counting = false;
  scanJobs.forEach(j => {
    total += j.total; processed += j.processed;
    if(!j.done && !(j.total > 0)) counting = true;   // total of this folder is not known yet
  });
  state.scan.total = total;
  state.scan.processed = processed;
  state.scan.counting = counting;
}

/** The dock goes away only when EVERY folder of the session is finished */
async function finishIfAllDone(){
  if(![...scanJobs.values()].every(j => j.done)) return;
  const s = state.scan;
  if(!s.active) return;
  clearTimeout(scanRenderTimer);
  try { await flushBooks(); } catch(e) { showToast('Не удалось сохранить библиотеку: ' + (e?.message || e)); }
  dupIndex = null;
  syncScan();
  updateScanDock();
  setTimeout(() => {
    s.active = false;
    if(state.screen === 'shelf') act('renderShelf');
    // a silent (automatic) scan only speaks up when it actually found something or failed
    if(s.silent && !s.books && !s.errors) return;
    const parts = [`Добавлено книг: ${s.books}`];
    if(s.skipped) parts.push(`дубликатов пропущено: ${s.skipped}`);
    showToast(parts.join(' · '));
    // errors are never swallowed: the person sees them after the summary
    if(s.errors) setTimeout(() => showToast(`Ошибки чтения: ${s.errors}${s.firstError ? ' — ' + s.firstError : ''}`), 2600);
    else if(s.timeouts) setTimeout(() => showToast(`Не удалось сразу прочитать длительность у файлов: ${s.timeouts}. Догрузим позже`), 2600);
  }, 400);
}

function scanView(p){
  const known = p.total > 0;
  const pct = known ? Math.min(100, p.processed / p.total * 100) : 0;
  return {
    known, pct,
    label: known ? `${Math.round(pct)}%` : '…',
    foot: known ? `${p.processed} из ${p.total} аудиофайлов` : (p.counting ? 'Подсчёт файлов…' : `${p.processed} аудиофайлов`)
  };
}

export function scanDock(){
  const p = state.scan || {};
  const v = scanView(p);
  const bar = v.known ? `style="width:${v.pct}%"` : '';
  return `<div class="scan-dock" id="scanDock"><div class="scan-dock-top"><span class="scan-spinner"></span><div><b>Добавляем книги</b><small>${escapeHtml(p.name||'Сканирование')} · ${p.books||0} книг</small></div><strong>${v.label}</strong></div><div class="scan-dock-bar"><i id="scanDockBar" class="${v.known?'':'indeterminate'}" ${bar}></i></div><div class="scan-dock-foot">${v.foot}</div></div>`;
}

async function startFolderScan(folder, silent = false){
  const P = plugin('ShelfFiles');
  if(!P) return;
  let job = scanJobs.get(folder.id);
  if(!job){ beginScan([folder], folder.name, silent); job = scanJobs.get(folder.id); }
  if(job.started && !job.done) return;               // this folder is already being scanned
  job.started = true;
  try { await P.scanFolder({uri:folder.uri, folderId:folder.id, folderName:folder.name}); }
  catch(e) {
    job.done = true;
    state.scan.errors++;
    state.scan.firstError = state.scan.firstError || (e?.message || 'Не удалось начать сканирование');
    syncScan();
    showToast(e?.message || 'Не удалось начать сканирование');
    await finishIfAllDone();
  }
}

/**
 * silent       automatic scan on start: no toast, no folder sheet, the screen the person is on is NOT changed
 * returnToShelf  explicit scan from the folder sheet: close the sheet and show the library with the progress dock
 */
export async function scanAllFolders({silent = false, returnToShelf = false} = {}){
  const ids = [...state.selectedFolderIds], folders = state.folders.filter(f => ids.includes(f.id));
  if(!folders.length){
    if(silent) return;                                        // nothing selected: an automatic scan just does nothing
    showToast('Сначала выберите папку');
    openFolderSheet();
    return;
  }
  if(!silent){
    closeModal();
    if(returnToShelf) state.screen = 'shelf';
  }
  beginScan(folders, folders.length===1?folders[0].name:'Сканирование папок', silent);
  if(!silent) render();
  for(const f of folders) await startFolderScan(f, silent);
}

/* ---------------- duplicates ---------------- */

function normTitle(s=''){ return String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function normName(s=''){ return stripExt(String(s)).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }

const hasSizes = files => files.length > 0 && files.every(f => f.size > 0);
const sizeKey = files => `${files.length}:${files.map(f => f.size).sort((x, y) => x - y).join(',')}`;
const titleKey = (title, files) => `${files.length}:${normTitle(title)}`;

// Duplicate lookup index, built once per scan session: sizes -> books, title -> books.
// Used to be an O(n) isSameBook() pass (with sorting inside) for EVERY scanned book.
let dupIndex = null;

function indexBook(book){
  if(!dupIndex) return;
  const files = book.files || [];
  if(!files.length) return;
  if(hasSizes(files)){
    const k = sizeKey(files);
    (dupIndex.bySize.get(k) || dupIndex.bySize.set(k, []).get(k)).push(book);
  }
  const t = titleKey(book.title, files);
  (dupIndex.byTitle.get(t) || dupIndex.byTitle.set(t, []).get(t)).push(book);
}

function ensureDupIndex(){
  if(dupIndex) return;
  dupIndex = {bySize: new Map(), byTitle: new Map()};
  state.books.forEach(indexBook);
}

/**
 * Is `cand` (just scanned) the same book as one already in the library? The folder does not matter —
 * a copy of a book in another folder is a duplicate.
 *  - file sizes known for both:  same chapter count and the same sorted list of sizes (byte-exact content)
 *  - sizes unavailable (some cloud providers): same chapter count + same title, and the same total duration
 *    (or the same chapter names when durations are unknown)
 */
function isDuplicate(cand){
  ensureDupIndex();
  const files = cand.files;
  if(!files.length) return false;
  if(hasSizes(files) && dupIndex.bySize.has(sizeKey(files))) return true;
  const sameTitle = dupIndex.byTitle.get(titleKey(cand.title, files)) || [];
  return sameTitle.some(book => {
    if(hasSizes(files) && hasSizes(book.files)) return false;     // both have sizes: only the byte-exact rule above applies
    const da = durationOfBook(book), db = durationOfBook(cand);
    if(da > 0 && db > 0) return Math.abs(da - db) <= 2;
    const na = book.files.map(f => normName(f.fileName || f.name)).sort().join('|');
    const nb = files.map(f => normName(f.fileName || f.name)).sort().join('|');
    return na === nb;
  });
}

/* ---------------- native events ---------------- */

export function initNativeScanListeners(){
  if(nativeScanListenersReady || !isNative()) return;
  const P = plugin('ShelfFiles');
  if(!P?.addListener) return;
  nativeScanListenersReady = true;

  P.addListener('scanStarted', e => {
    const j = jobFor(e.folderId);
    j.started = true; j.done = false;
    j.total = Number(e.totalFiles) || 0;
    j.processed = 0;
    state.scan.active = true;
    if(scanJobs.size === 1) state.scan.name = e.folderName || state.scan.name || 'Сканирование';
    syncScan();
    updateScanDock();
  });

  P.addListener('scanBook', e => {
    const folder = state.folders.find(f => f.id === e.folderId);
    if(!folder) return;
    const fs = (e.files || []).map(f => ({...f, folderId: e.folderId, folderName: e.folderName}));
    if(!fs.length) return;
    const files = fs.sort(naturalFile).map(toNativeFile);
    const first = files[0];
    const path = String(e.path || '');
    const title = path ? path.split('/').pop() : stripExt(first?.name || e.title || folder.name);
    const srcPath = e.srcPath || `${folder.id}:${path}`;
    // folder names are NOT passed through stripExt (it cut "Name. Author" down to "Name"); the native side already strips file extensions
    const titleFinal = cleanTitle(e.title || title);
    const authorFinal = (e.author || '').trim();

    // 1) same place as before — a rescan updates the book instead of duplicating it
    let book = state.books.find(b => b.srcPath === srcPath);
    if(book){
      book.title = titleFinal || book.title;
      if(authorFinal) book.author = authorFinal;
      // keep already known durations if the scanner did not report them
      const old = new Map((book.files || []).map(f => [f.uri, f]));
      files.forEach(nf => { if(!(nf.duration > 0)){ const o = old.get(nf.uri); if(o?.duration > 0) nf.duration = o.duration; } });
      book.files = files;
      book.sourceFolderId = folder.id;
      if(e.cover) book.cover = e.cover;
      book.coverChecked = true;
    } else {
      // 2) the same book from ANOTHER folder / path is a duplicate: not added
      const cand = {title: titleFinal, files};
      if(isDuplicate(cand)){
        state.scan.skipped++;
        updateScanDock();
        return;
      }
      book = {id:uid(), title:titleFinal, author:authorFinal, cover:e.cover || '', coverChecked:true, files, srcPath, sourceFolderId:folder.id, added:Date.now(), pos:{i:0,t:0}, marks:[]};
      state.books.unshift(book);
      indexBook(book);
      state.scan.books++;
    }
    // Batch IDB writes (covers are stored under their own keys, only changed ones) and UI updates
    saveBooksSoon(1500, 8000);
    if(!scanRenderTimer){
      scanRenderTimer = setTimeout(() => {
        scanRenderTimer = null;
        if(state.screen === 'shelf') act('updateShelf');       // appends/changes rows, keeps scroll, no full re-render
        updateScanDock();
      }, SCAN_BATCH_MS);
    }
    updateScanDock();
  });

  P.addListener('scanProgress', e => {
    const j = jobFor(e.folderId);
    j.total = Number(e.totalFiles) || j.total;
    j.processed = Number(e.processedFiles) || 0;
    syncScan();
    updateScanDock();
  });

  P.addListener('scanComplete', async e => {
    const j = jobFor(e.folderId);
    j.processed = Number(e.processedFiles) || j.processed;
    j.total = Math.max(Number(e.totalFiles) || 0, j.processed);
    j.done = true;
    state.scan.errors += Number(e.errors) || 0;
    state.scan.timeouts += Number(e.timeouts) || 0;
    if(!state.scan.firstError && e.firstError) state.scan.firstError = String(e.firstError);
    syncScan();
    updateScanDock();
    await finishIfAllDone();
  });

  P.addListener('scanError', async e => {
    const j = jobFor(e.folderId);
    j.done = true;
    state.scan.errors++;
    if(!state.scan.firstError) state.scan.firstError = e?.message || 'Ошибка сканирования';
    syncScan();
    updateScanDock();
    await finishIfAllDone();
  });
}

function updateScanDock(){
  const el = $('scanDock');
  if(!el){ if(state.scan.active && state.screen === 'shelf') act('renderShelf'); return; }
  const p = state.scan, v = scanView(p);
  const bar = $('scanDockBar');
  if(bar){
    bar.classList.toggle('indeterminate', !v.known);
    bar.style.width = v.known ? v.pct + '%' : '';
  }
  const foot = el.querySelector('.scan-dock-foot'); if(foot) foot.textContent = v.foot;
  const small = el.querySelector('small'); if(small) small.textContent = `${p.name||'Сканирование'} · ${p.books||0} книг`;
  const strong = el.querySelector('.scan-dock-top>strong'); if(strong) strong.textContent = v.label;
}

function toNativeFile(f){
  return {
    uri: f.uri,
    name: stripExt(f.name),
    fileName: f.name,
    mime: f.mime || f.mimeType || 'audio/*',
    size: Number(f.size) || 0,
    modified: Number(f.modified || f.lastModified) || 0,
    duration: Number(f.duration) || 0
  };
}

function naturalFile(a, b){
  return a.name.localeCompare(b.name, 'ru', {numeric:true, sensitivity:'base'});
}

/** Removes only a KNOWN audio extension: "Vol. 1 Foundation" or "Мастер и Маргарита. Булгаков" must stay intact */
const AUDIO_EXT = /\.(mp3|m4a|m4b|aac|ogg|opus|flac|wav|wma)$/i;
function stripExt(s=''){ return String(s).replace(AUDIO_EXT, ''); }
