/* library.js — Library screen, Filtering, Sorting, Book management */
import { state, icon, escapeHtml, durationOfBook, plural, isMusic, partsCount, $, main } from './state.js';
import { saveBooks } from './storage.js';
import { showToast, closeModal, openModal, iconBtn, bookCover, kindBadge, fmt } from './ui-utils.js';
import { header } from './header.js';
import { progress } from './progress.js';
import { render, act } from './router.js';
import { openFolderSheet, scanDock } from './scanner.js';
import { hydrateLibraryCovers } from './meta.js';
import { t, getLang } from './i18n.js';

let libraryDisplayLimit = 50;

/** Books after search + sort, and the part of them that is drawn right now (long libraries are paged) */
function visibleBooks(){
  const all = sortBooks(filterBooks(state.books));
  const limit = all.length > 100 ? Math.min(all.length, libraryDisplayLimit) : all.length;
  return { all, shown: all.slice(0, limit) };
}

function shelfSubtitle(){
  const totalBooks = state.books.length;
  const music = state.books.filter(isMusic).length, books = totalBooks - music;
  let totalProg = 0;
  if(totalBooks > 0){
    // computed fresh every time: a cached value went stale as soon as progress or durations changed
    totalProg = Math.round(state.books.reduce((acc, b) => acc + progress(b), 0) / totalBooks);
  }
  const parts = [];
  if(books || !music) parts.push(`${books} ${plural(books,'книга','книги','книг')}`);
  if(music) parts.push(`${music} ${plural(music,'альбом','альбома','альбомов')}`);
  return `<span style="display:inline-flex;align-items:center;gap:6px">${icon('book')} ${parts.join(' &middot; ')} &middot; ${t('Общий прогресс')}: ${totalProg}%</span>`;
}

function loadMoreHtml(total, shownCount){
  return shownCount < total
    ? `<div id="loadMoreBooks" style="text-align:center;padding:16px;color:var(--gold2);cursor:pointer;font-size:13px">${t('Загрузить ещё')} (${total - shownCount})...</div>`
    : '';
}

function bindLoadMore(){
  const btn = $('loadMoreBooks');
  if(btn) btn.onclick = () => { libraryDisplayLimit += 50; renderShelf(); };
}

export function renderShelf(){
  const { all, shown } = visibleBooks();
  const viewMode = localStorage.getItem('shelfViewMode') || 'list';
  const viewToggleIcon = viewMode === 'grid' ? 'list' : 'grid';
  const viewToggleLabel = t(viewMode === 'grid' ? 'Список' : 'Плитка');

  let html = `<section class="screen shelf-screen library-screen">`;
  html += header(t('Библиотека'), shelfSubtitle(), `${iconBtn('filter',t('Фильтр'),'openLibraryFilter')}${iconBtn('sort',t('Сортировка'),'openSort')}${iconBtn(viewToggleIcon,viewToggleLabel,'toggleShelfView')}${iconBtn('folderPlus',t('Добавить в библиотеку'),'openAddSheet')}`);
  if(state.query){
    html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:12px;color:var(--muted)"><span>${t('Результаты поиска')}: «<b>${escapeHtml(state.query)}</b>»</span><button id="clearSearch" style="background:none;border:none;color:var(--gold2);cursor:pointer">${t('Сбросить')}</button></div>`;
  }
  html += `<div class="library-filters-bar">` +
    `<button type="button" class="filter-chip ${state.libraryFilterType==='all'?'active':''}" data-filter="all">${t('Все')} (${state.books.length})</button>` +
    `<button type="button" class="filter-chip ${state.libraryFilterType==='book'?'active':''}" data-filter="book">${t('Книги')}</button>` +
    `<button type="button" class="filter-chip ${state.libraryFilterType==='album'?'active':''}" data-filter="album">${t('Музыка')}</button>` +
  `</div>`;
  html += `<div class="${viewMode === 'grid' ? 'shelf-grid' : 'shelf-list'}">`;
  if(!all.length){
    html += `<div class="shelf-empty"><div><div class="empty-art">▥</div><div>${t('Библиотека пока пуста')}</div><div style="font-size:12px;margin-top:5px">${t('Добавьте папку с аудиокнигами или музыкой.')}</div><button id="emptyAdd">${t('Добавить в библиотеку')}</button></div></div>`;
  } else {
    html += shown.map(libraryBookRow).join('');
  }
  html += `</div><div id="loadMoreHost">${loadMoreHtml(all.length, shown.length)}</div>${state.scan?.active ? scanDock() : ''}</section>`;
  main.innerHTML = html;
  $('emptyAdd')?.addEventListener('click', openFolderSheet);
  $('clearSearch')?.addEventListener('click', () => { state.query = ''; libraryDisplayLimit = 50; render(); });
  bindLoadMore();
  bindShelfList();

  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.onclick = () => {
      state.libraryFilterType = btn.dataset.filter;
      libraryDisplayLimit = 50;
      renderShelf();
    };
  });
  const viewBtn = document.querySelector('[data-action="toggleShelfView"]');
  if(viewBtn){
    viewBtn.onclick = () => {
      const current = localStorage.getItem('shelfViewMode') || 'list';
      const next = current === 'grid' ? 'list' : 'grid';
      localStorage.setItem('shelfViewMode', next);
      renderShelf();
    };
  }

  // books scanned by an older version have no cover yet — load them quietly in the background
  hydrateLibraryCovers(shown);
}

/** One delegated handler for the whole list: rows can be added/removed without re-binding anything */
function bindShelfList(){
  const list = document.querySelector('.shelf-list, .shelf-grid');
  if(list) list.onclick = e => {
    const el = e.target.closest('.library-book-item');
    if(el) act('openPlayer', el.dataset.id);
  };
}

/** What a row looks like — if this string is unchanged, the row's DOM is left alone */
function rowSig(b){
  return [b.title, b.author, b.files?.length || 0, durationOfBook(b), b.cover ? b.cover.length : 0, Math.round(progress(b) * 10), b.finished ? 1 : 0, isMusic(b) ? 1 : 0].join('|');
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
  const list = document.querySelector('.shelf-list, .shelf-grid');
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
      <div class="lib-thumb">${bookCover(b)}${kindBadge(b)}</div>
      <div class="lib-info">
        <div class="lib-title">${escapeHtml(b.title)}</div>
        <div class="lib-author">${escapeHtml(b.author||t('Автор не указан'))}</div>
        <div class="lib-meta">${fileCount} ${partsCount(b, fileCount)} &middot; ${totalDuration > 0 ? fmt(totalDuration) : '—'}${b.finished ? ` &middot; <span class="lib-done">${t('прослушано')}</span>` : ''}</div>
      </div>
    </div>
    <div class="lib-progress-line"><i style="width:${prog}%"></i></div>
  </div>`;
}

function filterBooks(books){
  const q = state.query.trim().toLowerCase();
  let filtered = books;
  if(state.libraryFilterType === 'book'){
    filtered = filtered.filter(b => !isMusic(b));
  } else if(state.libraryFilterType === 'album'){
    filtered = filtered.filter(isMusic);
  }
  if(!q) return filtered;
  return filtered.filter(b => (b.title||'').toLowerCase().includes(q) || (b.author||'').toLowerCase().includes(q));
}

function sortBooks(books){
  const copy = [...books];
  const s = state.librarySort;
  if(s === 'title') copy.sort((a,b) => (a.title||'').localeCompare(b.title||'', getLang()));
  else if(s === 'author') copy.sort((a,b) => (a.author||'').localeCompare(b.author||'', getLang()));
  else if(s === 'duration') copy.sort((a,b) => durationOfBook(b) - durationOfBook(a));
  else copy.sort((a,b) => (b.added||0) - (a.added||0));
  return copy;
}

export function openLibraryFilter(){
  openModal(`<h3>${t('Поиск и фильтр')}</h3><input class="field" id="libSearchInput" placeholder="${t('Название или автор')}" value="${escapeHtml(state.query)}"><div class="modal-actions"><button class="secondary" data-close>${t('Закрыть')}</button><button class="primary" id="libSearchBtn">${t('Найти')}</button></div>`);
  $('libSearchBtn').onclick = () => {
    state.query = $('libSearchInput').value;
    libraryDisplayLimit = 50;
    closeModal();
    render();
  };
}

export function openSort(){
  const sorts = [['recent',t('Сначала новые')],['title',t('По названию')],['author',t('По автору')],['duration',t('По длительности')]];
  openModal(`<h3>${t('Сортировка')}</h3>${sorts.map(([id,name])=>`<div class="modal-row" data-sort="${id}"><span style="flex:1">${name}</span>${state.librarySort===id?'✓':''}</div>`).join('')}`);
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
  openModal(`<h3>${escapeHtml(b.title)}</h3><div class="modal-row" id="menuRename"><span>✏ ${t('Переименовать')}</span></div><div class="modal-row danger" id="menuDelete"><span>🗑 ${t('Удалить из библиотеки')}</span></div><div class="modal-actions"><button class="secondary" data-close>${t('Закрыть')}</button></div>`);
  $('menuRename').onclick = () => { closeModal(); renameBook(b.id); };
  $('menuDelete').onclick = () => { closeModal(); deleteBook(b.id); };
}

function renameBook(id){
  const b = state.books.find(x => x.id === id);
  if(!b) return;
  openModal(`<h3>${t('Переименовать')}</h3><input class="field" id="renameInput" value="${escapeHtml(b.title)}"><div class="modal-actions"><button class="secondary" data-close>${t('Отмена')}</button><button class="primary" id="renameSave">${t('Сохранить')}</button></div>`);
  $('renameSave').onclick = async () => {
    const v = $('renameInput').value.trim();
    if(!v) return showToast(t('Введите название'));
    b.title = v;
    await saveBooks();
    closeModal();
    render();
    showToast(t('Переименовано'));
  };
}

function deleteBook(id){
  openModal(`<h3>${t('Удалить из библиотеки?')}</h3><p style="color:var(--muted);font-size:13px">${t('Запись будет удалена из библиотеки. Файлы на устройствах не удаляются.')}</p><div class="modal-actions"><button class="secondary" data-close>${t('Отмена')}</button><button class="primary" id="bookDeleteConfirm" style="background:var(--danger);color:#fff">${t('Удалить')}</button></div>`);
  $('bookDeleteConfirm').onclick = async () => {
    // the deleted book must not keep playing: stops <audio>, the native service queue and its notification
    if(state.current?.id === id) act('unloadCurrent');
    state.books = state.books.filter(x => x.id !== id);
    // deleting from the player menu: there is no player any more — go to the library (and highlight the right tab)
    if(state.screen === 'player') state.screen = 'shelf';
    await saveBooks();
    closeModal();
    render();
    showToast(t('Удалено из библиотеки'));
  };
}

/** The library stays alive on its own: while it is on screen, progress bars, finished marks and covers follow the listening
 *  (and a scan that ends in the background) without leaving and re-entering the tab. Cheap: only changed rows are redrawn. */
let shelfLive = 0;
export function startShelfLive(){
  if(shelfLive) return;
  const tick = () => {
    if(state.screen !== 'shelf' || document.hidden || state.scan?.active) return;
    if(!document.querySelector('.shelf-list, .shelf-grid') || !visibleBooks().shown.length) return;
    updateShelfList();
  };
  shelfLive = setInterval(tick, 2000);
  document.addEventListener('visibilitychange', () => { if(!document.hidden) tick(); });
}
