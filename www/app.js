/* app.js — Main Application Entry Point */
import { state, NAV, ICONS, DEFAULT_PLAYLISTS } from './js/state.js';
import { readLastPlayback } from './js/storage.js';
import { render, bindNav } from './js/ui.js';
import { initNativeScanListeners, scanAllFolders } from './js/scanner.js';
import { isNative } from './js/state.js';

const { get, set } = window.idbKeyval || {};

async function loadState(){
  try {
    state.books = (await get?.('books')) || [];
    state.folders = (await get?.('folders')) || [];
    state.playlists = (await get?.('playlists')) || [];
    const settings = await get?.('settings');
    if(settings) state.settings = {...state.settings, ...settings};
    if(Number(state.settings.volume) > 1) state.settings.volume = Number(state.settings.volume) / 100;
  } catch {}

  document.documentElement.dataset.theme = state.settings.theme || 'dark';

  if(!state.playlists.length){
    state.playlists = DEFAULT_PLAYLISTS.map(([id,name,emoji])=>({id,name,emoji,bookIds:[]}));
  }

  const last = readLastPlayback();
  if(last?.bookId){
    const b = state.books.find(x => x.id === last.bookId);
    if(b){
      state.current = b;
      state.currentIndex = Math.max(0, Math.min(Number(last.index)||0, b.files.length-1));
      state.currentPos = Math.max(0, (Number(last.pos)||0) - 10);
      b.pos = {...(b.pos||{}), i: state.currentIndex, t: state.currentPos};
    }
  }

  initNativeScanListeners();
  render();
  if(state.settings.autoscan && state.folders.length && isNative()) {
    setTimeout(() => scanAllFolders(true), 500);
  }
}

(async () => {
  state.selectedFolderIds = (await get?.('foldersSelected')) || [];
  document.querySelectorAll('.nav-ico').forEach(n => {
    n.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[n.dataset.icon]||''}</svg>`;
  });
  await loadState();
})();
