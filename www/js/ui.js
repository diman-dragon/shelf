/* ui.js — UI helpers, Modals, Settings, Playlists, Filters */
import { state, icon, escapeHtml, durationOfBook, uid, plural, $, modalRoot, main } from './state.js';
import { persist } from './storage.js';
import { openFolderSheet, pickFolder, openAddSheet } from './scanner.js';
import { audio } from './sound.js';
import { openPlayer, renderPlayer, loadChapter } from './player.js';
import { renderShelf, openLibraryFilter, openSort } from './library.js';
import { showToast, openModal, closeModal, bookCover, iconBtn, settingToggle, fmt } from './ui-utils.js';

export { showToast, openModal, closeModal, bookCover, iconBtn, settingToggle, fmt };

export function header(title, subtitle, actions=''){
  // Under title: if a book is active and we are not on player screen — show compact now-playing progress
  let subHtml = '';
  if(state.current && state.screen !== 'player'){
    const b = state.current;
    const pct = nowPlayingPct();
    subHtml = `<div class="now-playing" id="headerNowPlaying" data-book-id="${escapeHtml(b.id)}">
      <span class="now-playing-ico">${icon('book')}</span>
      <div class="now-playing-track" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100">
        <i style="width:${pct}%"></i>
      </div>
      <span class="now-playing-title">${escapeHtml(b.title||'')}</span>
    </div>`;
  } else if(subtitle){
    subHtml = `<p>${subtitle}</p>`;
  }
  return `<div class="topbar"><div class="topbar-main"><h2>${title}</h2>${subHtml}</div><div class="top-actions">${actions}</div></div>`;
}

/** Whole-book progress 0–100 for header bar */
export function nowPlayingPct(){
  if(!state.current) return 0;
  return progress(state.current);
}

export function updateHeaderNowPlaying(){
  requestAnimationFrame(() => {
    const el = $('headerNowPlaying');
    if(!el || !state.current) return;
    const pct = nowPlayingPct();
    const bar = el.querySelector('.now-playing-track i');
    if(bar) bar.style.width = pct + '%';
    const track = el.querySelector('.now-playing-track');
    if(track) track.setAttribute('aria-valuenow', String(Math.round(pct)));
    const title = el.querySelector('.now-playing-title');
    if(title && title.textContent !== (state.current.title||'')) title.textContent = state.current.title || '';
  });
}

function bindHeaderNowPlaying(){
  const el = $('headerNowPlaying');
  if(!el) return;
  el.onclick = () => {
    if(state.current) openPlayer(state.current.id);
  };
}

export function progress(b, cachedAudioTime = null){
  const files = b.files || [];
  if(!files.length) return 0;
  const total = files.reduce((a,f)=>a+(Number(f.duration)||0), 0);
  if(total <= 0){
    // fallback: by chapter index when durations unknown
    const i = Math.max(0, Math.min(Number(b.pos?.i)||0, files.length-1));
    const t = Math.max(0, Number(b.pos?.t)||0);
    const d = Math.max(0, Number(files[i]?.duration)||0);
    return Math.max(0, Math.min(100, ((i + (d ? t/d : 0)) / files.length) * 100));
  }
  let i = Math.max(0, Math.min(Number(b.pos?.i)||0, files.length-1));
  // live position for current book
  if(state.current && state.current.id === b.id){
    i = Math.max(0, Math.min(state.currentIndex, files.length-1));
    let t = Number(state.currentPos)||0;
    if(cachedAudioTime !== null){
      t = cachedAudioTime;
    } else {
      try { if(typeof audio !== 'undefined' && audio && Number.isFinite(audio.currentTime)) t = audio.currentTime; } catch {}
    }
    const before = files.slice(0, i).reduce((a,f)=>a+(Number(f.duration)||0), 0);
    return Math.max(0, Math.min(100, ((before + t) / total) * 100));
  }
  const t = Math.max(0, Number(b.pos?.t)||0);
  const before = files.slice(0, i).reduce((a,f)=>a+(Number(f.duration)||0), 0);
  return Math.max(0, Math.min(100, ((before + t) / total) * 100));
}

let navBound = false;

export function bindNav(){
  // Bottom nav lives outside #main — bind once with pointer + click for reliable mobile taps
  if(!navBound){
    navBound = true;
    const nav = document.querySelector('.bottom-nav');
    if(nav){
      const go = (el) => {
        const btn = el.closest('[data-nav]');
        if(!btn) return;
        setScreen(btn.dataset.nav);
      };
      nav.addEventListener('click', e => go(e.target), {passive:true});
      nav.addEventListener('pointerup', e => {
        if(e.pointerType === 'touch' || e.pointerType === 'pen') go(e.target);
      }, {passive:true});
    }
  }
  // Actions inside current screen (recreated on each render)
  document.querySelectorAll('[data-action]').forEach(b => {
    const a = b.dataset.action;
    const fn = {openAddSheet, openLibraryFilter, openSort, newPlaylist}[a];
    if(fn) b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
  });
  // SVG must never intercept taps (critical for Android WebView)
  document.querySelectorAll('button .icon, button svg, .nav-ico, .nav-ico svg').forEach(el => {
    el.style.pointerEvents = 'none';
  });
  bindHeaderNowPlaying();
}

export function setScreen(screen){
  state.screen = screen;
  state.query = '';
  if(screen === 'player' && !state.current){ showToast('Сначала выберите книгу в библиотеке'); state.screen = 'shelf'; }
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.nav === state.screen));
  render();
  if(state.screen === 'player' && state.current && !state.blobUrl) loadChapter(state.currentIndex, state.currentPos, false);
}

export function render(){
  if(state.screen === 'shelf') renderShelf();
  if(state.screen === 'player') renderCurrentPlayer();
  if(state.screen === 'playlists') renderPlaylists();
  if(state.screen === 'settings') renderSettings();
  bindNav();
}

export function renderCurrentPlayer(){
  if(state.current) renderPlayer(); else renderShelf();
}

export function renderPlaylists(){
  const ps = state.playlists;
  main.innerHTML = `<section class="screen">${header('Плейлисты','Подборки и закладки', iconBtn('plus','Новый плейлист','newPlaylist'))}<div class="playlists">${ps.map(p=>`<div class="playlist" data-pl="${escapeHtml(p.id)}"><div class="playlist-art">${p.emoji||'♫'}</div><div class="playlist-info"><div class="playlist-name">${escapeHtml(p.name)}</div><div class="playlist-count">${(p.bookIds||[]).length} ${plural((p.bookIds||[]).length,'аудиокнига','аудиокниги','аудиокниг')}</div></div>${icon('chevron')}</div>`).join('')}</div></section>`;
  document.querySelectorAll('.playlist[data-pl]').forEach(el => el.onclick = () => openPlaylist(el.dataset.pl));
  document.querySelectorAll('[data-action="newPlaylist"]').forEach(el => el.onclick = newPlaylist);
}

export function newPlaylist(){
  openModal(`<h3>Новый плейлист</h3><input class="field" id="newPlName" placeholder="Название"><div class="modal-actions"><button class="secondary" data-close>Отмена</button><button class="primary" id="newPlSave">Создать</button></div>`);
  $('newPlSave').onclick = async () => {
    const name = $('newPlName').value.trim();
    if(!name) return showToast('Введите название');
    state.playlists.push({id:uid(), name, emoji:'♫', bookIds:[]});
    await persist();
    closeModal();
    renderPlaylists();
  };
}

export function openPlaylistChooser(bookId){
  openModal(`<h3>Добавить в плейлист</h3>${state.playlists.map(p=>`<div class="modal-row" data-choose-pl="${escapeHtml(p.id)}"><span style="flex:1">${p.emoji||'♫'} ${escapeHtml(p.name)}</span>${(p.bookIds||[]).includes(bookId)?'✓':''}</div>`).join('')}`);
  document.querySelectorAll('[data-choose-pl]').forEach(el => el.onclick = () => {
    togglePlaylistBook(el.dataset.choosePl, bookId);
    closeModal();
    showToast('Плейлист обновлён');
  });
}

export function playlistHas(pid, bid){
  return !!state.playlists.find(p => p.id === pid)?.bookIds?.includes(bid);
}

export async function togglePlaylistBook(pid, bid){
  const p = state.playlists.find(x => x.id === pid);
  if(!p) return;
  p.bookIds = p.bookIds || [];
  p.bookIds.includes(bid) ? p.bookIds = p.bookIds.filter(x => x !== bid) : p.bookIds.push(bid);
  await persist();
}

export function openPlaylist(id){
  const p = state.playlists.find(x => x.id === id);
  if(!p) return;
  const books = (p.bookIds || []).map(bid => state.books.find(b => b.id === bid)).filter(Boolean);
  openModal(`<h3>${escapeHtml(p.name)}</h3>${books.length?books.map(b=>`<div class="modal-row" data-pl-book="${b.id}"><div style="flex:1"><b>${escapeHtml(b.title)}</b><div style="font-size:11px;color:var(--muted)">${escapeHtml(b.author||'')}</div></div>${icon('chevron')}</div>`).join(''):`<div style="padding:22px 5px;color:var(--muted);text-align:center">В этом плейлисте пока ничего нет.</div>`}<div class="modal-actions"><button class="secondary" data-close>Закрыть</button></div>`);
  document.querySelectorAll('[data-pl-book]').forEach(el => el.onclick = () => { closeModal(); openPlayer(el.dataset.plBook); });
}

export function renderSettings(){
  const s = state.settings;
  const folderCount = state.folders.length;
  main.innerHTML = `<section class="screen">${header('Настройки')}
    <div class="settings-group"><p class="settings-title">Хранилище</p>
      <div class="setting" id="settingsFolders"><div class="setting-icon">${icon('folder')}</div><div class="setting-main"><div class="setting-name">Выбранные папки</div><div class="setting-desc">${folderCount} ${plural(folderCount,'папка','папки','папок')}</div></div><div class="chevron">${icon('chevron')}</div></div>
      <div class="setting" id="addFolder"><div class="setting-icon">${icon('folderPlus')}</div><div class="setting-main"><div class="setting-name">Добавить папку</div><div class="setting-desc">Папки с аудиокнигами</div></div><div class="chevron">${icon('chevron')}</div></div>
    </div>
    <div class="settings-group"><p class="settings-title">Сканирование</p>
      <div class="setting" id="formats"><div class="setting-icon">${icon('music')}</div><div class="setting-main"><div class="setting-name">Форматы аудио</div><div class="setting-desc">MP3, M4A, M4B, AAC, OGG, OPUS, FLAC, WAV, WMA</div></div></div>
      ${settingToggle('autoscan','Автосканирование','Проверять выбранные папки при запуске',!!s.autoscan)}
    </div>
    <div class="settings-group"><p class="settings-title">Внешний вид</p>
      <div class="setting" id="themeSetting"><div class="setting-icon">${icon(s.theme==='dark'?'moon':'sun')}</div><div class="setting-main"><div class="setting-name">Тема оформления</div><div class="setting-desc">Тёмная или светлая тема</div></div><div class="setting-value">${s.theme==='dark'?'Тёмная':'Светлая'}</div></div>
    </div>
    <div class="settings-group"><p class="settings-title">О приложении</p><div class="setting"><div class="setting-icon">${icon('info')}</div><div class="setting-main"><div class="setting-name">AudioShelf</div><div class="setting-desc">Локальная библиотека · без аккаунта</div></div><div class="setting-value">2.2.0</div></div></div>
  </section>`;
  $('settingsFolders').onclick = openFolderSheet;
  $('addFolder').onclick = pickFolder;
  $('formats').onclick = () => showToast('Поддерживаются MP3, M4A, M4B, AAC, OGG, OPUS, FLAC, WAV и WMA');
  $('themeSetting').onclick = toggleTheme;
  document.querySelectorAll('[data-setting-toggle]').forEach(el => el.onclick = async () => {
    const k = el.dataset.settingToggle;
    state.settings[k] = !state.settings[k];
    await persist();
    renderSettings();
  });
}

export async function toggleTheme(){
  state.settings.theme = state.settings.theme==='dark'?'light':'dark';
  document.documentElement.dataset.theme = state.settings.theme;
  await persist();
  renderSettings();
}
