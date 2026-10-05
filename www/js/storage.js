/* storage.js — IndexedDB persistence and playback state
 *
 * Layout in IndexedDB:
 *   books          library WITHOUT covers (small, cheap to rewrite)
 *   cover:<id>     the cover (base64) of one book, written only when it actually changed
 *   progress       { bookId: {i, t, ts, finished} } — playback positions, tiny, written on every play/pause/seek
 *   folders / playlists / settings / foldersSelected
 */
import { state } from './state.js';
import { dbGet, dbSet, dbDel } from './db.js';
import { showToast } from './ui-utils.js';

const LAST_PLAYBACK_KEY = 'shelf:lastPlayback';

const savedCovers = new Map();     // bookId -> cover string that is already stored under cover:<id>
let progressMap = {};

const stripCover = b => { const { cover, ...rest } = b; rest.hasCover = !!cover; return rest; };

/* ---------------- books ---------------- */

export async function loadBooks(){
  const list = (await dbGet('books')) || [];
  await Promise.all(list.map(async b => {
    // legacy records keep the cover inline: it gets moved to its own key by the next saveBooks()
    if(!b.cover && b.hasCover){
      try { b.cover = (await dbGet('cover:' + b.id)) || ''; } catch { b.cover = ''; }
      if(b.cover) savedCovers.set(b.id, b.cover);
    }
    delete b.hasCover;
  }));
  // positions are stored separately and may be newer than the copy inside the books list
  try { progressMap = (await dbGet('progress')) || {}; } catch { progressMap = {}; }
  for(const b of list){
    const p = progressMap[b.id];
    if(p && (Number(p.ts) || 0) > (Number(b.lastSavedAt) || 0)){
      b.lastChapterIndex = Number(p.i) || 0;
      b.lastPositionSec = Number(p.t) || 0;
      b.lastSavedAt = Number(p.ts) || 0;
      b.pos = {i: b.lastChapterIndex, t: b.lastPositionSec};
      b.finished = !!p.finished;
    }
  }
  return list;
}

export async function saveBooks(){
  const live = new Set(state.books.map(b => b.id));
  const jobs = [];
  for(const b of state.books){
    if(b.cover && savedCovers.get(b.id) !== b.cover){
      const cover = b.cover;
      jobs.push(dbSet('cover:' + b.id, cover).then(() => { savedCovers.set(b.id, cover); }));
    }
  }
  for(const id of [...savedCovers.keys()]){
    if(!live.has(id)){ savedCovers.delete(id); jobs.push(dbDel('cover:' + id)); }
  }
  await Promise.all(jobs);
  await dbSet('books', state.books.map(stripCover));
  // forget positions of deleted books
  let pruned = false;
  for(const id of Object.keys(progressMap)) if(!live.has(id)){ delete progressMap[id]; pruned = true; }
  if(pruned) await dbSet('progress', progressMap);
}

let booksTimer = 0, booksFirstAt = 0, lastErrorToast = 0;
function reportStorageError(e){
  console.error('[storage]', e);
  const now = Date.now();
  if(now - lastErrorToast > 30000){ lastErrorToast = now; showToast('Не удалось сохранить данные: ' + (e?.message || e)); }
}

/** Debounced saveBooks() with an upper bound, so a long scan still saves regularly instead of "after the last book" */
export function saveBooksSoon(delay = 1500, maxWait = 8000){
  const now = Date.now();
  if(!booksFirstAt) booksFirstAt = now;
  clearTimeout(booksTimer);
  const wait = Math.max(0, Math.min(delay, booksFirstAt + maxWait - now));
  booksTimer = setTimeout(() => { booksTimer = 0; booksFirstAt = 0; saveBooks().catch(reportStorageError); }, wait);
}

export async function flushBooks(){
  clearTimeout(booksTimer); booksTimer = 0; booksFirstAt = 0;
  await saveBooks();
}

/** Position of ONE book — a few bytes instead of rewriting the whole library */
export async function saveProgressRecord(b){
  if(!b) return;
  progressMap[b.id] = {
    i: Number(b.lastChapterIndex) || 0,
    t: Number(b.lastPositionSec) || 0,
    ts: Number(b.lastSavedAt) || Date.now(),
    finished: !!b.finished
  };
  await dbSet('progress', progressMap);
}

export async function persist(){
  await Promise.all([
    saveBooks(),
    dbSet('folders', state.folders),
    dbSet('playlists', state.playlists),
    dbSet('settings', state.settings)
  ]);
}

/* ---------------- last playback (synchronous, survives a killed WebView) ---------------- */

export function readLastPlayback(){
  try { return JSON.parse(localStorage.getItem(LAST_PLAYBACK_KEY) || 'null'); }
  catch { return null; }
}

/** Store a ready-made record (used when the native player reports a newer position than JS knows) */
export function setLastPlayback(rec){
  try { localStorage.setItem(LAST_PLAYBACK_KEY, JSON.stringify(rec)); } catch {}
}

export function clearLastPlayback(bookId){
  const last = readLastPlayback();
  if(last && (!bookId || last.bookId === bookId)){
    try { localStorage.removeItem(LAST_PLAYBACK_KEY); } catch {}
  }
}

export function writeLastPlayback(){
  if (!state.current) return;
  try {
    localStorage.setItem(LAST_PLAYBACK_KEY, JSON.stringify({
      bookId: state.current.id,
      index: state.currentIndex,
      pos: Number(state.currentPos) || 0,
      ts: Date.now()
    }));
  } catch {}
}

/**
 * Saved position of a book: { i: lastChapterIndex, t: lastPositionSec }.
 * Sources (newest wins): book.lastChapterIndex/lastPositionSec (IDB),
 * legacy book.pos {i,t}, and the synchronous localStorage "last playback" record.
 */
export function getSavedPosition(b){
  const files = b?.files || [];
  let i = Number(b?.lastChapterIndex);
  let t = Number(b?.lastPositionSec);
  let ts = Number(b?.lastSavedAt) || 0;
  if (!Number.isFinite(i) || !Number.isFinite(t)) {
    i = Number(b?.pos?.i) || 0;
    t = Number(b?.pos?.t) || 0;
    ts = 0;
  }
  const last = readLastPlayback();
  if (last && b && last.bookId === b.id && (Number(last.ts) || 0) >= ts) {
    i = Number(last.index) || 0;
    t = Number(last.pos) || 0;
  }
  i = Math.max(0, Math.min(i, Math.max(0, files.length - 1)));
  return { i, t: Math.max(0, t) };
}

/** Position to resume from: step back a little so the listener regains context */
export function resumePosition(t){
  t = Number(t) || 0;
  return t > 15 ? t - 10 : t;
}
