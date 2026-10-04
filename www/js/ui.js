/* ui.js — UI helpers, Modals, Settings, Playlists, Filters */
import { state, icon, escapeHtml, fmt, durationOfBook, uid, plural, $, main, modalRoot } from './state.js';
import { persist } from './storage.js';
import { openFolderSheet, pickFolder, openAddSheet } from './scanner.js';
import { applyAudioSettings } from './sound.js';
import { openPlayer } from './player.js';
import { renderShelf } from './library.js';
import { renderPlayer, loadChapter, updateMiniPlayer } from './player.js';

let toastTimer;
let navDelegationReady = false;

export function showToast(msg){
  clearTimeout(toastTimer);
  const t = $('toast');
  if(!t) return;
  t.textContent = msg;
  t.classList.add('show');
  toastTimer = setTimeout(()=>t.classList.remove('show'), 2300);
}

export function openModal(body){
  modalRoot.innerHTML = `<div class="modal-back" id="modalBack"><div class="modal">${body}</div></div>`;
  $('modalBack').addEventListener('click', e => {
    if(e.target.id === 'modalBack' || e.target.closest('[data-close]')) closeModal();
  });
}

export function closeModal(){ modalRoot.innerHTML = ''; }

export function header(title, subtitle, actions=''){
  return `<div class="topbar"><div><h2>${title}</h2>${subtitle?`<p>${subtitle}</p>`:''}</div><div class="top-actions">${actions}</div></div>`;
}

export function bookCover(b, extra=''){
  const title = escapeHtml(b.title || 'Без названия');
  const author = escapeHtml(b.author || '');
  const body = b.cover ?
    `<img class="cover-image ${extra}" src="${escapeHtml(b.cover)}" alt="" draggable="false">` :
    `<div class="fallback-cover ${extra}"><div class="cover-title">${title}</div>${author?`<div class="cover-author">${author}</div>`:''}</div>`;
  return `<div class="cover-frame">${body}</div>`;
}

export function progress(b){
  const files = b.files || [];
  if(!files.length) return 0;
  const i = Math.max(0, Math.min(Number(b.pos?.i)||0, files.length-1));
  const t = Math.max(0, Number(b.pos?.t)||0);
  const d = Math.max(0, Number(files[i]?.duration)||0);
  return Math.max(0, Math.min(100, ((i + (d ? t/d : 0)) / files.length) * 100));
}

export function bindNav(){
  if(navDelegationReady) return;
  const root = $('app');
  if(!root) return;
  navDelegationReady = true;
  root.addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]');
    if(nav){ e.preventDefault(); setScreen(nav.dataset.nav); return; }
    const action = e.target.closest('[data-action]');
    if(action){
      e.preventDefault();
      const fn = {openAddSheet, openLibraryFilter, openSort, newPlaylist}[action.dataset.action];
      if(fn) fn();
    }
  }, {passive:false});
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
  updateMiniPlayer();
}

export function renderCurrentPlayer(){
  if(state.current) renderPlayer(); else renderShelf();
}

export function openLibraryFilter(){
  openModal(`<h3>Поиск и фильтр</h3><input class="field" id="libSearchInput" placeholder="Название или автор" value="${escapeHtml(state.query)}"><div class="modal-actions"><button class="secondary" data-close>Закрыть</button><button class="primary" id="libSearchBtn">Найти</button></div>`);
  $('libSearchBtn').onclick = () => {
    state.query = $('libSearchInput').value;
    closeModal();
    render();
  };
}

export function openSort(){
  const sorts = [['recent','Сначала новые'],['title','По названию'],['author','По автору'],['duration','По длительности']];
  openModal(`<h3>Сортировка</h3>${sorts.map(([id,name])=>`<div class="modal-row" data-sort="${id}"><span style="flex:1">${name}</span>${state.librarySort===id?'✓':''}</div>`).join('')}`);
  document.querySelectorAll('[data-sort]').forEach(el => el.onclick = () => {
    state.librarySort = el.dataset.sort;
    closeModal();
    render();
  });
}

export function renderPlaylists(){
  const ps = state.playlists;
  main.innerHTML = `<section class="screen">${header('Плейлисты','Подборки и закладки', iconBtn('plus','Новый плейлист','newPlaylist'))}<div class="playlists">${ps.map(p=>`<div class="playlist" data-pl="${escapeHtml(p.id)}"><div class="playlist-art">${p.emoji||'♫'}</div><div class="playlist-info"><div class="playlist-name">${escapeHtml(p.name)}</div><div class="playlist-count">${(p.bookIds||[]).length} ${plural((p.bookIds||[]).length,'аудиокнига','аудиокниги','аудиокниг')}</div></div>${icon('chevron')}</div>`).join('')}</div></section>`;
  document.querySelectorAll('.playlist[data-pl]').forEach(el => el.onclick = () => openPlaylist(el.dataset.pl));
  document.querySelectorAll('[data-action="newPlaylist"]').forEach(el => el.onclick = newPlaylist);
}

export function iconBtn(ic, label, action){
  return `<button class="icon-btn" aria-label="${label}" data-action="${action}">${icon(ic)}</button>`;
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
  const volume = Math.round(Math.max(0, Math.min(1, Number(s.volume ?? 1))) * 100);
  const bass = Number(s.bass) || 0, treble = Number(s.treble) || 0;
  main.innerHTML = `<section class="screen">${header('Настройки')}
    <div class="settings-group"><p class="settings-title">Хранилище</p>
      <div class="setting" id="settingsFolders"><div class="setting-icon">${icon('folder')}</div><div class="setting-main"><div class="setting-name">Выбранные папки</div><div class="setting-desc">${folderCount} ${plural(folderCount,'папка','папки','папок')}</div></div><div class="chevron">${icon('chevron')}</div></div>
      <div class="setting" id="addFolder"><div class="setting-icon">${icon('folderPlus')}</div><div class="setting-main"><div class="setting-name">Добавить папку</div><div class="setting-desc">Музыка, Audiobooks, Books и другие</div></div><div class="chevron">${icon('chevron')}</div></div>
    </div>
    <div class="settings-group"><p class="settings-title">Звук</p>
      <div class="sound-setting"><div class="sound-head"><span>${icon('headset')} Громкость</span><b id="volumeValue">${volume}%</b></div><input class="sound-range" id="volumeRange" type="range" min="0" max="100" value="${volume}"></div>
      <div class="sound-setting"><div class="sound-head"><span>Бас</span><b id="bassValue">${bass>0?'+':''}${bass} dB</b></div><input class="sound-range" id="bassRange" type="range" min="-12" max="12" step="1" value="${bass}"></div>
      <div class="sound-setting"><div class="sound-head"><span>Высокие частоты</span><b id="trebleValue">${treble>0?'+':''}${treble} dB</b></div><input class="sound-range" id="trebleRange" type="range" min="-12" max="12" step="1" value="${treble}"></div>
      <button class="secondary sound-reset" id="soundReset">Сбросить настройки звука</button>
    </div>
    <div class="settings-group"><p class="settings-title">Сканирование</p>
      <div class="setting" id="formats"><div class="setting-icon">${icon('music')}</div><div class="setting-main"><div class="setting-name">Форматы аудио</div><div class="setting-desc">MP3, M4A, M4B, AAC, OGG, OPUS, FLAC, WAV, WMA</div></div></div>
      ${settingToggle('autoscan','Автосканирование','Проверять выбранные папки при запуске',!!s.autoscan)}
    </div>
    <div class="settings-group"><p class="settings-title">Внешний вид</p>
      <div class="setting" id="themeSetting"><div class="setting-icon">${icon(s.theme==='dark'?'moon':'sun')}</div><div class="setting-main"><div class="setting-name">Тема</div><div class="setting-desc">Переключить оформление</div></div><div class="setting-value">${s.theme==='dark'?'Тёмная':'Светлая'}</div></div>
      <div class="setting" id="coverSize"><div class="setting-icon">${icon('eye')}</div><div class="setting-main"><div class="setting-name">Размер обложек</div><div class="setting-desc">В библиотеке и списках</div></div><div class="setting-value">${escapeHtml(s.coverSize||'Средний')} ${icon('chevron')}</div></div>
    </div>
    <div class="settings-group"><p class="settings-title">О приложении</p><div class="setting"><div class="setting-icon">${icon('info')}</div><div class="setting-main"><div class="setting-name">AudioShelf</div><div class="setting-desc">Локальная библиотека · без аккаунта</div></div><div class="setting-value">2.2.0</div></div></div>
  </section>`;
  $('settingsFolders').onclick = openFolderSheet;
  $('addFolder').onclick = pickFolder;
  $('formats').onclick = () => showToast('Поддерживаются MP3, M4A, M4B, AAC, OGG, OPUS, FLAC, WAV и WMA');
  $('themeSetting').onclick = toggleTheme;
  $('coverSize').onclick = cycleCoverSize;
  const bindSound = (id, key, format, apply) => {
    const el = $(id);
    if(!el) return;
    el.oninput = async e => {
      state.settings[key] = key === 'volume' ? Number(e.target.value) / 100 : Number(e.target.value);
      $(id.replace('Range','Value')).textContent = format(state.settings[key]);
      apply(state.settings[key]);
      await persist();
    };
  };
  bindSound('volumeRange','volume', v=>`${Math.round(v*100)}%`, applyAudioSettings);
  bindSound('bassRange','bass', v=>`${v>0?'+':''}${v} dB`, applyAudioSettings);
  bindSound('trebleRange','treble', v=>`${v>0?'+':''}${v} dB`, applyAudioSettings);
  $('soundReset').onclick = async () => { state.settings.volume=1; state.settings.bass=0; state.settings.treble=0; applyAudioSettings(); await persist(); renderSettings(); };
  document.querySelectorAll('[data-setting-toggle]').forEach(el => el.onclick = async () => {
    const k = el.dataset.settingToggle;
    state.settings[k] = !state.settings[k];
    await persist();
    renderSettings();
  });
  applyAudioSettings();
}

export function settingToggle(k, name, desc, on){
  return `<div class="setting" data-setting-toggle="${k}"><div class="setting-icon">${icon(k==='autoscan'?'refresh':'eye')}</div><div class="setting-main"><div class="setting-name">${name}</div><div class="setting-desc">${desc}</div></div><div class="switch ${on?'on':''}"><i></i></div></div>`;
}

export function toggleTheme(){
  state.settings.theme = state.settings.theme==='dark'?'light':'dark';
  document.documentElement.dataset.theme = state.settings.theme;
  persist();
  renderSettings();
}

export function cycleCoverSize(){
  const x = ['Маленький','Средний','Большой'];
  let i = x.indexOf(state.settings.coverSize);
  state.settings.coverSize = x[(i+1)%x.length];
  persist();
  renderSettings();
}
