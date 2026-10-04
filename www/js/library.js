/* library.js — Library screen, Filtering, Sorting, Book management */
import { state, icon, escapeHtml, fmt, durationOfBook, plural, $, main } from './state.js';
import { persist } from './storage.js';
import { showToast, closeModal, openModal, header, iconBtn, bookCover, progress, render } from './ui.js';
import { openPlayer } from './player.js';
import { openPlaylistChooser } from './ui.js';
import { openFolderSheet, scanDock } from './scanner.js';
import { audio } from './sound.js';

export function renderShelf(){
  const books = sortBooks(filterBooks(state.books));
  const totalBooks = state.books.length;
  let totalProg = 0;
  if(totalBooks > 0) {
    const sum = state.books.reduce((acc, b) => acc + progress(b), 0);
    totalProg = Math.round(sum / totalBooks);
  }
  const subtitle = `<span style="display:inline-flex;align-items:center;gap:6px">${icon('book')} ${totalBooks} ${plural(totalBooks,'книга','книги','книг')} &middot; Общий прогресс: ${totalProg}%</span>`;
  let html = `<section class="screen shelf-screen library-screen">`;
  html += header('Библиотека', subtitle, `${iconBtn('filter','Фильтр','openLibraryFilter')}${iconBtn('sort','Сортировка','openSort')}${iconBtn('folderPlus','Добавить книги','openAddSheet')}`);
  if(state.query){
    html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:12px;color:var(--muted)"><span>Результаты поиска: «<b>${escapeHtml(state.query)}</b>»</span><button id="clearSearch" style="background:none;border:none;color:var(--gold2);cursor:pointer">Сбросить</button></div>`;
  }
  html += `<div class="library-vertical-list">`;
  if(!books.length){
    html += `<div class="shelf-empty"><div><div class="empty-art">▥</div><div>Библиотека пока пуста</div><div style="font-size:12px;margin-top:5px">Добавьте папку с аудиокнигами или отдельные файлы.</div><button id="emptyAdd">Добавить книги</button></div></div>`;
  } else {
    html += books.map(libraryBookRow).join('');
  }
  html += `</div>${state.scan?.active ? scanDock() : ''}</section>`;
  main.innerHTML = html;
  $('emptyAdd')?.addEventListener('click', openAddSheet);
  $('clearSearch')?.addEventListener('click', () => { state.query = ''; render(); });
  document.querySelectorAll('.library-book-item').forEach(el => el.onclick = () => openPlayer(el.dataset.id));
}

export const renderLibrary = renderShelf;

export function libraryBookRow(b){
  const prog = progress(b);
  return `<div class="library-book-item" data-id="${escapeHtml(b.id)}">
    <div class="lib-row-main">
      <div class="lib-thumb">${bookCover(b)}</div>
      <div class="lib-info">
        <div class="lib-title">${escapeHtml(b.title)}</div>
        <div class="lib-author">${escapeHtml(b.author||'Автор не указан')}</div>
        <div class="lib-meta">${b.files.length} ${plural(b.files.length,'глава','главы','глав')} &middot; ${fmt(durationOfBook(b))}</div>
      </div>
    </div>
    <div class="lib-progress-line"><i style="width:${prog}%"></i></div>
  </div>`;
}

export function filterBooks(books){
  const q = state.query.trim().toLowerCase();
  if(!q) return books;
  return books.filter(b => (b.title||'').toLowerCase().includes(q) || (b.author||'').toLowerCase().includes(q));
}

export function sortBooks(books){
  const copy = [...books];
  const s = state.librarySort;
  if(s === 'title') copy.sort((a,b) => (a.title||'').localeCompare(b.title||'', 'ru'));
  else if(s === 'author') copy.sort((a,b) => (a.author||'').localeCompare(b.author||'', 'ru'));
  else if(s === 'duration') copy.sort((a,b) => durationOfBook(b) - durationOfBook(a));
  else copy.sort((a,b) => (b.added||0) - (a.added||0));
  return copy;
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

export function openBookMenu(id){
  const b = state.books.find(x => x.id === id);
  if(!b) return;
  openModal(`<h3>${escapeHtml(b.title)}</h3><div class="modal-row" id="menuRename"><span>✏ Переименовать</span></div><div class="modal-row" id="menuPlaylist"><span>+ Добавить в плейлист</span></div><div class="modal-row danger" id="menuDelete"><span>🗑 Удалить из библиотеки</span></div><div class="modal-actions"><button class="secondary" data-close>Закрыть</button></div>`);
  $('menuRename').onclick = () => { closeModal(); renameBook(b.id); };
  $('menuPlaylist').onclick = () => { closeModal(); openPlaylistChooser(b.id); };
  $('menuDelete').onclick = () => { closeModal(); deleteBook(b.id); };
}

export function renameBook(id){
  const b = state.books.find(x => x.id === id);
  if(!b) return;
  openModal(`<h3>Переименовать книгу</h3><input class="field" id="renameInput" value="${escapeHtml(b.title)}"><div class="modal-actions"><button class="secondary" data-close>Отмена</button><button class="primary" id="renameSave">Сохранить</button></div>`);
  $('renameSave').onclick = async () => {
    const v = $('renameInput').value.trim();
    if(!v) return showToast('Введите название');
    b.title = v;
    await persist();
    closeModal();
    render();
    showToast('Книга переименована');
  };
}

export async function deleteBook(id){
  openModal(`<h3>Удалить книгу?</h3><p style="color:var(--muted);font-size:13px">Книга будет удалена из библиотеки. Файлы на устройствах не удаляются.</p><div class="modal-actions"><button class="secondary" data-close>Отмена</button><button class="primary" id="bookDeleteConfirm" style="background:var(--danger);color:#fff">Удалить</button></div>`);
  $('bookDeleteConfirm').onclick = async () => {
    state.books = state.books.filter(x => x.id !== id);
    state.playlists.forEach(p => p.bookIds = (p.bookIds || []).filter(bid => bid !== id));
    if(state.current?.id === id){
      audio.pause();
      if(state.blobUrl){ URL.revokeObjectURL(state.blobUrl); state.blobUrl = ''; }
      state.current = null; state.playing = false;
    }
    await persist();
    closeModal();
    render();
    showToast('Книга удалена');
  };
}
