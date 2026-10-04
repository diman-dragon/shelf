/* player.js — Player screen, Audio playback, Chapters, Visualizer */
import { state, icon, escapeHtml, fmt, uid, plural, plugin, $, isNative, main } from './state.js';
import { persist, writeLastPlayback } from './storage.js';
import { showToast, closeModal, openModal, bookCover, render, updateHeaderNowPlaying, openPlaylistChooser, progress } from './ui.js';
import { audio, ensureAudioGraph, audioContext, analyser, applyCurrentFileSound, openCurrentSound } from './sound.js';
import { openBookMenu } from './library.js';

const { get, set } = window.idbKeyval || {};
let visualizerFrame = 0;
let visualizerOpen = false;
let progressSaveTimer = null;
let lastSavedSecond = -1;

/** Elapsed seconds across whole book */
export function bookElapsed(b = state.current){
  if(!b) return 0;
  const files = b.files || [];
  const i = Math.max(0, Math.min(state.current?.id === b.id ? state.currentIndex : (b.pos?.i||0), files.length-1));
  let t = state.current?.id === b.id ? (Number(audio.currentTime)||Number(state.currentPos)||0) : (Number(b.pos?.t)||0);
  const before = files.slice(0, i).reduce((a,f)=>a+(Number(f.duration)||0), 0);
  return before + t;
}

/** Seek within whole book (seconds from start) */
export async function seekBook(sec){
  const b = state.current;
  if(!b) return;
  const files = b.files || [];
  let left = Math.max(0, sec);
  for(let i=0;i<files.length;i++){
    const d = Number(files[i].duration) || 0;
    if(d > 0 && left > d && i < files.length-1){ left -= d; continue; }
    if(i === state.currentIndex){
      audio.currentTime = Math.min(left, audio.duration || left);
      state.currentPos = audio.currentTime;
      updatePlayerUI();
      return;
    }
    await loadChapter(i, left, state.playing);
    return;
  }
}


export async function openPlayer(id){
  const b = state.books.find(x => x.id === id);
  if(!b) return;
  if(state.current?.id === b.id){
    state.screen = 'player';
    render();
    if(!state.blobUrl) await loadChapter(state.currentIndex, state.currentPos, false);
    return;
  }
  if(state.current) await saveProgress();
  state.current = b;
  state.playing = false;
  state.currentIndex = Math.max(0, Math.min(Number(b.pos?.i)||0, b.files.length-1));
  const saved = Number(b.pos?.t) || 0;
  state.currentPos = saved > 0 ? Math.max(0, saved - 10) : 0;
  state.screen = 'player';
  render();
  await loadChapter(state.currentIndex, state.currentPos, false);
}

export function renderPlayer(){
  const b = state.current;
  if(!b) return;
  const i = Math.min(state.currentIndex, b.files.length-1);
  const f = b.files[i];
  const totalDur = (b.files||[]).reduce((a,x)=>a+(Number(x.duration)||0),0);
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
          <button type="button" class="icon-btn" id="playerPlaylist" aria-label="В плейлист">${icon('playlist')}</button>
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
  if(seekEl) seekEl.oninput = e => {
    const total = (state.current.files||[]).reduce((a,x)=>a+(Number(x.duration)||0),0);
    if(total > 0) seekBook(total * (+e.target.value/1000));
  };
  on('speedBtn', cycleSpeed);
  on('sleepBtn', setSleep);
  on('soundBtn', openCurrentSound);
  on('playerMark', addBookmark);
  on('playerPlaylist', () => openPlaylistChooser(b.id));
  on('queueBtn', openQueuePanel);
  on('queueClose', closeQueuePanel);
  on('playerMore', () => openBookMenu(b.id));
  on('visualizerClose', closeVisualizer);
  document.querySelectorAll('[data-chapter]').forEach(el => el.onclick = () => { loadChapter(+el.dataset.chapter, 0, true); closeQueuePanel(); });
  document.querySelectorAll('[data-mark]').forEach(el => el.onclick = () => {
    const m = b.marks?.[+el.dataset.mark];
    if(m){ loadChapter(m.i, m.t, true); closeQueuePanel(); }
  });
  bindPlayerSwipe();
  updatePlayerUI();
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
  if(!b || !b.files[i]) return;
  state.currentIndex = i;
  state.currentPos = t || 0;
  const f = b.files[i];
  try {
    if(f.key){
      const blob = await get?.(f.key);
      if(!blob){ showToast('Файл недоступен'); return; }
      if(state.blobUrl) URL.revokeObjectURL(state.blobUrl);
      state.blobUrl = URL.createObjectURL(blob);
      audio.src = state.blobUrl;
    } else if(f.uri){
      audio.src = isNative() ? window.Capacitor.convertFileSrc(f.uri) : f.uri;
    } else {
      showToast('Файл недоступен');
      return;
    }
  } catch(e) {
    console.error('Audio load error:', e);
    showToast('Не удалось открыть аудиофайл');
    return;
  }
  audio.playbackRate = state.speed;
  applyCurrentFileSound();
  audio.onloadedmetadata = () => {
    if(state.currentPos) audio.currentTime = Math.min(state.currentPos, audio.duration || state.currentPos);
    if(audio.duration && (!f.duration || f.duration !== audio.duration)){
      f.duration = audio.duration;
      clearTimeout(progressSaveTimer);
      progressSaveTimer = setTimeout(() => { set?.('books', state.books); }, 1500);
    }
    updatePlayerUI();
  };
  audio.onended = () => {
    if(i < b.files.length - 1) loadChapter(i+1, 0, true);
    else { b.pos = {i:0, t:0}; saveProgress(); }
  };
  updatePlayerUI();
  if(autoplay) togglePlay(true);
}

export async function togglePlay(forcePlay=false){
  if(!state.current) return;
  try {
    if(forcePlay || audio.paused || audio.ended){
      await ensureAudioGraph();
      if(audioContext?.state === 'suspended') await audioContext.resume();
      await audio.play();
    } else {
      audio.pause();
    }
    updatePlayerUI();
  } catch(e) { showToast('Не удалось изменить воспроизведение'); }
}

export function seekBy(n){
  if(audio.duration) audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + n));
}

export function prevTrack(){
  if(audio.currentTime > 6) audio.currentTime = 0;
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
  audio.playbackRate = state.speed;
  showToast(`Скорость: ${state.speed.toFixed(1)}×`);
}

export function setSleep(){
  const v = prompt('Таймер сна, минут. 0 — выключить', '30');
  if(v === null) return;
  clearTimeout(state.sleepTimer);
  const n = Number(v);
  if(n > 0){
    state.sleepTimer = setTimeout(() => audio.pause(), n * 60000);
    showToast(`Таймер: ${n} мин`);
  } else showToast('Таймер выключен');
}

export async function addBookmark(){
  const b = state.current;
  if(!b) return;
  b.marks = b.marks || [];
  b.marks.push({i: state.currentIndex, t: audio.currentTime || 0});
  await set?.('books', state.books);
  renderPlayer();
  showToast('Закладка добавлена');
}

export async function saveProgress(){
  const b = state.current;
  if(!b) return;
  const t = Number(audio.currentTime) || Number(state.currentPos) || 0;
  b.pos = {i: state.currentIndex, t: Math.max(0, t)};
  state.currentPos = t;
  writeLastPlayback();
  try { await set?.('books', state.books); } catch {}
}

export function scheduleProgressSave(force=false){
  if(!state.current) return;
  const t = Number(audio.currentTime) || 0;
  state.currentPos = t;
  state.current.pos = {i: state.currentIndex, t};
  writeLastPlayback();
  if(force){ clearTimeout(progressSaveTimer); progressSaveTimer = null; saveProgress(); return; }
  if(progressSaveTimer) return;
  progressSaveTimer = setTimeout(() => { progressSaveTimer = null; saveProgress(); }, 1200);
}

export function updatePlayerUI(){
  if(!state.current) return;
  const b = state.current, f = b.files[state.currentIndex];
  const total = (b.files||[]).reduce((a,x)=>a+(Number(x.duration)||0),0);
  const elapsed = bookElapsed(b);
  const pct = total > 0 ? (elapsed / total) * 100 : progress(b);
  const seek = $('seek');
  if(seek) seek.value = Math.round(pct * 10);
  const ct = $('curTime'), dt = $('durTime');
  if(ct) ct.textContent = fmt(elapsed);
  if(dt) dt.textContent = fmt(total || audio.duration || f?.duration);
  const pb = $('playBtn');
  if(pb) pb.innerHTML = icon(state.playing ? 'pause' : 'play');
  const ch = document.querySelector('.chapter');
  if(ch) ch.textContent = `Глава ${state.currentIndex+1} из ${b.files.length} · ${f?.name||''}`;
  // highlight current chapter in queue if open
  document.querySelectorAll('[data-chapter]').forEach(el => {
    el.classList.toggle('current', +el.dataset.chapter === state.currentIndex);
  });
  updateHeaderNowPlaying();
}

export function openQueuePanel(){
  closeVisualizer();
  const panel = $('queuePanel');
  if(!panel) return;
  const list = $('chapterList');
  if(list && state.current) list.innerHTML = chapterRows(state.current);
  document.querySelectorAll('[data-chapter]').forEach(el => el.onclick = () => { loadChapter(+el.dataset.chapter, 0, true); closeQueuePanel(); });
  document.querySelectorAll('[data-mark]').forEach(el => {
    el.onclick = () => {
      const m = state.current?.marks?.[+el.dataset.mark];
      if(m){ loadChapter(m.i, m.t, true); closeQueuePanel(); }
    };
  });
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
  scheduleProgressSave(true);
  state.screen = 'shelf';
  render();
}

audio.addEventListener('play', async () => { state.playing = true; updatePlayerUI(); await saveProgress(); setMediaSession(); });
audio.addEventListener('pause', async () => { state.playing = false; updatePlayerUI(); await saveProgress(); setMediaSession(); });

audio.addEventListener('timeupdate', () => {
  if(!state.current) return;
  state.currentPos = audio.currentTime;
  state.current.pos = {i: state.currentIndex, t: audio.currentTime};
  updatePlayerUI();
  updateHeaderNowPlaying();
  const sec = Math.floor(audio.currentTime);
  if(sec !== lastSavedSecond && sec % 5 === 0){ lastSavedSecond = sec; scheduleProgressSave(); }
});
audio.addEventListener('seeking', () => scheduleProgressSave());
audio.addEventListener('seeked', () => scheduleProgressSave(true));
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') scheduleProgressSave(true); });

export function stopNativePlayer(){ const P = plugin('Player'); if(P) P.stop().catch(()=>{}); }
window.addEventListener('pagehide', () => { stopNativePlayer(); scheduleProgressSave(true); });
window.addEventListener('beforeunload', () => { stopNativePlayer(); scheduleProgressSave(true); });
audio.addEventListener('error', e => { console.error('Audio element error:', e); showToast('Ошибка воспроизведения файла'); });

export function setMediaSession(){
  if(!('mediaSession' in navigator) || !state.current) return;
  const b = state.current, f = b.files[state.currentIndex];
  try {
    navigator.mediaSession.metadata = new MediaMetadata({title: f?.name || b.title, artist: b.author || b.title, album: b.title, artwork: b.cover?[{src: b.cover, sizes:'512x512'}]:[]});
    navigator.mediaSession.playbackState = state.playing ? 'playing' : 'paused';
    navigator.mediaSession.setActionHandler('play', () => togglePlay(true));
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('previoustrack', prevTrack);
    navigator.mediaSession.setActionHandler('nexttrack', nextTrack);
    navigator.mediaSession.setActionHandler('seekbackward', () => seekBy(-10));
    navigator.mediaSession.setActionHandler('seekforward', () => seekBy(30));
  } catch {}
}

(function nativeBridge(){
  const P = plugin('Player');
  if(!P) return;
  const push = () => {
    if(!state.current) return;
    const b = state.current, f = b.files[state.currentIndex];
    P.update({title: f?.name||b.title, artist: b.author||b.title, playing: state.playing, pos: audio.currentTime||0, dur: audio.duration||f?.duration||0, cover: b.cover&&b.cover.length<400000?b.cover:''}).catch(()=>{});
  };
  ['play','pause','loadedmetadata','seeked','timeupdate'].forEach(ev => audio.addEventListener(ev, () => {
    if(ev !== 'timeupdate' || Math.floor(audio.currentTime)%5 === 0) push();
  }));
  P.addListener('action', e => {
    const a = e?.a;
    if(a === 'toggle') togglePlay();
    else if(a === 'play') togglePlay(true);
    else if(a === 'pause') audio.pause();
    else if(a === 'prev' || a === 'back10') a === 'prev' ? prevTrack() : seekBy(-10);
    else if(a === 'next') nextTrack();
    else if(a === 'forward') seekBy(30);
  });
})();

function bindPlayerSwipe(){
  const root = $('playerScreen');
  if(!root || root.dataset.swipeBound) return;
  root.dataset.swipeBound = '1';
  let x0 = 0, y0 = 0, tracking = false;
  root.addEventListener('touchstart', e => {
    if(!e.touches[0]) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; tracking = true;
  }, {passive:true});
  root.addEventListener('touchend', e => {
    if(!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    if(!t) return;
    const dx = t.clientX - x0, dy = t.clientY - y0;
    if(Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy)) return;
    // swipe right → chapter list; swipe left → visualizer
    if(dx > 0) openQueuePanel();
    else openVisualizer();
  }, {passive:true});
}

export function openVisualizer(){
  const el = $('visualizer');
  if(!el) return;
  visualizerOpen = true;
  el.classList.remove('hidden');
  el.setAttribute('aria-hidden', 'false');
  ensureAudioGraph().then(() => startVisualizer()).catch(() => showToast('Визуализатор недоступен'));
}

export function closeVisualizer(){
  visualizerOpen = false;
  const el = $('visualizer');
  if(el){ el.classList.add('hidden'); el.setAttribute('aria-hidden', 'true'); }
  stopVisualizer();
}

export function startVisualizer(){
  const canvas = $('visualizerCanvas');
  if(!canvas || !analyser) return;
  stopVisualizer();
  const ctx = canvas.getContext('2d');
  const data = new Uint8Array(analyser.frequencyBinCount);
  const draw = () => {
    if(!visualizerOpen){ visualizerFrame = 0; return; }
    const dpr = Math.min(window.devicePixelRatio||1, 2), w = canvas.clientWidth, h = canvas.clientHeight;
    if(canvas.width !== Math.floor(w*dpr) || canvas.height !== Math.floor(h*dpr)){
      canvas.width = Math.floor(w*dpr); canvas.height = Math.floor(h*dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    analyser.getByteFrequencyData(data); ctx.clearRect(0,0,w,h);
    const cx = w/2, cy = h*.55;
    const bg = ctx.createRadialGradient(cx,cy,20,cx,cy,Math.max(w,h)*.7);
    bg.addColorStop(0,'rgba(225,169,91,.16)'); bg.addColorStop(.35,'rgba(110,67,35,.08)'); bg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = bg; ctx.fillRect(0,0,w,h);
    ctx.strokeStyle = 'rgba(239,188,112,.10)'; ctx.lineWidth = 1;
    for(let r=70; r<Math.min(w,h)*.42; r+=42){ ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke(); }
    const n = 96; const points = [];
    for(let i=0; i<n; i++){
      const idx = Math.floor(i*data.length/n); const v = data[idx]/255;
      const a = (i/n)*Math.PI*2 - Math.PI/2;
      const r = Math.min(w,h)*.18 + v*Math.min(w,h)*.16;
      points.push([cx+Math.cos(a)*r, cy+Math.sin(a)*r, v]);
    }
    const grad = ctx.createLinearGradient(0,0,w,h);
    grad.addColorStop(0,'#ffd99a'); grad.addColorStop(.5,'#e0a35d'); grad.addColorStop(1,'#a9633d');
    ctx.beginPath(); points.forEach((p,i)=>{ i ? ctx.lineTo(p[0],p[1]) : ctx.moveTo(p[0],p[1]); }); ctx.closePath();
    ctx.strokeStyle = grad; ctx.lineWidth = 2.2; ctx.shadowBlur = 18; ctx.shadowColor = 'rgba(230,168,91,.55)'; ctx.stroke(); ctx.shadowBlur = 0;
    const bars = 48, base = Math.min(w,h)*.29;
    for(let i=0; i<bars; i++){
      const idx = Math.floor(i*data.length/bars); const v = data[idx]/255;
      const a = (i/bars)*Math.PI*2 - Math.PI/2;
      const inner = base+4, outer = base+10+v*Math.min(w,h)*.12;
      ctx.strokeStyle = `rgba(240,183,103,${.22+v*.65})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx+Math.cos(a)*inner, cy+Math.sin(a)*inner); ctx.lineTo(cx+Math.cos(a)*outer, cy+Math.sin(a)*outer); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(247,238,220,.72)'; ctx.font = '600 12px Inter,system-ui'; ctx.textAlign = 'center'; ctx.fillText('AUDIO', cx, cy-3);
    ctx.fillStyle = 'rgba(247,238,220,.30)'; ctx.font = '500 8px Inter,system-ui'; ctx.letterSpacing = '3px'; ctx.fillText('S H E L f', cx, cy+14);
    visualizerFrame = requestAnimationFrame(draw);
  };
  draw();
}

export function stopVisualizer(){
  if(visualizerFrame){ cancelAnimationFrame(visualizerFrame); visualizerFrame = 0; }
}
