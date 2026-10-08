/* app.js — Main Application Entry Point */
import { state, ICONS, DEFAULT_PLAYLISTS, isNative, modalRoot, cleanTitle, cleanFolderName, seekStep } from './js/state.js';
import { loadBooks, loadCover, saveBooksSoon, saveSettings, readLastPlayback, getSavedPosition } from './js/storage.js';
import { dbGet } from './js/db.js';
import { registerScreen, registerAction, render, bindNav, setScreen } from './js/router.js';
import { showToast, closeModal, applySystemBars } from './js/ui-utils.js';
import { renderPlaylists, renderSettings, newPlaylist } from './js/ui.js';
import { renderShelf, updateShelfList, openLibraryFilter, openSort } from './js/library.js';
import { renderPlayer, ensureChapterLoaded, closeQueuePanel, openPlayer, unloadCurrent } from './js/player.js';
import { syncNativeResume } from './js/native-bridge.js';
import { closeVisualizer } from './js/visualizer.js';
import { initNativeScanListeners, scanAllFolders, openFolderSheet } from './js/scanner.js';
import { audio } from './js/sound.js';

// ---- screens and actions: modules talk through the router, not through each other (no import cycles) ----
registerScreen('shelf', renderShelf);
registerScreen('player', () => { if(state.current) renderPlayer(); else renderShelf(); }, {
  onEnter: () => { if(state.current) ensureChapterLoaded(); },   // load the saved chapter/position only if <audio> doesn't hold it yet
  onLeave: () => { closeVisualizer(); closeQueuePanel(); }       // leaving the player: no visualizer loop on a detached canvas, no open panel
});
registerScreen('playlists', renderPlaylists);
registerScreen('settings', renderSettings);
registerAction('openAddSheet', openFolderSheet);
registerAction('openLibraryFilter', openLibraryFilter);
registerAction('openSort', openSort);
registerAction('newPlaylist', newPlaylist);
registerAction('openCurrent', () => { if(state.current) openPlayer(state.current.id); });
registerAction('openPlayer', openPlayer);
registerAction('updateShelf', updateShelfList);
registerAction('renderShelf', renderShelf);
registerAction('unloadCurrent', unloadCurrent);

// Global error handling & crash protection for Android WebView.
// The error is shown to the person (toast, or the fallback banner when #toast is not in the DOM yet).
function reportError(tag, err, fallbackText){
  const text = (err && err.message) || (typeof err === 'string' ? err : '') || fallbackText;
  try { showToast(`Ошибка: ${text}`); }
  catch (e2) {
    // even showToast failed (e.g. the module graph is broken): plain DOM banner, no imports needed
    try {
      const d = document.createElement('div');
      d.textContent = `Ошибка: ${text}`;
      d.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:9999;padding:10px 14px;border-radius:12px;background:#7a1f18;color:#fff;font:13px system-ui,sans-serif';
      (document.body || document.documentElement).appendChild(d);
    } catch {}
  }
}

window.addEventListener('error', (event) => {
  // benign browser notification, not an app failure
  if(/ResizeObserver loop/i.test(event.message || '')) return;
  reportError('Global Error', event.error || event.message, 'Неизвестная ошибка');
});

window.addEventListener('unhandledrejection', (event) => {
  reportError('Unhandled Rejection', event.reason, 'Сбой операции');
});

// Native Android Back Button handling via window.Capacitor.Plugins
if(isNative()){
  const App = window.Capacitor?.Plugins?.App;
  if(App){
    App.addListener('backButton', () => {
      const queuePanel = document.getElementById('queuePanel');
      const visualizer = document.getElementById('visualizer');

      // any open modal (generic one, sound modal, ...) lives inside #modalRoot
      if(modalRoot && modalRoot.innerHTML.trim() !== ''){
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
    state.books = await loadBooks();
    // one-time cleanup of leading numbers ("01. ") in titles of already imported books
    // (a flag in the settings remembers that it was done; new books are cleaned when they are scanned)
    if(!state.settings.titlesCleaned){
      state.books.forEach(b => { const t = cleanTitle(b.title); if(t !== b.title) b.title = t; });
      state.settings.titlesCleaned = 1;
      saveBooksSoon(500);
      saveSettings().catch(() => {});
    }
    state.folders = (await dbGet('folders')) || [];
    // folder names saved by older versions still carry the SAF volume prefix ("primary:Audiobooks")
    state.folders.forEach(f => { f.name = cleanFolderName(f.name); });
    state.playlists = (await dbGet('playlists')) || [];
    const settings = await dbGet('settings');
    if(settings) state.settings = {...state.settings, ...settings};
  } catch (e) {
    showToast('Ошибка загрузки данных: ' + (e?.message || e));
  }

  document.documentElement.dataset.theme = state.settings.theme || 'dark';
  applySystemBars(state.settings.theme || 'dark');

  if(!state.playlists.length){
    state.playlists = DEFAULT_PLAYLISTS.map(([id,name,emoji])=>({id,name,emoji,bookIds:[]}));
  }

  await syncNativeResume();   // native player may hold a newer position than the last JS save
  const last = readLastPlayback();
  if(last?.bookId){
    const b = state.books.find(x => x.id === last.bookId);
    if(b){
      // restore lastChapterIndex / lastPositionSec; the audio file itself is loaded lazily
      // on first open/play, at exactly this position (saved data is NOT modified here)
      const saved = getSavedPosition(b);
      state.current = b;
      state.currentIndex = saved.i;
      state.currentPos = saved.t;              // the exact saved position; the small "step back" happens when playback starts
      state.resumeRewind = true;
      state.speed = Number(b.speed) || Number(state.settings.speed) || 1;
      await loadCover(b);                      // only THIS cover is read at start-up (the header shows it)
    }
  }

  initNativeScanListeners();

  try {
    render();
  } catch (e) {
    showToast('Ошибка отображения интерфейса');
  }

  try {
    bindNav();
  } catch (e) {
  }

  // the scan works on SELECTED folders (that is what scanAllFolders reads), so that is what decides here
  if(state.settings.autoscan && state.selectedFolderIds.some(id => state.folders.some(f => f.id === id)) && isNative()) {
    setTimeout(() => scanAllFolders({silent: true}), 500);
  }
}

let appInitialized = false;
async function initApp(){
  if(appInitialized) return;
  appInitialized = true;
  try {
    state.selectedFolderIds = (await dbGet('foldersSelected')) || [];
    document.querySelectorAll('.nav-ico').forEach(n => {
      n.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[n.dataset.icon]||''}</svg>`;
      n.style.pointerEvents = 'none';
    });
    // Ensure navigation event listeners are bound immediately
    try { bindNav(); } catch {}
    try { state.appVersion = (await window.Capacitor?.Plugins?.App?.getInfo?.())?.version || ''; } catch {}
    await loadState();
    audio.setSeekStep?.(seekStep());           // native: the notification / lock screen / widget use the same step
  } catch (e) {
    showToast(`Ошибка инициализации: ${e.message || 'Сбой старта'}`);
  }
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', initApp, {once: true});
} else {
  initApp();
}
