/* storage.js — IndexedDB persistence and playback state
 *
 * Layout in IndexedDB:
 *   books          library WITHOUT covers and WITHOUT per-book prefs. Rewritten only when the library itself changes
 *                  (scan, rename, delete, bookmarks, metadata) — it is the biggest record (megabytes on a big library)
 *   cover:<id>     the cover (base64) of one book, written only when it actually changed
 *   progress       { bookId: {i, t, ts, finished} } — playback positions, tiny, written on every play/pause/seek
 *   bookprefs      { bookId: {sound?, speed?, mode?} } — per-book EQ/volume/speed and playback mode (book/album). Tiny:
 *                  only books that differ from the defaults.
 *                  (They used to live inside `books`, so every EQ slider move or speed click rewrote the whole library.)
 *   folders / playlists / settings / foldersSelected — each saved on its own, only when it changes
 */
import { state } from './state.js';
import { dbGet, dbSet, dbDel } from './db.js';
import { showToast } from './ui-utils.js';

const LAST_PLAYBACK_KEY = 'shelf:lastPlayback';

const savedCovers = new Map();     // bookId -> cover string that is already stored under cover:<id> (only covers that are loaded)
const coverIds = new Set();        // ids that HAVE a cover:<id> record — covers are read lazily, only for books that are shown
const coverLoading = new Map();    // bookId -> pending read, so one cover is never read twice at the same time
let progressMap = {};

const stripPersisted = b => { const { cover, sound, speed, mode, ...rest } = b; rest.hasCover = !!cover || coverIds.has(b.id); return rest; };

/**
 * Covers are NOT read at start-up any more (1000 books x ~30 KB used to be read into memory before the first screen).
 * They are loaded on demand: for the rows that are drawn, for the current book, for the player.
 */
export function loadCover(b){
  if(!b || b.cover || !coverIds.has(b.id)) return Promise.resolve(b?.cover || '');
  let job = coverLoading.get(b.id);
  if(!job){
    job = dbGet('cover:' + b.id).then(c => {
      if(c && !b.cover){ b.cover = c; savedCovers.set(b.id, c); }
      return b.cover || '';
    }).catch(() => '').finally(() => coverLoading.delete(b.id));
    coverLoading.set(b.id, job);
  }
  return job;
}

export const hasStoredCover = b => !!b.cover || coverIds.has(b.id);

/**
 * Drops covers from memory for every book except `keepIds` — only those that are safely stored (savedCovers has the
 * same string). They come back through loadCover() when a row/the player needs them. Called after a big scan, when
 * hundreds of freshly scanned covers would otherwise stay in RAM until the app is restarted.
 */
export function evictCovers(keepIds){
  const keep = new Set(keepIds);
  let n = 0;
  for(const b of state.books){
    if(b.cover && !keep.has(b.id) && savedCovers.get(b.id) === b.cover){ delete b.cover; n++; }
  }
  return n;
}

/* ---------------- per-book prefs (EQ / volume / speed) ---------------- */

let prefsTimer = 0, prefsJson = '';
let prefsMigrate = false;                       // legacy library: sound/speed still live inside the book records

function isDefaultSound(s){
  return !s || (s.preset === 'flat' && Number(s.volume ?? 1) === 1 && !Number(s.gain) && !s.skipSilence && !(s.eq || []).some(v => Number(v)));
}

function collectPrefs(list){
  const map = {};
  for(const b of list){
    const o = {};
    if(!isDefaultSound(b.sound)) o.sound = b.sound;
    if(Number(b.speed) > 0) o.speed = Number(b.speed);
    if(b.mode === 'album') o.mode = 'album';
    if(o.sound || o.speed || o.mode) map[b.id] = o;
  }
  return map;
}

async function writePrefs(list){
  const map = collectPrefs(list);
  const json = JSON.stringify(map);
  if(json === prefsJson) return;                // nothing changed since the last write: no IDB traffic at all
  await dbSet('bookprefs', map);
  prefsJson = json;
}

/** Debounced write of EQ / volume / speed. A few hundred bytes instead of the whole library. */
export function savePrefsSoon(delay = 800){
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => { prefsTimer = 0; writePrefs(state.books).catch(reportStorageError); }, delay);
}

export async function flushPrefs(){
  if(!prefsTimer) return;
  clearTimeout(prefsTimer); prefsTimer = 0;
  await writePrefs(state.books);
}

/* ---------------- books ---------------- */

export async function loadBooks(){
  const list = (await dbGet('books')) || [];
  for(const b of list){
    // a cover that is still inline (library saved by an older version) moves to its own key with the next saveBooks();
    // otherwise only remember THAT a cover exists — it is read when a screen actually needs it (loadCover)
    if(b.cover) coverIds.add(b.id);
    else if(b.hasCover) coverIds.add(b.id);
    delete b.hasCover;
  }
  // per-book prefs are stored separately; a library saved by an older version still has them inside the records
  let prefs = null;
  try { prefs = await dbGet('bookprefs'); } catch { prefs = null; }
  for(const b of list){
    const p = prefs?.[b.id];
    if(p){ if(p.sound) b.sound = p.sound; if(p.speed) b.speed = p.speed; if(p.mode) b.mode = p.mode; }
    else if(!prefs && (b.sound || b.speed)) prefsMigrate = true;
  }
  if(prefs) prefsJson = JSON.stringify(collectPrefs(list));
  // migrate BEFORE anything can rewrite `books` without them
  if(prefsMigrate){ await writePrefs(list); prefsMigrate = false; }

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
      jobs.push(dbSet('cover:' + b.id, cover).then(() => { savedCovers.set(b.id, cover); coverIds.add(b.id); }));
    }
  }
  for(const id of [...coverIds]){
    if(!live.has(id)){ coverIds.delete(id); savedCovers.delete(id); jobs.push(dbDel('cover:' + id)); }
  }
  await Promise.all(jobs);
  await dbSet('books', state.books.map(stripPersisted));
  // forget positions of deleted books
  let pruned = false;
  for(const id of Object.keys(progressMap)) if(!live.has(id)){ delete progressMap[id]; pruned = true; }
  if(pruned) await dbSet('progress', progressMap);
}

let booksTimer = 0, booksFirstAt = 0, lastErrorToast = 0;
function reportStorageError(e){
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

/** Small records are saved one by one — `persist()` used to rewrite ALL of them (including the whole library) every time */
export const saveFolders = () => dbSet('folders', state.folders);
export const savePlaylists = () => dbSet('playlists', state.playlists);
export const saveSettings = () => dbSet('settings', state.settings);

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
