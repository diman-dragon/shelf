/* app.js — Main Application Entry Point */
import { state, ICONS, DEFAULT_PLAYLISTS, isNative } from './js/state.js';
import { readLastPlayback, getSavedPosition, resumePosition } from './js/storage.js';
import { render, bindNav, showToast, setScreen } from './js/ui.js';
import { closeModal } from './js/ui-utils.js';
import { closeQueuePanel } from './js/player.js';
import { closeVisualizer } from './js/visualizer.js';
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

// Native Android Back Button handling via window.Capacitor.Plugins
if(isNative()){
  const App = window.Capacitor?.Plugins?.App;
  if(App){
    App.addListener('backButton', () => {
      const modalBack = document.getElementById('modalBack');
      const queuePanel = document.getElementById('queuePanel');
      const visualizer = document.getElementById('visualizer');

      if(modalBack || (window.modalRoot && window.modalRoot.innerHTML !== '')){
        closeModal();
        return;
      }
      if(queuePanel && !queuePanel.classList.contains('hidden')){
        closeQueuePanel();
        return;
      }
      if(visualizer && !visualizer.classList.contains('hidden')){
        closeVisualizer();
        return;
      }
      if(state.screen !== 'shelf'){
        setScreen('shelf');
        return;
      }
      App.minimizeApp();
    });
  }
}

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
      // restore lastChapterIndex / lastPositionSec; the audio file itself is loaded lazily
      // on first open/play, at exactly this position (saved data is NOT modified here)
      const saved = getSavedPosition(b);
      state.current = b;
      state.currentIndex = saved.i;
      state.currentPos = resumePosition(saved.t);
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
