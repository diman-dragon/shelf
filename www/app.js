/* app.js — Main Application Entry Point */
import { state, ICONS, DEFAULT_PLAYLISTS, isNative } from './js/state.js';
import { readLastPlayback } from './js/storage.js';
import { render, bindNav } from './js/ui.js';
import { initNativeScanListeners, scanAllFolders } from './js/scanner.js';

const { get, set } = window.idbKeyval || {};

// Diagnostic listeners for Android WebView tap tracking
document.addEventListener('click', e => { console.log('[DIAG_CLICK]', e.target); }, true);
document.addEventListener('pointerdown', e => { console.log('[DIAG_POINTER]', e.target); }, true);

async function loadState(){
  try {
    state.books = (await get?.('books')) || [];
    state.folders = (await get?.('folders')) || [];
    state.playlists = (await get?.('playlists')) || [];
    const settings = await get?.('settings');
    if(settings) state.settings = {...state.settings, ...settings};
  } catch (e) {
    console.error('[LoadState Error]', e);
  }

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

let appInitialized = false;
async function initApp(){
  if(appInitialized) return;
  appInitialized = true;
  try {
    state.selectedFolderIds = (await get?.('foldersSelected')) || [];
    document.querySelectorAll('.nav-ico').forEach(n => {
      n.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[n.dataset.icon]||''}</svg>`;
      n.style.pointerEvents = 'none';
    });
    await loadState();
  } catch (e) {
    console.error('[InitApp Error]', e);
  }
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', initApp, {once: true});
} else {
  initApp();
}
