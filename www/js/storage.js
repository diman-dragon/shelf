/* storage.js — IDB persistence and playback state */
import { state } from './state.js';

const { get, set, del } = window.idbKeyval || {};
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

export function writeLastPlayback(){
  if (!state.current) return;
  try {
    localStorage.setItem(LAST_PLAYBACK_KEY, JSON.stringify({
      bookId: state.current.id,
      index: state.currentIndex,
      pos: Number(state.currentPos) || 0
    }));
  } catch {}
}
