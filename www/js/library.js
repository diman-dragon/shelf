/* library.js — Library screen, Filtering, Sorting, Book management */
import { state, icon, escapeHtml, durationOfBook, plural, isMusic, partsCount, $, main, plugin } from './state.js';
import { saveBooks } from './storage.js';
import { showToast, closeModal, openModal, iconBtn, bookCover, kindBadge, fmt } from './ui-utils.js';
import { header } from './header.js';
import { progress } from './progress.js';
import { render, act, setScreen } from './router.js';
import { openFolderSheet, scanDock } from './scanner.js';
import { hydrateLibraryCovers } from './meta.js';
import { openSourceInfo, sourceLine, downloads, cancelDownload, downloadBook } from './catalog.js';
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

const catalogTab = () => state.libraryFilterType === 'online';

export function renderShelf(){
  if(state.libraryFilterType === 'saved') state.libraryFilterType = 'all';      // the old «Скачанные» tab is gone: downloaded books sit among books / music
  const { all, shown } = visibleBooks();
  const viewMode = viewModeNow();
  const viewToggleIcon = { list: 'grid', grid: 'shelf', spines: 'list' }[viewMode];
  const viewToggleLabel = t({ list: 'Плитка', grid: 'Полка', spines: 'Список' }[viewMode]);

  let html = `<section class="screen shelf-screen library-screen">`;
  html += header(t('Библиотека'), shelfSubtitle(), `${iconBtn('filter',t('Фильтр'),'openLibraryFilter')}${iconBtn('sort',t('Сортировка'),'openSort')}${iconBtn(viewToggleIcon,viewToggleLabel,'toggleShelfView')}${iconBtn('folderPlus',t('Добавить в библиотеку'),'openAddSheet')}`);
  if(state.query){
    html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:12px;color:var(--muted)"><span>${t('Результаты поиска')}: «<b>${escapeHtml(state.query)}</b>»</span><button id="clearSearch" style="background:none;border:none;color:var(--gold2);cursor:pointer">${t('Сбросить')}</button></div>`;
  }
  html += `<div class="library-filters-bar">` +
    `<button type="button" class="filter-chip ${state.libraryFilterType==='all'?'active':''}" data-filter="all">${t('Все')} (${state.books.length})</button>` +
    `<button type="button" class="filter-chip ${state.libraryFilterType==='book'?'active':''}" data-filter="book">${t('Книги')}</button>` +
    `<button type="button" class="filter-chip ${state.libraryFilterType==='album'?'active':''}" data-filter="album">${t('Музыка')}</button>` +
    `<button type="button" class="filter-chip ${state.libraryFilterType==='online'?'active':''}" data-filter="online">${t('Онлайн')}</button>` +
  `</div>`;
  html += `<div class="${{ grid: 'shelf-grid', spines: 'shelf-spines', list: 'shelf-list' }[viewMode]}">`;
  if(!all.length){
    html += `<div class="shelf-empty"><div><div class="empty-art">▥</div><div>${t(catalogTab() ? 'Здесь пока ничего нет' : 'Библиотека пока пуста')}</div><div style="font-size:12px;margin-top:5px">${t(catalogTab() ? 'Книги из каталога появятся здесь.' : 'Добавьте папку с аудиокнигами или музыкой.')}</div><button id="emptyAdd">${t(catalogTab() ? 'Открыть каталог' : 'Добавить в библиотеку')}</button></div></div>`;
  } else {
    html += viewMode === 'spines' ? spinesHtml(shown) : shown.map(libraryBookRow).join('');
  }
  html += `</div><div id="loadMoreHost">${loadMoreHtml(all.length, shown.length)}</div>${state.scan?.active ? scanDock() : ''}</section>`;
  main.innerHTML = html;
  $('emptyAdd')?.addEventListener('click', () => { if(catalogTab()) setScreen('catalog'); else openFolderSheet(); });
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
      const next = { list: 'grid', grid: 'spines', spines: 'list' }[viewModeNow()];
      localStorage.setItem('shelfViewMode', next);
      renderShelf();
    };
  }

  // books scanned by an older version have no cover yet — load them quietly in the background
  hydrateLibraryCovers(shown);
}

const viewModeNow = () => { let v = 'list'; try { v = localStorage.getItem('shelfViewMode') || 'list'; } catch {} return ['list', 'grid', 'spines'].includes(v) ? v : 'list'; };

/* ---------------- the shelf: books stand on planks as spines ---------------- */
const SPINE_COLORS = ['#7a2230', '#1f4563', '#c99a2e', '#5c6b2f', '#4c2b57', '#3b4750', '#8a4b22', '#2d5a52'];
const hashOf = str => { let h = 7; for(const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const spineGeom = b => {
  const h = hashOf(b.id), hrs = durationOfBook(b) / 3600;
  return { color: SPINE_COLORS[h % SPINE_COLORS.length], height: 128 + (h >> 3) % 44, width: Math.round(Math.max(30, Math.min(54, 30 + hrs * 1.5))) };
};
function spinesHtml(books){
  const room = Math.max(240, (main?.clientWidth || window.innerWidth || 390) - 32);
  const rows = []; let row = [], used = 0;
  for(const b of books){
    const g = spineGeom(b);
    if(row.length && used + g.width + 3 > room){ rows.push(row); row = []; used = 0; }
    row.push([b, g]); used += g.width + 3;
  }
  if(row.length) rows.push(row);
  return rows.map(r => `<div class="spine-row">${r.map(([b, g]) => {
    const prog = Math.round(progress(b) * 100);
    return `<button type="button" class="spine-item${b.online ? ' is-online' : ''}${b.finished ? ' is-done' : ''}" data-id="${escapeHtml(b.id)}" style="--c:${g.color};height:${g.height}px;width:${g.width}px" aria-label="${escapeHtml(b.title)}">
      ${isMusic(b) ? `<i class="sp-disc"></i>` : ''}${b.source && !b.online ? `<i class="sp-dl"></i>` : ''}<span class="sp-title">${escapeHtml(b.title)}</span><span class="sp-prog"><i style="width:${prog}%"></i></span></button>`;
  }).join('')}</div><div class="plank"></div>`).join('');
}

/** One delegated handler for the whole list: rows can be added/removed without re-binding anything.
 *  A tap opens the player; the ⋯ button or a long press opens the book menu (remove, delete from disk, download, source). */
function bindShelfList(){
  const list = document.querySelector('.shelf-list, .shelf-grid, .shelf-spines');
  if(!list) return;
  let timer = 0, fired = false, sx = 0, sy = 0;
  const idOf = e => e.target.closest('[data-id]')?.dataset.id;
  list.onclick = e => {
    if(fired){ fired = false; return; }
    const m = e.target.closest('[data-book-menu]');
    if(m){ e.stopPropagation(); openBookMenu(m.closest('[data-id]').dataset.id); return; }
    const el = e.target.closest('.library-book-item, .spine-item');
    if(el) act('openPlayer', el.dataset.id);
  };
  list.onpointerdown = e => {
    const id = idOf(e); if(!id || e.target.closest('[data-book-menu]')) return;
    sx = e.clientX; sy = e.clientY; fired = false;
    clearTimeout(timer); timer = setTimeout(() => { fired = true; try { navigator.vibrate?.(15); } catch {} openBookMenu(id); }, 550);
  };
  const cancel = () => clearTimeout(timer);
  list.onpointermove = e => { if(Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8) cancel(); };
  list.onpointerup = cancel; list.onpointercancel = cancel;
  list.oncontextmenu = e => { const id = idOf(e); if(id){ e.preventDefault(); fired = true; openBookMenu(id); } };
}

/** What a row looks like — if this string is unchanged, the row's DOM is left alone */
function rowSig(b){
  return [b.title, b.author, b.files?.length || 0, durationOfBook(b), b.cover ? b.cover.length : 0, Math.round(progress(b) * 10), b.finished ? 1 : 0, isMusic(b) ? 1 : 0, b.source ? (b.online ? 'o' : 'd') : '', downloads.has(b.id) ? 'dl' : ''].join('|');
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
  const list = document.querySelector('.shelf-list, .shelf-grid');           // the shelf (spines) view is simply redrawn
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
      <div class="lib-thumb">${bookCover(b)}${kindBadge(b)}${b.source && !b.online ? `<span class="dl-badge" aria-label="${t('Скачано')}">${icon('download', 'icon dl-ico')}</span>` : ''}</div>
      <div class="lib-info">
        <div class="lib-title">${escapeHtml(b.title)}</div>
        <div class="lib-author">${escapeHtml(b.author||t('Автор не указан'))}</div>
        <div class="lib-meta">${fileCount} ${partsCount(b, fileCount)} &middot; ${totalDuration > 0 ? fmt(totalDuration) : '—'}${b.finished ? ` &middot; <span class="lib-done">${t('прослушано')}</span>` : ''}</div>
        ${b.source ? `<div class="lib-meta lib-lic">${escapeHtml(sourceLine(b))}${downloads.has(b.id) ? ` &middot; ${t('скачивается')}…` : ''}</div>` : ''}
      </div>
    </div>
    <button type="button" class="lib-more" data-book-menu aria-label="${t('Меню книги')}">⋯</button>
    <div class="lib-progress-line"><i style="width:${prog}%"></i></div>
  </div>`;
}

function filterBooks(books){
  const q = state.query.trim().toLowerCase();
  let filtered = books;
  // downloaded catalog books are ordinary books / albums (marked with a small icon); the ones streamed from the internet have their own tab
  if(state.libraryFilterType === 'book'){
    filtered = filtered.filter(b => !isMusic(b) && !b.online);
  } else if(state.libraryFilterType === 'album'){
    filtered = filtered.filter(b => isMusic(b) && !b.online);
  } else if(state.libraryFilterType === 'online'){           // catalog books that are listened to over the internet
    filtered = filtered.filter(b => b.source && b.online);
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
  const dl = downloads.has(b.id);
  openModal(`<h3>${escapeHtml(b.title)}</h3>${b.source ? `<div class="modal-row" id="menuSource"><span>ⓘ ${t('Источник и лицензия')}</span></div>` : ''}${b.source && b.online && !dl ? `<div class="modal-row" id="menuDownload"><span>⬇ ${t('Скачать')}</span></div>` : ''}${dl ? `<div class="modal-row" id="menuStop"><span>⏹ ${t('Остановить скачивание')}</span></div>` : ''}<div class="modal-row" id="menuRename"><span>✏ ${t('Переименовать')}</span></div><div class="modal-row danger" id="menuDelete"><span>🗑 ${t('Удалить…')}</span></div><div class="modal-actions"><button class="secondary" data-close>${t('Закрыть')}</button></div>`);
  $('menuSource')?.addEventListener('click', () => { closeModal(); openSourceInfo(b.id); });
  $('menuDownload')?.addEventListener('click', () => { closeModal(); downloadBook(b.id); });
  $('menuStop')?.addEventListener('click', () => { closeModal(); cancelDownload(b.id); });
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
  const bk = state.books.find(x => x.id === id);
  if(!bk) return;
  const uris = (bk.files || []).map(f => f.uri).filter(u => typeof u === 'string' && u.startsWith('content:'));
  const canDisk = uris.length > 0 && !!plugin('ShelfFiles')?.deleteFile;
  openModal(`<h3>${t('Удалить книгу?')}</h3><p style="color:var(--muted);font-size:13px">${escapeHtml(bk.title)}</p>
    <div class="modal-row" id="bookHide"><span style="flex:1">${t('Убрать из библиотеки')}<small style="display:block;color:var(--muted)">${t(bk.online ? 'Это запись о книге, на телефоне ничего не хранится' : 'Файлы останутся на телефоне')}</small></span></div>
    ${canDisk ? `<div class="modal-row" id="bookErase" style="color:var(--danger)"><span style="flex:1">${t('Удалить с диска')}<small style="display:block;color:var(--muted)">${t('Файлы книги будут удалены с телефона насовсем')}</small></span></div>` : ''}
    <div class="modal-actions"><button class="secondary" data-close>${t('Отмена')}</button></div>`);
  $('bookHide').onclick = () => { closeModal(); dropBook(id, false); };
  if(canDisk) $('bookErase').onclick = () => {
    openModal(`<h3>${t('Удалить файлы насовсем?')}</h3><p style="color:var(--muted);font-size:13px">${escapeHtml(bk.title)}<br>${t('Вернуть их будет нельзя.')}</p><div class="modal-actions"><button class="secondary" data-close>${t('Отмена')}</button><button class="primary" id="bookEraseGo" style="background:var(--danger);color:#fff">${t('Удалить')}</button></div>`);
    $('bookEraseGo').onclick = () => { closeModal(); dropBook(id, true); };
  };
}

async function dropBook(id, fromDisk){
  const bk = state.books.find(x => x.id === id);
  if(!bk) return;
  if(downloads.has(id)) cancelDownload(id);
  if(state.current?.id === id) act('unloadCurrent');           // stops <audio>, the native queue and its notification (also frees the files)
  if(fromDisk){
    const files = (bk.files || []).filter(f => typeof f.uri === 'string' && f.uri.startsWith('content:'));
    let failed = 0, denied = false;
    for(const f of files){
      try { await plugin('ShelfFiles').deleteFile({ uri: f.uri, dropEmptyDir: !!bk.downloadedAt }); }
      catch(e){ failed++; if(String(e?.message || e).includes('denied')) denied = true; }
    }
    if(failed){
      showToast(t(denied ? 'Нет права на удаление: добавьте папку заново (Настройки → Ваши папки)' : 'Не удалось удалить часть файлов'));
      if(failed === files.length) return;                      // nothing was deleted: keep the book
    }
  }
  state.books = state.books.filter(x => x.id !== id);
  if(state.screen === 'player') state.screen = 'shelf';
  await saveBooks();
  render();
  showToast(t(fromDisk ? 'Книга удалена с телефона' : 'Удалено из библиотеки'));
}

/** The library stays alive on its own: while it is on screen, progress bars, finished marks and covers follow the listening
 *  (and a scan that ends in the background) without leaving and re-entering the tab. Cheap: only changed rows are redrawn. */
let shelfLive = 0;
export function startShelfLive(){
  if(shelfLive) return;
  // never redraw rows under a finger: a row replaced between touch-down and touch-up loses the tap
  let touching = 0;
  const down = () => { touching = Infinity; };
  const up = () => { touching = Date.now() + 500; };
  document.addEventListener('touchstart', down, { passive: true, capture: true });
  document.addEventListener('touchend', up, { passive: true, capture: true });
  document.addEventListener('touchcancel', up, { passive: true, capture: true });
  const tick = () => {
    if(state.screen !== 'shelf' || document.hidden || state.scan?.active || Date.now() < touching) return;
    if(!document.querySelector('.shelf-list, .shelf-grid') || !visibleBooks().shown.length) return;
    updateShelfList();
  };
  shelfLive = setInterval(tick, 2000);
  document.addEventListener('visibilitychange', () => { if(!document.hidden) tick(); });
}
