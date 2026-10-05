/* storage.js — IDB persistence and playback state */
import { state } from './state.js';

const { get, set } = window.idbKeyval || {};
const LAST_PLAYBACK_KEY = 'shelf:lastPlayback';

export async function persist(){
  await Promise.all([
    set?.('books', state.books),
    set?.('folders', state.folders),
    set?.('playlists', state.playlists),
    set?.('settings', state.settings)
  ]);
}

export function readLastPlayback(){
  try { return JSON.parse(localStorage.getItem(LAST_PLAYBACK_KEY) || 'null'); }
  catch { return null; }
}

/** Store a ready-made record (used when the native player reports a newer position than JS knows) */
export function setLastPlayback(rec){
  try { localStorage.setItem(LAST_PLAYBACK_KEY, JSON.stringify(rec)); } catch {}
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
