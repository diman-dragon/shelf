/* ui.js — Playlists, Settings (screens + their modals) */
import { state, icon, escapeHtml, plural, uid, $, main } from './state.js';
import { persist } from './storage.js';
import { showToast, openModal, closeModal, settingToggle, iconBtn } from './ui-utils.js';
import { header } from './header.js';
import { act } from './router.js';
import { openFolderSheet, pickFolder } from './scanner.js';

export function renderPlaylists(){
  const ps = state.playlists;
  main.innerHTML = `<section class="screen">${header('Плейлисты','Подборки и закладки', iconBtn('plus','Новый плейлист','newPlaylist'))}<div class="playlists">${ps.map(p=>`<div class="playlist" data-pl="${escapeHtml(p.id)}"><div class="playlist-art">${p.emoji||'♫'}</div><div class="playlist-info"><div class="playlist-name">${escapeHtml(p.name)}</div><div class="playlist-count">${(p.bookIds||[]).length} ${plural((p.bookIds||[]).length,'аудиокнига','аудиокниги','аудиокниг')}</div></div>${icon('chevron')}</div>`).join('')}</div></section>`;
  document.querySelectorAll('.playlist[data-pl]').forEach(el => el.onclick = () => openPlaylist(el.dataset.pl));
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

async function togglePlaylistBook(pid, bid){
  const p = state.playlists.find(x => x.id === pid);
  if(!p) return;
  p.bookIds = p.bookIds || [];
  p.bookIds.includes(bid) ? p.bookIds = p.bookIds.filter(x => x !== bid) : p.bookIds.push(bid);
  await persist();
}

function openPlaylist(id){
  const p = state.playlists.find(x => x.id === id);
  if(!p) return;
  const books = (p.bookIds || []).map(bid => state.books.find(b => b.id === bid)).filter(Boolean);
  openModal(`<h3>${escapeHtml(p.name)}</h3>${books.length?books.map(b=>`<div class="modal-row" data-pl-book="${b.id}"><div style="flex:1"><b>${escapeHtml(b.title)}</b><div style="font-size:11px;color:var(--muted)">${escapeHtml(b.author||'')}</div></div>${icon('chevron')}</div>`).join(''):`<div style="padding:22px 5px;color:var(--muted);text-align:center">В этом плейлисте пока ничего нет.</div>`}<div class="modal-actions"><button class="secondary" data-close>Закрыть</button></div>`);
  document.querySelectorAll('[data-pl-book]').forEach(el => el.onclick = () => { closeModal(); act('openPlayer', el.dataset.plBook); });
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
      ${settingToggle('autoscan','Автосканирование','Проверять выбранные папки при запуске',!!s.autoscan,'refresh')}
    </div>
    <div class="settings-group"><p class="settings-title">Внешний вид</p>
      <div class="setting" id="themeSetting"><div class="setting-icon">${icon(s.theme==='dark'?'moon':'sun')}</div><div class="setting-main"><div class="setting-name">Тема оформления</div><div class="setting-desc">Тёмная или светлая тема</div></div><div class="setting-value">${s.theme==='dark'?'Тёмная':'Светлая'}</div></div>
    </div>
    <div class="settings-group"><p class="settings-title">О приложении</p><div class="setting"><div class="setting-icon">${icon('info')}</div><div class="setting-main"><div class="setting-name">AudioShelf</div><div class="setting-desc">Локальная библиотека · без аккаунта</div></div><div class="setting-value">${escapeHtml(state.appVersion || '—')}</div></div></div>
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

async function toggleTheme(){
  state.settings.theme = state.settings.theme==='dark'?'light':'dark';
  document.documentElement.dataset.theme = state.settings.theme;
  await persist();
  renderSettings();
}
