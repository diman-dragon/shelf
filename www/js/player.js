/* player.js — Player screen, Audio playback, Chapters, Visualizer */
import { state, icon, escapeHtml, fmt, uid, plural, plugin, $, isNative, main } from './state.js';
import { persist, writeLastPlayback, getSavedPosition, resumePosition, readLastPlayback, setLastPlayback } from './storage.js';
import { showToast, closeModal, openModal, bookCover, render, updateHeaderNowPlaying, progress } from './ui.js';
import { audio, NATIVE, ensureAudioGraph, applyCurrentFileSound, openCurrentSound, ensureAudible } from './sound.js';
import { openBookMenu } from './library.js';
import { openVisualizer, closeVisualizer } from './visualizer.js';
import { hydrateBookMeta } from './meta.js';

const { get, set } = window.idbKeyval || {};
let progressSaveTimer = null;
let lastSavedSecond = -1;

// --- loading state -----------------------------------------------------------
// loadedKey   — which "bookId:chapterIndex" is currently inside <audio>
// pendingSeek — position to jump to once metadata of the new source is ready
// restoring   — true between "src assigned" and "metadata ready": audio.currentTime is 0
//               there and must NOT overwrite the saved position
let loadedKey = '';
let pendingSeek = 0;
let restoring = false;
let loadToken = 0;
let seekDragging = false;

const curKey = () => state.current ? `${state.current.id}:${state.currentIndex}` : '';

/** state.playing must always mirror the real <audio> state (src change silently sets paused=true) */
function syncPlaying(){
  state.playing = !!audio.src && !audio.paused && !audio.ended;
  return state.playing;
}

export function bookTotal(b = state.current){
  return (b?.files || []).reduce((a, f) => a + (Number(f.duration) || 0), 0);
}

/** Elapsed seconds across the whole book. state.currentPos is the canonical chapter position. */
export function bookElapsed(b = state.current){
  if(!b) return 0;
  const files = b.files || [];
  let i, t;
  if(state.current?.id === b.id){
    i = state.currentIndex;
    t = Number(state.currentPos) || 0;
  } else {
    const s = getSavedPosition(b);
    i = s.i; t = s.t;
  }
  i = Math.max(0, Math.min(i, files.length - 1));
  const before = files.slice(0, i).reduce((a, f) => a + (Number(f.duration) || 0), 0);
  return before + t;
}

/** Seek within whole book (seconds from the very start of the book) */
export async function seekBook(sec){
  const b = state.current;
  if(!b) return;
  const files = b.files || [];
  let left = Math.max(0, Number(sec) || 0);
  let idx = Math.max(0, files.length - 1);
  for(let i = 0; i < files.length; i++){
    const d = Number(files[i].duration) || 0;
    if(i < files.length - 1 && d > 0 && left >= d){ left -= d; continue; }
    idx = i;
    break;
  }
  if(idx === state.currentIndex && loadedKey === curKey() && !restoring){
    const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : left;
    audio.currentTime = Math.max(0, Math.min(left, dur));
    state.currentPos = audio.currentTime;
  } else {
    await loadChapter(idx, left, syncPlaying());
  }
  snapshotPosition();
  saveProgress();
  updatePlayerUI();
}

/** Make sure the <audio> element really holds the current chapter (no reload if it already does) */
export async function ensureChapterLoaded(){
  const b = state.current;
  if(!b) return;
  if(loadedKey === curKey() && (NATIVE ? audio.hasQueue(b) : audio.src)){ syncPlaying(); return; }
  if(NATIVE){
    // the service may still be playing this very book (app was restarted, music kept going): take over, don't reload
    const st = await audio.adopt(b);
    if(st){
      applyCurrentFileSound();
      state.currentIndex = st.index;
      state.currentPos = Number(st.pos) || 0;
      if(st.speed) state.speed = st.speed;
      loadedKey = curKey();
      syncPlaying(); updatePlayerUI();
      return;
    }
  }
  await loadChapter(state.currentIndex, state.currentPos, false);
}

export async function openPlayer(id){
  const b = state.books.find(x => x.id === id);
  if(!b) return;
  if(state.current?.id !== b.id){
    if(state.current){ snapshotPosition(); await saveProgress(true); }
    audio.pause();
    const saved = getSavedPosition(b);
    state.current = b;
    state.currentIndex = saved.i;
    state.currentPos = resumePosition(saved.t);
    state.playing = false;
    loadedKey = '';
  }
  state.screen = 'player';
  render();
  await ensureChapterLoaded();
  syncPlaying();
  updatePlayerUI();
  ensureAudible();
}

export function renderPlayer(){
  const b = state.current;
  if(!b) return;
  syncPlaying();
  const i = Math.min(state.currentIndex, b.files.length-1);
  const f = b.files[i];
  const totalDur = bookTotal(b);
  const elapsed = bookElapsed(b);
  const pct = progress(b);

  main.innerHTML = `<section class="player player-fit" id="playerScreen">
    <div class="player-inner">
      <div class="topbar player-top">
        <div style="display:flex;align-items:center;gap:10px">
          <button type="button" class="icon-btn" id="playerBack" aria-label="Назад">${icon('back')}</button>
          <div><h2>Плеер</h2></div>
        </div>
        <div class="top-actions">
          <button type="button" class="icon-btn" id="playerMark" aria-label="Закладка">${icon('bookmark')}</button>
          <button type="button" class="icon-btn" id="playerMore" aria-label="Ещё">${icon('more')}</button>
        </div>
      </div>
      <div class="player-cover" id="playerCover">${bookCover(b)}</div>
      <div class="player-title">${escapeHtml(b.title)}</div>
      <div class="player-author">${escapeHtml(b.author||'Автор не указан')}</div>
      <div class="chapter">Глава ${i+1} из ${b.files.length} · ${escapeHtml(f.name)}</div>
      <div class="seek"><input id="seek" type="range" min="0" max="1000" value="${Math.round(pct*10)}" aria-label="Позиция в книге"></div>
      <div class="time-row"><span id="curTime">${fmt(elapsed)}</span><span id="durTime">${fmt(totalDur)}</span></div>
      <div class="controls">
        <button type="button" class="control" id="prevBtn" aria-label="Предыдущая глава">${icon('prev')}</button>
        <button type="button" class="control" id="backBtn" aria-label="Назад 15 секунд">${icon('rewind')}</button>
        <button type="button" class="play-main" id="playBtn" aria-label="Воспроизведение">${icon(state.playing?'pause':'play')}</button>
        <button type="button" class="control" id="forwardBtn" aria-label="Вперёд 30 секунд">${icon('forward')}</button>
        <button type="button" class="control" id="nextBtn" aria-label="Следующая глава">${icon('next')}</button>
      </div>
      <div class="player-tools">
        <button type="button" class="tool" id="speedBtn"><strong>${state.speed.toFixed(1)}×</strong>Скорость</button>
        <button type="button" class="tool" id="sleepBtn"><strong>◷</strong>Таймер</button>
        <button type="button" class="tool" id="queueBtn"><strong>☷</strong>Очередь</button>
        <button type="button" class="tool" id="soundBtn"><strong>♫</strong>Звук</button>
      </div>
      <div class="swipe-hint">← визуализатор · список глав →</div>
    </div>
    <div class="side-panel queue-panel hidden" id="queuePanel" aria-hidden="true">
      <div class="side-panel-head">
        <button type="button" class="icon-btn" id="queueClose" aria-label="Закрыть">${icon('close')}</button>
        <strong>Главы</strong>
      </div>
      <div class="side-panel-body chapter-list" id="chapterList">${chapterRows(b)}</div>
    </div>
    <div class="visualizer-overlay hidden" id="visualizer" aria-hidden="true">
      <canvas id="visualizerCanvas"></canvas>
      <div class="visualizer-head">
        <button type="button" class="icon-btn visualizer-x" id="visualizerClose" aria-label="Закрыть">${icon('close')}</button>
        <div><strong>Визуализатор</strong><span>${escapeHtml(f.name)}</span></div>
      </div>
      <div class="visualizer-center"><span>${icon('music')}</span><b>AudioShelf</b></div>
    </div>
  </section>`;

  const on = (id, fn) => { const el = $(id); if(el) el.onclick = fn; };
  on('playerBack', closePlayer);
  on('playBtn', () => togglePlay());
  on('prevBtn', prevTrack);
  on('nextBtn', nextTrack);
  on('backBtn', () => seekBy(-15));
  on('forwardBtn', () => seekBy(30));
  const seekEl = $('seek');
  if(seekEl){
    // Whole-book slider: dragging only previews the time, the jump happens on release
    seekEl.addEventListener('input', e => {
      seekDragging = true;
      const ct = $('curTime');
      if(ct) ct.textContent = fmt(bookTotal(b) * (+e.target.value / 1000));
    });
    seekEl.addEventListener('change', e => {
      seekDragging = false;
      const total = bookTotal(b);
      if(total > 0) seekBook(total * (+e.target.value / 1000));
      else updatePlayerUI();
    });
    seekEl.addEventListener('touchcancel', () => { seekDragging = false; updatePlayerUI(); }, {passive:true});
  }
  on('speedBtn', cycleSpeed);
  on('sleepBtn', setSleep);
  on('soundBtn', openCurrentSound);
  on('playerMark', addBookmark);
  on('queueBtn', openQueuePanel);
  on('queueClose', closeQueuePanel);
  on('playerMore', () => openBookMenu(b.id));
  on('visualizerClose', closeVisualizer);
  bindChapterRows();
  bindPlayerSwipe();
  updatePlayerUI();
  if(state.playing) ensureAudible();   // returning to the player must never leave "Pause" + silence
  // old libraries: fill missing chapter durations / cover in background
  hydrateBookMeta(b, () => { if(state.screen === 'player' && state.current === b) updatePlayerUI(); });
}

function bindChapterRows(){
  document.querySelectorAll('[data-chapter]').forEach(el => {
    el.onclick = () => { loadChapter(+el.dataset.chapter, 0, true); closeQueuePanel(); };
  });
  document.querySelectorAll('[data-mark]').forEach(el => {
    el.onclick = () => {
      const m = state.current?.marks?.[+el.dataset.mark];
      if(m){ loadChapter(m.i, m.t, true); closeQueuePanel(); }
    };
  });
}

export function chapterRows(b){
  let out = '';
  (b.marks || []).forEach((m,k)=>{
    out += `<div class="chapter-row bookmark-row" data-mark="${k}"><span>🔖 ${m.i+1}. ${escapeHtml(b.files[m.i]?.name||'Глава')} · ${fmt(m.t)}</span><span>›</span></div>`;
  });
  b.files.forEach((f,i)=>{
    out += `<div class="chapter-row ${i===state.currentIndex?'current':''}" data-chapter="${i}"><span>${i+1}. ${escapeHtml(f.name)}</span><span>${i===state.currentIndex?(state.playing?'▶':'Ⅱ'):fmt(f.duration)}</span></div>`;
  });
  return out;
}

export async function loadChapter(i, t=0, autoplay=true){
  const b = state.current;
  const f = b?.files?.[i];
  if(!f) return;
  const token = ++loadToken;
  state.currentIndex = i;
  state.currentPos = Number(t) || 0;
  pendingSeek = state.currentPos;
  restoring = true;            // until metadata is ready, audio.currentTime (0) must not overwrite the position
  loadedKey = `${b.id}:${i}`;

  if(NATIVE){
    // Whole book goes to the native playlist; chapter changes then happen natively (screen off is fine)
    if(!f.uri){ restoring = false; loadedKey = ''; showToast('Файл недоступен'); return; }
    const startAt = f.duration > 0 ? Math.min(state.currentPos, Math.max(0, f.duration - 0.5)) : state.currentPos;
    try {
      applyCurrentFileSound();
      audio.playbackRate = state.speed;
      await audio.loadNative(b, i, startAt);
    } catch(e) {
      console.error('Native load error:', e);
      if(token === loadToken){ restoring = false; loadedKey = ''; }
      showToast('Не удалось открыть аудиофайл');
      return;
    }
    if(token !== loadToken) return;
    restoring = false; pendingSeek = 0;
    snapshotPosition(); syncPlaying(); updatePlayerUI();
    if(autoplay) await togglePlay(true);
    return;
  }

  let src = '';
  let newBlobUrl = '';
  try {
    if(f.key){
      const blob = await get?.(f.key);
      if(token !== loadToken) return;
      if(!blob){ restoring = false; loadedKey = ''; showToast('Файл недоступен'); return; }
      newBlobUrl = URL.createObjectURL(blob);
      src = newBlobUrl;
    } else if(f.uri){
      src = isNative() ? window.Capacitor.convertFileSrc(f.uri) : f.uri;
    } else {
      restoring = false; loadedKey = '';
      showToast('Файл недоступен');
      return;
    }
  } catch(e) {
    console.error('Audio load error:', e);
    if(token === loadToken){ restoring = false; loadedKey = ''; }
    showToast('Не удалось открыть аудиофайл');
    return;
  }
  if(token !== loadToken){ if(newBlobUrl) URL.revokeObjectURL(newBlobUrl); return; }

  // Pause explicitly BEFORE swapping src: changing src on a playing element sets paused=true
  // without a "pause" event, which used to leave the UI on "Pause" with no sound.
  audio.pause();
  audio.muted = false;
  const oldBlob = state.blobUrl;
  audio.src = src;
  state.blobUrl = newBlobUrl;
  if(oldBlob) URL.revokeObjectURL(oldBlob);
  audio.defaultPlaybackRate = state.speed;
  audio.playbackRate = state.speed;
  applyCurrentFileSound();

  audio.onloadedmetadata = () => {
    if(token !== loadToken) return;
    const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
    const target = dur > 0 ? Math.min(pendingSeek, Math.max(0, dur - 0.5)) : pendingSeek;
    if(target > 0) audio.currentTime = target;
    state.currentPos = target > 0 ? target : 0;
    restoring = false;
    audio.playbackRate = state.speed;
    if(dur > 0 && Math.abs((Number(f.duration) || 0) - dur) > 0.5){
      f.duration = dur;
      clearTimeout(progressSaveTimer);
      progressSaveTimer = setTimeout(() => { progressSaveTimer = null; set?.('books', state.books); }, 1500);
    }
    snapshotPosition();
    updatePlayerUI();
  };
  audio.onended = () => {
    if(token !== loadToken) return;
    if(i < b.files.length - 1) loadChapter(i + 1, 0, true);
    else { state.playing = false; loadChapter(0, 0, false).then(() => saveProgress(true)); }
  };
  audio.onerror = () => { if(token === loadToken) restoring = false; };

  syncPlaying();
  updatePlayerUI();
  if(autoplay) await togglePlay(true);
}

export async function togglePlay(forcePlay=false){
  if(!state.current) return;
  try {
    if(forcePlay || audio.paused || audio.ended){
      await ensureChapterLoaded();           // e.g. widget "play" right after app start
      await ensureAudioGraph();
      await ensureAudible();                 // unmute, restore volume, resume AudioContext
      await audio.play();
    } else {
      audio.pause();
    }
  } catch(e) {
    if(e?.name !== 'AbortError') showToast('Не удалось изменить воспроизведение');
  }
  syncPlaying();
  updatePlayerUI();
}

export function seekBy(n){
  if(restoring || !Number.isFinite(audio.duration) || !audio.duration) return;
  audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + n));
  state.currentPos = audio.currentTime;
  updatePlayerUI();
}

export function prevTrack(){
  if(!restoring && audio.currentTime > 6){ audio.currentTime = 0; state.currentPos = 0; updatePlayerUI(); }
  else if(state.currentIndex > 0) loadChapter(state.currentIndex - 1, 0, true);
}

export function nextTrack(){
  if(state.currentIndex < state.current.files.length - 1) loadChapter(state.currentIndex + 1, 0, true);
}

const SPEEDS = [.8, 1, 1.2, 1.5, 1.8, 2];

export function cycleSpeed(){
  const current = Number(state.speed) || 1;
  const idx = SPEEDS.indexOf(current);
  state.speed = SPEEDS[(idx !== -1 ? idx + 1 : 1) % SPEEDS.length];
  audio.defaultPlaybackRate = state.speed;
  audio.playbackRate = state.speed;
  const sb = $('speedBtn');
  if(sb) sb.innerHTML = `<strong>${state.speed.toFixed(1)}×</strong>Скорость`;
  showToast(`Скорость: ${state.speed.toFixed(1)}×`);
}

export function setSleep(){
  openModal(`<h3>Таймер сна</h3><p style="color:var(--muted);font-size:13px">Введите время в минутах (0 — выключить)</p><input class="field" id="sleepInput" type="number" min="0" value="30"><div class="modal-actions"><button class="secondary" data-close>Отмена</button><button class="primary" id="sleepSave">Установить</button></div>`);
  $('sleepSave').onclick = () => {
    const v = $('sleepInput').value;
    closeModal();
    clearTimeout(state.sleepTimer);
    const n = Number(v);
    if(n > 0){
      // native: timer lives in the service (JS timers are throttled with the screen off) and fades out the last 15 s
      if(NATIVE) audio.setSleep(n);
      else state.sleepTimer = setTimeout(() => audio.pause(), n * 60000);
      showToast(`Таймер: ${n} мин`);
    } else {
      if(NATIVE) audio.setSleep(0);
      showToast('Таймер выключен');
    }
  };
}

export async function addBookmark(){
  const b = state.current;
  if(!b) return;
  b.marks = b.marks || [];
  b.marks.push({i: state.currentIndex, t: Number(state.currentPos) || 0});
  await set?.('books', state.books);
  renderPlayer();
  showToast('Закладка добавлена');
}

/** Copy the live position onto the book object (never while audio.currentTime is not valid yet) */
function snapshotPosition(){
  const b = state.current;
  if(!b) return;
  let t;
  if(restoring) t = pendingSeek;
  else if(loadedKey === curKey()) t = Number(audio.currentTime) || 0;
  else t = Number(state.currentPos) || 0;
  t = Math.max(0, t);
  state.currentPos = t;
  b.pos = {i: state.currentIndex, t};
  b.lastChapterIndex = state.currentIndex;
  b.lastPositionSec = t;
  b.lastSavedAt = Date.now();
}

export async function saveProgress(force = false){
  if(!state.current) return;
  snapshotPosition();
  writeLastPlayback();

  if(force){
    clearTimeout(progressSaveTimer);
    progressSaveTimer = null;
    try { await set?.('books', state.books); } catch {}
    return;
  }
  if(progressSaveTimer) return;
  // the position itself is already in localStorage (writeLastPlayback above); the heavy IDB write of the
  // whole library is coalesced to once per 20 s instead of every few seconds
  progressSaveTimer = setTimeout(async () => {
    progressSaveTimer = null;
    try { await set?.('books', state.books); } catch {}
  }, 20000);
}

export function updatePlayerUI(){
  requestAnimationFrame(() => {
    if(!state.current) return;
    syncPlaying();
    const b = state.current, f = b.files[state.currentIndex];
    // Whole-book progress (sum of ALL chapters), not the length of the current file
    const total = bookTotal(b);
    const elapsed = bookElapsed(b);
    const pct = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0;
    if(!seekDragging){
      const seek = $('seek');
      if(seek) seek.value = Math.round(pct * 10);
      const ct = $('curTime');
      if(ct) ct.textContent = fmt(elapsed);
    }
    const dt = $('durTime');
    if(dt) dt.textContent = fmt(total);
    const pb = $('playBtn');
    if(pb) pb.innerHTML = icon(state.playing ? 'pause' : 'play');
    const ch = document.querySelector('.chapter');
    if(ch) ch.textContent = `Глава ${state.currentIndex+1} из ${b.files.length} · ${f?.name||''}`;
    document.querySelectorAll('[data-chapter]').forEach(el => {
      el.classList.toggle('current', +el.dataset.chapter === state.currentIndex);
    });
    updateHeaderNowPlaying();
  });
}

export function openQueuePanel(){
  closeVisualizer();
  const panel = $('queuePanel');
  if(!panel) return;
  const list = $('chapterList');
  if(list && state.current) list.innerHTML = chapterRows(state.current);
  bindChapterRows();
  panel.classList.remove('hidden');
  panel.setAttribute('aria-hidden','false');
}

export function closeQueuePanel(){
  const panel = $('queuePanel');
  if(!panel) return;
  panel.classList.add('hidden');
  panel.setAttribute('aria-hidden','true');
}

export function closePlayer(){
  closeVisualizer();
  saveProgress(true);
  state.screen = 'shelf';
  render();
}

// --- <audio> events: UI state is always derived from the real element ---------
function onPlayState(){
  syncPlaying();
  updatePlayerUI();
  saveProgress(true);
  setMediaSession();
}
audio.addEventListener('play', () => { ensureAudible(); onPlayState(); });
audio.addEventListener('playing', () => { syncPlaying(); updatePlayerUI(); });
audio.addEventListener('pause', onPlayState);
audio.addEventListener('ended', () => { syncPlaying(); updatePlayerUI(); });
audio.addEventListener('emptied', () => { syncPlaying(); updatePlayerUI(); });

audio.addEventListener('timeupdate', () => {
  if(!state.current || restoring || loadedKey !== curKey()) return;
  state.currentPos = audio.currentTime;
  snapshotPosition();
  updatePlayerUI();
  const sec = Math.floor(audio.currentTime);
  if(sec !== lastSavedSecond && sec % 5 === 0){ lastSavedSecond = sec; saveProgress(); }
});
audio.addEventListener('seeked', () => { if(!restoring) saveProgress(true); });
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'hidden') saveProgress(true);
  else {
    if(NATIVE) audio.resync();          // events may have been missed while the WebView was in the background
    syncPlaying(); if(state.playing) ensureAudible(); updatePlayerUI();
  }
});

export function stopNativePlayer(){ const P = plugin('Player'); if(P) P.stop().catch(()=>{}); }
// NOTE: the native player must NOT be stopped here — the WebView going away (screen off, app in background)
// must not interrupt playback. The service stops itself when the app is swiped from recents.
window.addEventListener('pagehide', () => { saveProgress(true); });
window.addEventListener('beforeunload', () => { saveProgress(true); });
audio.addEventListener('error', e => { console.error('Audio element error:', e); showToast('Ошибка воспроизведения файла'); });

export function setMediaSession(){
  if(NATIVE || !('mediaSession' in navigator) || !state.current) return;   // native: Media3 session owns notification/lock screen
  const b = state.current, f = b.files[state.currentIndex];
  try {
    navigator.mediaSession.metadata = new MediaMetadata({title: f?.name || b.title, artist: b.author || b.title, album: b.title, artwork: b.cover?[{src: b.cover, sizes:'512x512'}]:[]});
    navigator.mediaSession.playbackState = state.playing ? 'playing' : 'paused';
    navigator.mediaSession.setActionHandler('play', () => togglePlay(true));
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    // "stop" = close the player controls: pause and keep the position (never rewind to 0)
    navigator.mediaSession.setActionHandler('stop', () => { audio.pause(); stopNativePlayer(); });
    navigator.mediaSession.setActionHandler('previoustrack', prevTrack);
    navigator.mediaSession.setActionHandler('nexttrack', nextTrack);
    navigator.mediaSession.setActionHandler('seekbackward', () => seekBy(-10));
    navigator.mediaSession.setActionHandler('seekforward', () => seekBy(30));
  } catch {}
}

// --- Native engine events (chapter changes, end of book, service closed) ---------------------
if(NATIVE){
  // ExoPlayer moved to another chapter on its own (auto-advance, notification/headset next/prev)
  audio.addEventListener('trackchange', e => {
    if(!state.current) return;
    const idx = e.detail.index;
    if(idx === state.currentIndex && loadedKey === curKey()) return;
    state.currentIndex = idx; state.currentPos = 0; pendingSeek = 0; restoring = false;
    loadedKey = curKey();
    snapshotPosition(); saveProgress(true);
    const list = $('chapterList');
    if(list){ list.innerHTML = chapterRows(state.current); bindChapterRows(); }
    updatePlayerUI();
  });
  // real chapter duration is known only to the decoder
  audio.addEventListener('durationchange', () => {
    const f = state.current?.files?.[state.currentIndex], d = audio.duration;
    if(!f || !(d > 0) || loadedKey !== curKey()) return;
    if(Math.abs((Number(f.duration) || 0) - d) > 0.5){
      f.duration = d;
      clearTimeout(progressSaveTimer);
      progressSaveTimer = setTimeout(() => { progressSaveTimer = null; set?.('books', state.books); }, 1500);
    }
  });
  // end of the LAST chapter (chapter-to-chapter transitions are gapless inside the native playlist)
  audio.addEventListener('ended', () => {
    if(!state.current) return;
    audio.pause();
    state.playing = false;
    loadChapter(0, 0, false).then(() => saveProgress(true));
  });
  // service is gone (notification dismissed / task removed): remember the position, force a re-load on next play
  audio.addEventListener('closed', () => {
    saveProgress(true);
    loadedKey = '';
    syncPlaying(); updatePlayerUI();
  });
}

/** Take the newer of (JS last save, native service last save) before the app decides what to resume. */
export async function syncNativeResume(){
  if(!NATIVE) return;
  try {
    const st = await audio.P.getState();
    const s = st?.saved;
    if(!s?.bookId) return;
    const last = readLastPlayback();
    if(!last || (Number(s.ts) || 0) > (Number(last.ts) || 0)){
      setLastPlayback({bookId: s.bookId, index: Number(s.index) || 0, pos: Number(s.pos) || 0, ts: Number(s.ts) || Date.now()});
    }
  } catch {}
}

// --- Swipes on the player: thresholds + direction lock, vertical scroll is never blocked ---
function bindPlayerSwipe(){
  const root = $('playerScreen');
  if(!root || root.dataset.swipeBound) return;
  root.dataset.swipeBound = '1';

  const MIN_DX = 70;      // px the finger must travel horizontally
  const LOCK_PX = 12;     // movement needed before the gesture direction is decided
  const RATIO = 1.8;      // |dx| must dominate |dy| by this factor
  const MAX_MS = 900;     // slower drags are not swipes
  const EDGE = 22;        // keep Android system back-gesture zones free

  let x0 = 0, y0 = 0, t0 = 0, active = false, mode = '';

  root.addEventListener('touchstart', e => {
    active = false; mode = '';
    if(e.touches.length !== 1) return;
    const t = e.touches[0];
    if(t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) return;
    if(e.target.closest('input[type="range"]')) return;   // sliders handle their own drag
    x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); active = true;
  }, {passive:true});

  root.addEventListener('touchmove', e => {
    if(!active) return;
    const t = e.touches[0];
    if(!t) return;
    const dx = t.clientX - x0, dy = t.clientY - y0;
    if(!mode){
      if(Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return;
      mode = Math.abs(dx) > Math.abs(dy) * RATIO ? 'h' : 'v';
    }
    if(mode === 'h' && e.cancelable) e.preventDefault();   // only a locked horizontal gesture is captured
  }, {passive:false});

  root.addEventListener('touchend', e => {
    const wasH = active && mode === 'h';
    active = false;
    if(!wasH) return;                                      // vertical / undecided → plain scroll or tap
    const t = e.changedTouches[0];
    if(!t) return;
    const dx = t.clientX - x0, dy = t.clientY - y0;
    if(Math.abs(dx) < MIN_DX || Math.abs(dx) < Math.abs(dy) * RATIO) return;
    if(Date.now() - t0 > MAX_MS) return;
    handleSwipe(dx > 0 ? 'right' : 'left');
  }, {passive:true});

  root.addEventListener('touchcancel', () => { active = false; mode = ''; }, {passive:true});
}

function handleSwipe(dir){
  const vis = $('visualizer'), queue = $('queuePanel');
  if(vis && !vis.classList.contains('hidden')){ if(dir === 'right') closeVisualizer(); return; }
  if(queue && !queue.classList.contains('hidden')){ if(dir === 'left') closeQueuePanel(); return; }
  // swipe right → chapter list; swipe left → visualizer
  if(dir === 'right') openQueuePanel();
  else openVisualizer();
}
