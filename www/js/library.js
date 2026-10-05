/* library.js — Library screen, Filtering, Sorting, Book management */
import { state, icon, escapeHtml, durationOfBook, plural, $, main } from './state.js';
import { persist } from './storage.js';
import { showToast, closeModal, openModal, iconBtn, bookCover, fmt } from './ui-utils.js';
import { header } from './header.js';
import { progress } from './progress.js';
import { render, act } from './router.js';
import { openPlaylistChooser } from './ui.js';
import { openFolderSheet, scanDock } from './scanner.js';
import { hydrateLibraryCovers } from './meta.js';

let libraryDisplayLimit = 50;

/** Books after search + sort, and the part of them that is drawn right now (long libraries are paged) */
function visibleBooks(){
  const all = sortBooks(filterBooks(state.books));
  const limit = all.length > 100 ? Math.min(all.length, libraryDisplayLimit) : all.length;
  return { all, shown: all.slice(0, limit) };
}

function shelfSubtitle(){
  const totalBooks = state.books.length;
  let totalProg = 0;
  if(totalBooks > 0){
    // computed fresh every time: a cached value went stale as soon as progress or durations changed
    totalProg = Math.round(state.books.reduce((acc, b) => acc + progress(b), 0) / totalBooks);
  }
  return `<span style="display:inline-flex;align-items:center;gap:6px">${icon('book')} ${totalBooks} ${plural(totalBooks,'книга','книги','книг')} &middot; Общий прогресс: ${totalProg}%</span>`;
}

function loadMoreHtml(total, shownCount){
  return shownCount < total
    ? `<div id="loadMoreBooks" style="text-align:center;padding:16px;color:var(--gold2);cursor:pointer;font-size:13px">Загрузить ещё (${total - shownCount})...</div>`
    : '';
}

function bindLoadMore(){
  const btn = $('loadMoreBooks');
  if(btn) btn.onclick = () => { libraryDisplayLimit += 50; renderShelf(); };
}

export function renderShelf(){
  const { all, shown } = visibleBooks();
  let html = `<section class="screen shelf-screen library-screen">`;
  html += header('Библиотека', shelfSubtitle(), `${iconBtn('filter','Фильтр','openLibraryFilter')}${iconBtn('sort','Сортировка','openSort')}${iconBtn('folderPlus','Добавить книги','openAddSheet')}`);
  if(state.query){
    html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:12px;color:var(--muted)"><span>Результаты поиска: «<b>${escapeHtml(state.query)}</b>»</span><button id="clearSearch" style="background:none;border:none;color:var(--gold2);cursor:pointer">Сбросить</button></div>`;
  }
  html += `<div class="library-vertical-list">`;
  if(!all.length){
    html += `<div class="shelf-empty"><div><div class="empty-art">▥</div><div>Библиотека пока пуста</div><div style="font-size:12px;margin-top:5px">Добавьте папку с аудиокнигами или отдельные файлы.</div><button id="emptyAdd">Добавить книги</button></div></div>`;
  } else {
    html += shown.map(libraryBookRow).join('');
  }
  html += `</div><div id="loadMoreHost">${loadMoreHtml(all.length, shown.length)}</div>${state.scan?.active ? scanDock() : ''}</section>`;
  main.innerHTML = html;
  $('emptyAdd')?.addEventListener('click', openFolderSheet);
  $('clearSearch')?.addEventListener('click', () => { state.query = ''; libraryDisplayLimit = 50; render(); });
  bindLoadMore();
  bindShelfList();

  // books scanned by an older version have no cover yet — load them quietly in the background
  hydrateLibraryCovers(shown);
}

/** One delegated handler for the whole list: rows can be added/removed without re-binding anything */
function bindShelfList(){
  const list = document.querySelector('.library-vertical-list');
  if(list) list.onclick = e => {
    const el = e.target.closest('.library-book-item');
    if(el) act('openPlayer', el.dataset.id);
  };
}

/** What a row looks like — if this string is unchanged, the row's DOM is left alone */
function rowSig(b){
  return [b.title, b.author, b.files?.length || 0, durationOfBook(b), b.cover ? b.cover.length : 0, Math.round(progress(b) * 10), b.finished ? 1 : 0].join('|');
}

function rowEl(b, sig){
  const t = document.createElement('template');
  t.innerHTML = libraryBookRow(b, sig).trim();
  return t.content.firstElementChild;
}

/**
 * Incremental refresh used while a scan is running. The old code rebuilt main.innerHTML every 280 ms, which threw away
 * the scroll position and was O(n) DOM work per tick. Here existing rows are kept (matched by book id) and only new
 * / changed / removed ones are touched.
 */
export function updateShelfList(){
  if(state.screen !== 'shelf') return;
  const list = document.querySelector('.library-vertical-list');
  const { all, shown } = visibleBooks();
  if(!list || !shown.length || list.querySelector('.shelf-empty')){ renderShelf(); return; }

  const existing = new Map();
  list.querySelectorAll(':scope > .library-book-item').forEach(el => existing.set(el.dataset.id, el));
  let cursor = list.firstElementChild;
  for(const b of shown){
    const old = existing.get(b.id);
    const sig = rowSig(b);
    let el = old;
    if(!old || old.dataset.sig !== sig){
      el = rowEl(b, sig);
      if(old){ if(cursor === old) cursor = el; old.replaceWith(el); }
    }
    existing.delete(b.id);
    if(el === cursor) cursor = cursor.nextElementSibling;
    else list.insertBefore(el, cursor);
  }
  existing.forEach(el => el.remove());

  const host = $('loadMoreHost');
  if(host){ host.innerHTML = loadMoreHtml(all.length, shown.length); bindLoadMore(); }
  const sub = $('headerSubtitle');
  if(sub) sub.innerHTML = shelfSubtitle();
  bindShelfList();
  hydrateLibraryCovers(shown);
}

function libraryBookRow(b, sig = rowSig(b)){
  const prog = progress(b);
  const fileCount = b.files?.length ?? 0;
  const totalDuration = durationOfBook(b);
  return `<div class="library-book-item" data-id="${escapeHtml(b.id)}" data-sig="${escapeHtml(sig)}">
    <div class="lib-row-main">
      <div class="lib-thumb">${bookCover(b)}</div>
      <div class="lib-info">
        <div class="lib-title">${escapeHtml(b.title)}</div>
        <div class="lib-author">${escapeHtml(b.author||'Автор не указан')}</div>
        <div class="lib-meta">${fileCount} ${plural(fileCount,'глава','главы','глав')} &middot; ${totalDuration > 0 ? fmt(totalDuration) : '—'}${b.finished ? ' &middot; <span class="lib-done">прослушано</span>' : ''}</div>
      </div>
    </div>
    <div class="lib-progress-line"><i style="width:${prog}%"></i></div>
  </div>`;
}

function filterBooks(books){
  const q = state.query.trim().toLowerCase();
  if(!q) return books;
  return books.filter(b => (b.title||'').toLowerCase().includes(q) || (b.author||'').toLowerCase().includes(q));
}

function sortBooks(books){
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
    libraryDisplayLimit = 50;
    closeModal();
    render();
  };
}

export function openSort(){
  const sorts = [['recent','Сначала новые'],['title','По названию'],['author','По автору'],['duration','По длительности']];
  openModal(`<h3>Сортировка</h3>${sorts.map(([id,name])=>`<div class="modal-row" data-sort="${id}"><span style="flex:1">${name}</span>${state.librarySort===id?'✓':''}</div>`).join('')}`);
  document.querySelectorAll('[data-sort]').forEach(el => el.onclick = () => {
    state.librarySort = el.dataset.sort;
    libraryDisplayLimit = 50;
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

function renameBook(id){
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

function deleteBook(id){
  openModal(`<h3>Удалить книгу?</h3><p style="color:var(--muted);font-size:13px">Книга будет удалена из библиотеки. Файлы на устройствах не удаляются.</p><div class="modal-actions"><button class="secondary" data-close>Отмена</button><button class="primary" id="bookDeleteConfirm" style="background:var(--danger);color:#fff">Удалить</button></div>`);
  $('bookDeleteConfirm').onclick = async () => {
    // the deleted book must not keep playing: stops <audio>, the native service queue and its notification
    if(state.current?.id === id) act('unloadCurrent');
    state.books = state.books.filter(x => x.id !== id);
    state.playlists.forEach(p => p.bookIds = (p.bookIds || []).filter(bid => bid !== id));
    // deleting from the player menu: there is no player any more — go to the library (and highlight the right tab)
    if(state.screen === 'player') state.screen = 'shelf';
    await persist();
    closeModal();
    render();
    showToast('Книга удалена');
  };
}
