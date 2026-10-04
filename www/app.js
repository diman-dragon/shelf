/* app.js — Main Application Entry Point */
import { state, ICONS, DEFAULT_PLAYLISTS, isNative } from './js/state.js';
import { readLastPlayback } from './js/storage.js';
import { render, bindNav, showToast } from './js/ui.js';
import { initNativeScanListeners, scanAllFolders } from './js/scanner.js';

const { get, set } = window.idbKeyval || {};

// Global error handling & crash protection for Android WebView
window.addEventListener('error', (event) => {
  console.error('[Global Error]', event.error || event.message);
  try { showToast(`Ошибка: ${event.message || 'Неизвестная ошибка'}`); } catch {}
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled Rejection]', event.reason);
  try { showToast(`Ошибка: ${event.reason?.message || 'Сбой операции'}`); } catch {}
});

async function loadState(){
  try {
    state.books = (await get?.('books')) || [];
    state.folders = (await get?.('folders')) || [];
    state.playlists = (await get?.('playlists')) || [];
    const settings = await get?.('settings');
    if(settings) state.settings = {...state.settings, ...settings};
  } catch (e) {
    console.error('[LoadState Error]', e);
    showToast('Ошибка загрузки данных');
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
      state.currentPos = Math.max(0, (Number(last.pos||0) - 10));
      b.pos = {...(b.pos||{}), i: state.currentIndex, t: state.currentPos};
    }
  }

  initNativeScanListeners();

  try {
    render();
  } catch (e) {
    console.error('[Render Error]', e);
    showToast('Ошибка отображения интерфейса');
  }

  try {
    bindNav();
  } catch (e) {
    console.error('[BindNav Error]', e);
  }

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
    // Ensure navigation event listeners are bound immediately
    try { bindNav(); } catch {}
    await loadState();
  } catch (e) {
    console.error('[InitApp Error]', e);
    showToast(`Ошибка инициализации: ${e.message || 'Сбой старта'}`);
  }
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', initApp, {once: true});
} else {
  initApp();
}
