/* player.js — Player screen, Audio playback, Chapters, Visualizer */
import { state, icon, escapeHtml, $, isNative, main, seekStep, isMusic, partName, plugin } from './state.js';
import { loadCover, saveSettings, savePrefsSoon, flushPrefs, writeLastPlayback, getSavedPosition, resumePosition, saveProgressRecord, saveBooks, saveBooksSoon, clearLastPlayback } from './storage.js';
import { dbGet, dbDel } from './db.js';
import { showToast, closeModal, openModal, bookCover, fmt } from './ui-utils.js';
import { render, act } from './router.js';
import { updateHeaderNowPlaying } from './header.js';
import { progress, bookTotal, bookElapsed } from './progress.js';
import { audio, NATIVE, ensureAudioGraph, applyCurrentFileSound, openCurrentSound, ensureAudible, ORDERS, orderIndex } from './sound.js';
import { openBookMenu } from './library.js';
import { closeVisualizer, syncPictureDots } from './visualizer.js';
import { hydrateBookMeta } from './meta.js';
import { bindNativeEvents, stopNativePlayer } from './native-bridge.js';
import { t, getLang } from './i18n.js';

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

/** Speed is remembered per book (b.speed); a book without its own value starts at the last used speed */
function applyBookSpeed(b){
  const v = Number(b?.speed) || Number(state.settings.speed) || 1;
  state.speed = v;
}

/** state.playing must always mirror the real <audio> state (src change silently sets paused=true) */
function syncPlaying(){
  state.playing = !!audio.src && !audio.paused && !audio.ended;
  document.getElementById('playerCover')?.classList.toggle('playing', state.playing);   // vinyl spins / pages slide out only while playing
  return state.playing;
}

/** Page text of the little open book: the start of a public-domain novel in the language of the app */
function bookText(){
  return getLang() === 'en'
    ? ['Chapter I', 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife. However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families.', 'That he is considered the rightful property of some one or other of their daughters. “My dear Mr. Bennet,” said his lady to him one day, “have you heard that Netherfield Park is let at last?” Mr. Bennet replied that he had not.']
    : ['Глава I', 'Мой дядя самых честных правил, когда не в шутку занемог, он уважать себя заставил и лучше выдумать не мог. Его пример другим наука; но, боже мой, какая скука с больным сидеть и день и ночь, не отходя ни шагу прочь!', 'Какое низкое коварство полуживого забавлять, ему подушки поправлять, печально подносить лекарство, вздыхать и думать про себя: когда же чёрт возьмёт тебя!'];
}

/** Animated layer behind the cover: an album gets a record with a tonearm, a book gets an open book beside it whose leaves turn over */
function coverFx(b){
  if(isMusic(b)){
    return '<div class="fx-vinyl" aria-hidden="true"><div class="record"><i class="label"></i></div></div>' +
      '<svg class="fx-arm" viewBox="0 0 140 100" aria-hidden="true"><g class="arm">' +
      '<circle cx="128" cy="10" r="6.5" class="arm-base"/><path d="M128 10 L108 24" class="arm-bar"/><rect x="102" y="21" width="9" height="5.5" rx="1.5" transform="rotate(35 106 24)" class="arm-head"/></g></svg>';
  }
  const [ch, p1, p2] = bookText();
  return `<div class="fx-book" aria-hidden="true"><div class="pg pg-l" data-n="12"><h6>${ch}</h6><p>${p1}</p></div><div class="pg pg-r" data-n="13"><p>${p2}</p></div>` +
    `<div class="lf" data-n="13"><p>${p2}</p></div><div class="lf" data-n="13"><p>${p2}</p></div><div class="lf" data-n="13"><p>${p2}</p></div></div>`;
}

/** Seek within whole book (seconds from the very start of the book) */
async function seekBook(sec){
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
  if(!b.files?.length){ showToast(t('В этой книге нет аудиофайлов')); return; }
  if(state.current?.id !== b.id){
    if(state.current){ snapshotPosition(); await saveProgress(true); }
    audio.pause();
    const saved = getSavedPosition(b);
    state.current = b;
    state.currentIndex = saved.i;
    state.currentPos = resumePosition(saved.t);
    state.playing = false;
    loadedKey = '';
    applyBookSpeed(b);
    state.resumeRewind = true;
  }
  await loadCover(b);                            // covers are read lazily
  state.screen = 'player';
  render();
  await ensureChapterLoaded();
  syncPlaying();
  updatePlayerUI();
  ensureAudible();
}

/** Open the book and start playing it (the catalog's "Listen") */
export async function playBook(id){
  await openPlayer(id);
  if(state.current?.id === id && !state.playing) await togglePlay(true);
}

/** A bookmark: open the book at an exact track/chapter and time, and play */
export async function openPlayerAt(id, index, sec){
  await openPlayer(id);
  const b = state.current;
  if(!b || b.id !== id || !b.files?.[index]) return;
  state.resumeRewind = false;
  await loadChapter(index, Number(sec) || 0, true);
}

export function renderPlayer(){
  const b = state.current;
  if(!b) return;
  if(!b.files?.length){            // a book without files cannot be shown in the player (f.name used to throw here)
    showToast(t('В этой книге нет аудиофайлов'));
    state.screen = 'shelf';
    render();
    return;
  }
  syncPlaying();
  const i = Math.max(0, Math.min(state.currentIndex, b.files.length-1));
  const f = b.files[i];
  const totalDur = bookTotal(b);
  const elapsed = bookElapsed(b);
  const pct = progress(b);

  main.innerHTML = `<section class="player player-fit" id="playerScreen">
    <div class="player-inner">
      <div class="topbar player-top">
        <div style="display:flex;align-items:center;gap:10px">
          <button type="button" class="icon-btn" id="playerBack" aria-label="${t('Назад')}">${icon('back')}</button>
          <div><h2>${t('Плеер')}</h2></div>
        </div>
        <div class="top-actions">
          <button type="button" class="icon-btn" id="playerMark" aria-label="${t('Закладка')}">${icon('bookmark')}</button>
          <button type="button" class="icon-btn" id="playerMore" aria-label="${t('Ещё')}">${icon('more')}</button>
        </div>
      </div>
      <div class="player-cover ${isMusic(b) ? 'is-album' : 'is-book'}${state.playing ? ' playing' : ''}" id="playerCover">${coverFx(b)}${bookCover(b)}</div>
      <div class="pic-dots" aria-hidden="true"></div>
      <div class="player-title">${escapeHtml(b.title)}</div>
      <div class="player-author">${escapeHtml(b.author||t('Автор не указан'))}</div>
      <div class="chapter">${partName(b)} ${i+1} ${t('из')} ${b.files.length} · ${escapeHtml(f.name)}</div>
      <div class="seek"><input id="seekCh" type="range" min="0" max="1000" value="0" aria-label="${t(isMusic(b) ? 'Позиция в треке' : 'Позиция в главе')}"></div>
      <div class="time-row"><span id="chCur">0:00</span><span class="time-label" id="chLabel">${partName(b)}</span><span id="chDur">${fmt(Number(f.duration) || 0)}</span></div>
      <div class="book-progress" id="bookProgress"${isMusic(b) ? ' hidden' : ''}>
        <div class="seek"><input id="seek" type="range" min="0" max="1000" value="${Math.round(pct*10)}" aria-label="${t('Позиция в книге')}"></div>
        <div class="time-row"><span id="curTime">${fmt(elapsed)}</span><span class="time-label">${t('Вся книга')}</span><span id="durTime">${fmt(totalDur)}</span></div>
      </div>
      <div class="controls">
        <button type="button" class="control" id="prevBtn" aria-label="${t(isMusic(b) ? 'Предыдущий трек' : 'Предыдущая глава')}">${icon('prev')}</button>
        <button type="button" class="control" id="backBtn" aria-label="${t('Назад {n} сек.', { n: seekStep() })}">${icon('rewind')}<small class="ctl-val" id="backVal">−${seekStep()}</small></button>
        <button type="button" class="play-main" id="playBtn" aria-label="${t('Воспроизведение')}">${icon(state.playing?'pause':'play')}</button>
        <button type="button" class="control" id="forwardBtn" aria-label="${t('Вперёд {n} сек.', { n: seekStep() })}">${icon('forward')}<small class="ctl-val" id="fwdVal">+${seekStep()}</small></button>
        <button type="button" class="control" id="nextBtn" aria-label="${t(isMusic(b) ? 'Следующий трек' : 'Следующая глава')}">${icon('next')}</button>
      </div>
      <div class="player-tools${b.mode === 'album' ? ' has-order' : ''}">
        <button type="button" class="tool" id="speedBtn"><strong>${state.speed.toFixed(1)}×</strong>${t('Скорость')}</button>
        <button type="button" class="tool" id="sleepBtn"><strong id="sleepLabel">◷</strong>${t('Таймер')}</button>
        <button type="button" class="tool" id="queueBtn"><strong>☷</strong>${t('Очередь')}</button>
        <button type="button" class="tool" id="soundBtn"><strong>♫</strong>${t('Звук')}</button>
        <button type="button" class="tool" id="modeBtn" aria-label="${t('Режим воспроизведения')}"><strong id="modeIcon">${b.mode === 'album' ? '♪' : '▤'}</strong><span id="modeLabel">${t(b.mode === 'album' ? 'Альбом' : 'Книга')}</span></button>
        <button type="button" class="tool" id="orderBtn" aria-label="${t('Порядок треков')}"${b.mode === 'album' ? '' : ' hidden'}><strong id="orderIcon">${orderIconHtml(b)}</strong><span id="orderLabel">${t(ORDER_NAMES[orderOf(b)])}</span></button>
      </div>
      <div class="swipe-hint">${t('Свайп по обложке — визуализатор · по экрану — разделы')}</div>
    </div>
    <div class="side-panel queue-panel hidden" id="queuePanel" aria-hidden="true">
      <div class="side-panel-head">
        <button type="button" class="icon-btn" id="queueClose" aria-label="${t('Закрыть')}">${icon('close')}</button>
        <strong id="queueTitle">${t(isMusic(b) ? 'Треки' : 'Главы')}</strong>
      </div>
      <div class="side-panel-body chapter-list" id="chapterList">${chapterRows(b)}</div>
    </div>
    <div class="visualizer-overlay hidden" id="visualizer" aria-hidden="true">
      <canvas id="visualizerCanvas"></canvas>
      <div class="visualizer-head">
        <button type="button" class="icon-btn visualizer-x" id="visualizerClose" aria-label="${t('Закрыть')}">${icon('close')}</button>
        <div><strong id="visualizerName">${t('Визуализатор')}</strong><span>${escapeHtml(f.name)}</span></div>
      </div>
      <div class="pic-dots pic-dots-viz" aria-hidden="true"></div>
    </div>
  </section>`;

  const on = (id, fn) => { const el = $(id); if(el) el.onclick = fn; };
  on('playerBack', closePlayer);
  on('playBtn', () => togglePlay());
  on('prevBtn', prevTrack);
  on('nextBtn', nextTrack);
  on('backBtn', () => seekBy(-seekStep()));
  on('forwardBtn', () => seekBy(seekStep()));
  const chEl = $('seekCh');
  if(chEl){
    // Current chapter/track slider: dragging previews the time, the jump happens on release
    chEl.addEventListener('input', e => {
      chDragging = true;
      const c = $('chCur');
      if(c) c.textContent = fmt(chapterLength() * (+e.target.value / 1000));
    });
    chEl.addEventListener('change', e => {
      chDragging = false;
      seekChapter(chapterLength() * (+e.target.value / 1000));
    });
    chEl.addEventListener('touchcancel', () => { chDragging = false; updatePlayerUI(); }, {passive:true});
  }
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
  on('modeBtn', toggleMode);
  on('orderBtn', toggleOrder);
  on('playerMark', addBookmark);
  on('queueBtn', openQueuePanel);
  on('queueClose', closeQueuePanel);
  on('playerMore', () => openBookMenu(b.id));
  on('visualizerClose', closeVisualizer);
  bindChapterRows();
  syncPictureDots();
  updatePlayerUI();
  updateSleepLabel();
  if(state.sleepEndsAt > Date.now()) startSleepTicker();
  if(state.playing) ensureAudible();   // returning to the player must never leave "Pause" + silence
  // old libraries: fill missing chapter durations / cover in background
  hydrateBookMeta(b, () => { if(state.screen === 'player' && state.current === b) updatePlayerUI(); });
}

function bindChapterRows(){
  document.querySelectorAll('[data-chapter]').forEach(el => {
    el.onclick = () => { loadChapter(+el.dataset.chapter, 0, true); closeQueuePanel(); };
  });
  document.querySelectorAll('[data-mark]').forEach(el => {
    el.onclick = e => {
      if(e.target.closest('[data-mark-del]')) return;
      const m = state.current?.marks?.[+el.dataset.mark];
      if(m){ loadChapter(m.i, m.t, true); closeQueuePanel(); }
    };
  });
  document.querySelectorAll('[data-track-del]').forEach(el => {
    el.onclick = e => { e.stopPropagation(); openTrackMenu(+el.dataset.trackDel); };
  });
  document.querySelectorAll('[data-mark-del]').forEach(el => {
    el.onclick = e => { e.stopPropagation(); removeBookmark(+el.dataset.markDel); };
  });
}

// ---- an album: take a track out of the list, or delete its file from the phone (not for books) ----
function openTrackMenu(i){
  const b = state.current, f = b?.files?.[i];
  if(!b || !f || b.mode !== 'album') return;
  const canDisk = NATIVE && !!f.uri;
  openModal(`<h3>${escapeHtml(f.name)}</h3>
    <div class="modal-row" id="trackHide"><span style="flex:1">${t('Убрать из списка')}<small style="display:block;color:var(--muted)">${t('Файл останется на телефоне')}</small></span></div>
    ${canDisk ? `<div class="modal-row" id="trackErase" style="color:var(--danger)"><span style="flex:1">${t('Удалить с диска')}<small style="display:block;color:var(--muted)">${t('Файл будет удалён с телефона насовсем')}</small></span></div>` : ''}
    <div class="modal-actions"><button class="secondary" data-close>${t('Отмена')}</button></div>`);
  $('trackHide').onclick = () => { closeModal(); removeTrack(i, false); };
  if(canDisk) $('trackErase').onclick = () => {
    openModal(`<h3>${t('Удалить файл насовсем?')}</h3><p style="color:var(--muted);font-size:13px">${escapeHtml(f.name)}<br>${t('Вернуть его будет нельзя.')}</p><div class="modal-actions"><button class="secondary" data-close>${t('Отмена')}</button><button class="primary" id="trackEraseGo" style="background:var(--danger);color:#fff">${t('Удалить')}</button></div>`);
    $('trackEraseGo').onclick = () => { closeModal(); removeTrack(i, true); };
  };
}

async function removeTrack(i, fromDisk){
  const b = state.current, f = b?.files?.[i];
  if(!b || !f || b.mode !== 'album') return;
  if(fromDisk){
    try { await plugin('ShelfFiles').deleteFile({ uri: f.uri }); }
    catch(e){ showToast(t(String(e?.message || e).includes('denied') ? 'Нет права на удаление: добавьте папку заново (Настройки → Ваши папки)' : 'Не удалось удалить файл')); return; }
  }
  if(b.files.length === 1){                      // the last track: the album itself is gone
    act('unloadCurrent');
    state.books = state.books.filter(x => x.id !== b.id);
    state.screen = 'shelf';
    await saveBooks();
    render();
    showToast(t(fromDisk ? 'Файл удалён, альбом убран из библиотеки' : 'Альбом убран из библиотеки'));
    return;
  }
  const wasPlaying = state.playing, cur = state.currentIndex;
  const pos = i === cur ? 0 : (audio.currentTime || state.currentPos || 0);
  b.files.splice(i, 1);
  if(!fromDisk && f.uri) (b.removed = b.removed || []).push(f.uri);        // a rescan must not bring it back
  if(f.key) dbDel(f.key).catch(() => {});
  b.marks = (b.marks || []).filter(m => m.i !== i).map(m => m.i > i ? { ...m, i: m.i - 1 } : m);
  const ni = i < cur ? cur - 1 : Math.min(cur, b.files.length - 1);
  state.currentIndex = ni; state.currentPos = pos;
  b.pos = { i: ni, t: pos }; b.lastChapterIndex = ni;
  await saveBooks();
  await loadChapter(ni, pos, wasPlaying);        // the native queue is rebuilt without the track; the position is kept
  const list = $('chapterList');
  if(list){ list.innerHTML = chapterRows(b); bindChapterRows(); }
  updatePlayerUI();
  showToast(t(fromDisk ? 'Файл удалён с телефона' : 'Трек убран из списка'));
}

function chapterRows(b){
  let out = '';
  (b.marks || []).forEach((m,k)=>{
    out += `<div class="chapter-row bookmark-row" data-mark="${k}"><span>🔖 ${m.i+1}. ${escapeHtml(b.files[m.i]?.name||partName(b))} · ${fmt(m.t)}</span><button type="button" class="mark-del" data-mark-del="${k}" aria-label="${t('Удалить закладку')}">✕</button></div>`;
  });
  b.files.forEach((f,i)=>{
    out += `<div class="chapter-row ${i===state.currentIndex?'current':''}" data-chapter="${i}"><span>${i+1}. ${escapeHtml(f.name)}</span><span>${i===state.currentIndex?(state.playing?'▶':'Ⅱ'):fmt(f.duration)}</span>${b.mode === 'album' && b.files.length > 0 ? `<button type="button" class="mark-del" data-track-del="${i}" aria-label="${t('Убрать трек')}">⋯</button>` : ''}</div>`;
  });
  return out;
}

async function loadChapter(i, startAt=0, autoplay=true){
  const b = state.current;
  const f = b?.files?.[i];
  if(!f) return;
  const token = ++loadToken;
  state.currentIndex = i;
  state.currentPos = Number(startAt) || 0;
  pendingSeek = state.currentPos;
  restoring = true;            // until metadata is ready, audio.currentTime (0) must not overwrite the position
  loadedKey = `${b.id}:${i}`;

  if(NATIVE){
    // Whole book goes to the native playlist; chapter changes then happen natively (screen off is fine)
    if(!f.uri){ restoring = false; loadedKey = ''; showToast(t('Файл недоступен')); return; }
    const startAt = f.duration > 0 ? Math.min(state.currentPos, Math.max(0, f.duration - 0.5)) : state.currentPos;
    try {
      applyCurrentFileSound();
      audio.playbackRate = state.speed;
      await audio.loadNative(b, i, startAt);
    } catch(e) {
      if(token === loadToken){ restoring = false; loadedKey = ''; }
      showToast(t('Не удалось открыть аудиофайл'));
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
      const blob = await dbGet(f.key);
      if(token !== loadToken) return;
      if(!blob){ restoring = false; loadedKey = ''; showToast(t('Файл недоступен')); return; }
      newBlobUrl = URL.createObjectURL(blob);
      src = newBlobUrl;
    } else if(f.uri){
      src = isNative() ? window.Capacitor.convertFileSrc(f.uri) : f.uri;
    } else {
      restoring = false; loadedKey = '';
      showToast(t('Файл недоступен'));
      return;
    }
  } catch(e) {
    if(token === loadToken){ restoring = false; loadedKey = ''; }
    showToast(t('Не удалось открыть аудиофайл'));
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
      saveBooksSoon(10000, 60000);               // rare, and not urgent: durations are re-read from the file anyway
    }
    snapshotPosition();
    updatePlayerUI();
  };
  audio.onended = () => {
    if(token !== loadToken) return;
    const j = orderOf(b) === 'one' ? i : neighbour(i, 1);
    if(j >= 0){
      // browser fallback of the "album" mode: a short pause between tracks (the native player also fades; see PlayerService)
      if(b.mode === 'album') setTimeout(() => { if(token === loadToken && state.current === b) loadChapter(j, 0, true); }, 2000);
      else loadChapter(j, 0, true);
    } else finishBook();
  };

  syncPlaying();
  updatePlayerUI();
  if(autoplay) await togglePlay(true);
}

async function togglePlay(forcePlay=false){
  if(!state.current) return;
  try {
    if(state.current.finished && (forcePlay || audio.paused || audio.ended)){
      // the book was listened to the end and its position was kept there: "play" starts it again from the beginning
      state.current.finished = false;
      await loadChapter(0, 0, false);
    }
    if(forcePlay || audio.paused || audio.ended){
      await ensureChapterLoaded();           // e.g. widget "play" right after app start
      if(state.resumeRewind){
        // step back a few seconds when listening RESUMES — but never store that shifted value as the saved position
        state.resumeRewind = false;
        const t = resumePosition(state.currentPos);
        if(t < state.currentPos){
          if(restoring) pendingSeek = t;
          audio.currentTime = t; state.currentPos = t;
        }
      }
      await ensureAudioGraph();
      await ensureAudible();                 // unmute, restore volume, resume AudioContext
      await audio.play();
    } else {
      audio.pause();
    }
  } catch(e) {
    if(e?.name !== 'AbortError') showToast(t('Не удалось изменить воспроизведение'));
  }
  syncPlaying();
  updatePlayerUI();
}

let chDragging = false;

/** Length of the current chapter/track in seconds: the real one from the decoder, else the one from the library */
function chapterLength(){
  const d = Number(audio.duration);
  if(Number.isFinite(d) && d > 0) return d;
  return Number(state.current?.files?.[state.currentIndex]?.duration) || 0;
}

function seekChapter(sec){
  if(restoring || !state.current) return;
  const len = chapterLength();
  if(!len) return;
  audio.currentTime = Math.max(0, Math.min(len, Number(sec) || 0));
  state.currentPos = audio.currentTime;
  snapshotPosition();
  saveProgress();
  updatePlayerUI();
}

function seekBy(n){
  if(restoring || !Number.isFinite(audio.duration) || !audio.duration) return;
  audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + n));
  state.currentPos = audio.currentTime;
  updatePlayerUI();
}

// ---- album track order: in order / one track / all on repeat / shuffle (a book always plays chapter after chapter) ----
const ORDER_NAMES = { order: 'Подряд', one: 'Повтор 1', all: 'Повтор', shuffle: 'Случайно' };
const ORDER_TOASTS = { order: 'Порядок: по порядку', one: 'Порядок: один трек по кругу', all: 'Порядок: все треки по кругу', shuffle: 'Порядок: случайно' };
const orderOf = b => (b && b.mode === 'album' && ORDERS.includes(b.order)) ? b.order : 'order';
function orderIconHtml(b){
  const o = orderOf(b);
  return o === 'shuffle' ? icon('shuffle') : o === 'all' ? '↻' : o === 'one' ? '↻<sup>1</sup>' : '→';
}
function syncOrderBtn(){
  const b = state.current, btn = $('orderBtn');
  if(!b || !btn) return;
  const album = b.mode === 'album';
  btn.hidden = !album;
  const tools = btn.parentElement;
  if(tools) tools.classList.toggle('has-order', album);
  const ic = $('orderIcon'), lb = $('orderLabel');
  if(ic) ic.innerHTML = orderIconHtml(b);
  if(lb) lb.textContent = t(ORDER_NAMES[orderOf(b)]);
}
function toggleOrder(){
  const b = state.current;
  if(!b || b.mode !== 'album') return;
  const next = ORDERS[(ORDERS.indexOf(orderOf(b)) + 1) % ORDERS.length];
  b.order = next;
  audio.setOrderMode?.(orderIndex(b));          // native: repeat / shuffle live in the player itself
  savePrefsSoon();
  syncOrderBtn();
  showToast(t(ORDER_TOASTS[next]));
}
/** Browser fallback (and the plain "in order" case): which track comes next / before, or -1 when the album is over */
function neighbour(i, dir){
  const b = state.current, n = b.files.length, o = orderOf(b);
  if(o === 'shuffle'){
    if(n < 2) return i;
    let j; do { j = Math.floor(Math.random() * n); } while(j === i);
    return j;
  }
  const k = i + dir;
  if(k >= 0 && k < n) return k;
  return o === 'all' ? (k < 0 ? n - 1 : 0) : -1;
}

function prevTrack(){
  if(!restoring && audio.currentTime > 6){ audio.currentTime = 0; state.currentPos = 0; updatePlayerUI(); return; }
  if(NATIVE && orderOf(state.current) !== 'order'){ audio.skip(false); audio.play().catch(() => {}); return; }   // the player knows the shuffle order
  const j = neighbour(state.currentIndex, -1);
  if(j >= 0) loadChapter(j, 0, true);
}

function nextTrack(){
  if(NATIVE && orderOf(state.current) !== 'order'){ audio.skip(true); audio.play().catch(() => {}); return; }
  const j = neighbour(state.currentIndex, 1);
  if(j >= 0) loadChapter(j, 0, true);
}

const SPEEDS = [.8, 1, 1.2, 1.5, 1.8, 2];

/** Per-book playback mode, remembered: "book" = gapless; "album" = fade out at the end of a track, short pause, next track */
function toggleMode(){
  const b = state.current;
  if(!b) return;
  b.mode = b.mode === 'album' ? 'book' : 'album';
  const album = b.mode === 'album';
  audio.setAlbumMode?.(album);                   // native only: the service does the fading and the pause
  savePrefsSoon();                               // a few bytes in `bookprefs`, not the library
  const pc = $('playerCover');                    // swap the animation: record <-> pages (the cover itself stays)
  if(pc){
    pc.classList.toggle('is-album', album); pc.classList.toggle('is-book', !album);
    pc.querySelectorAll('.fx-vinyl,.fx-arm,.fx-book').forEach(n => n.remove());
    pc.insertAdjacentHTML('afterbegin', coverFx(b));
  }
  const ic = $('modeIcon'), lb = $('modeLabel');
  if(ic) ic.textContent = album ? '♪' : '▤';
  if(lb) lb.textContent = t(album ? 'Альбом' : 'Книга');
  audio.setOrderMode?.(orderIndex(b));            // a book always plays in order; an album keeps its own order
  syncOrderBtn();
  const trackList = $('chapterList');             // the remove buttons exist only in an album
  if(trackList){ trackList.innerHTML = chapterRows(b); bindChapterRows(); }
  updatePlayerUI();                              // album: only the track bar; book: chapter bar + whole-book bar
  showToast(t(album ? 'Альбом: плавное затухание и пауза между треками' : 'Книга: без пауз между главами'));
}

function cycleSpeed(){
  const current = Number(state.speed) || 1;
  const idx = SPEEDS.indexOf(current);
  state.speed = SPEEDS[(idx !== -1 ? idx + 1 : 1) % SPEEDS.length];
  audio.defaultPlaybackRate = state.speed;
  audio.playbackRate = state.speed;
  state.settings.speed = state.speed;            // default for books that have no speed of their own yet
  if(state.current) state.current.speed = state.speed;
  saveSettings().catch(() => {});                           // 1 small record
  savePrefsSoon();                                          // + the per-book speed (tiny), NOT the library
  const sb = $('speedBtn');
  if(sb) sb.innerHTML = `<strong>${state.speed.toFixed(1)}×</strong>${t('Скорость')}`;
  showToast(t('Скорость: {v}×', { v: state.speed.toFixed(1) }));
}

let sleepTicker = 0;

/** Remaining time on the timer button: mm:ss while a timer runs, "◷" otherwise */
function updateSleepLabel(){
  const el = $('sleepLabel');
  if(!el) return;
  const left = state.sleepEndsAt - Date.now();
  if(left > 0){
    const sec = Math.ceil(left / 1000);
    el.textContent = sec >= 3600 ? fmt(sec) : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  } else {
    el.textContent = '◷';
  }
}

function startSleepTicker(){
  clearInterval(sleepTicker);
  sleepTicker = setInterval(() => {
    if(document.hidden) return;                  // nobody sees the label: no work (the timer itself runs in the native service)
    if(state.sleepEndsAt && state.sleepEndsAt <= Date.now()) state.sleepEndsAt = 0;
    updateSleepLabel();
    if(!state.sleepEndsAt){ clearInterval(sleepTicker); sleepTicker = 0; }
  }, 1000);
}

function setSleep(){
  openModal(`<h3>${t('Таймер сна')}</h3><p style="color:var(--muted);font-size:13px">${t('Введите время в минутах (0 — выключить)')}</p><input class="field" id="sleepInput" type="number" min="0" value="30"><div class="modal-actions"><button class="secondary" data-close>${t('Отмена')}</button><button class="primary" id="sleepSave">${t('Установить')}</button></div>`);
  $('sleepSave').onclick = () => {
    const v = $('sleepInput').value;
    closeModal();
    clearTimeout(state.sleepTimer);
    const n = Number(v);
    if(n > 0){
      state.sleepEndsAt = Date.now() + n * 60000;
      // native: timer lives in the service (JS timers are throttled with the screen off) and fades out the last 15 s
      if(NATIVE) audio.setSleep(n);
      else state.sleepTimer = setTimeout(() => { audio.pause(); state.sleepEndsAt = 0; updateSleepLabel(); }, n * 60000);
      startSleepTicker();
      showToast(t('Таймер: {n} мин', { n }));
    } else {
      state.sleepEndsAt = 0;
      if(NATIVE) audio.setSleep(0);
      showToast(t('Таймер выключен'));
    }
    updateSleepLabel();
  };
}

function renderBookmarks(){
  const list = $('chapterList');
  if(list && state.current){
    list.innerHTML = chapterRows(state.current);
    bindChapterRows();
  }
}

async function addBookmark(){
  const b = state.current;
  if(!b) return;
  b.marks = b.marks || [];
  b.marks.push({i: state.currentIndex, t: Number(state.currentPos) || 0});
  await saveBooks();
  renderBookmarks();
  showToast(t('Закладка добавлена'));
}

async function removeBookmark(k){
  const b = state.current;
  if(!b?.marks?.[k]) return;
  b.marks.splice(k, 1);
  await saveBooks();
  renderBookmarks();
  showToast(t('Закладка удалена'));
}

/** Copy the live position onto the book object (never while audio.currentTime is not valid yet) */
function snapshotPosition(){
  const b = state.current;
  if(!b) return;
  let t;
  if(restoring) t = pendingSeek;
  else if(loadedKey === curKey() && audio.src) t = Number(audio.currentTime) || 0;   // no source/queue loaded: currentTime is meaningless (0)
  else t = Number(state.currentPos) || 0;
  t = Math.max(0, t);
  state.currentPos = t;
  b.pos = {i: state.currentIndex, t};
  b.lastChapterIndex = state.currentIndex;
  b.lastPositionSec = t;
  b.lastSavedAt = Date.now();
  if(b.finished){
    // a finished book stays "finished" only while the position is at its very end (the user may seek back)
    const last = (b.files?.length || 1) - 1;
    const dur = Number(b.files?.[last]?.duration) || 0;
    const atEnd = state.currentIndex >= last && (dur > 0 ? t >= dur - 3 : true);
    if(!atEnd) b.finished = false;
  }
}

/** The last chapter ended: keep the position at the END of the book (100 %, flagged as listened) instead of jumping to 0 % */
function finishBook(){
  const b = state.current;
  if(!b) return;
  audio.pause();
  state.playing = false;
  const last = b.files.length - 1;
  const dur = Number(b.files[last].duration) || (Number.isFinite(audio.duration) ? audio.duration : 0);
  state.currentIndex = last;
  state.currentPos = dur;
  b.finished = true;
  b.lastChapterIndex = last;
  b.lastPositionSec = dur;
  b.pos = {i: last, t: dur};
  b.lastSavedAt = Date.now();
  writeLastPlayback();
  saveProgress(true);
  updatePlayerUI();
}

async function saveProgress(force = false){
  if(!state.current) return;
  snapshotPosition();
  writeLastPlayback();
  const b = state.current;
  if(force){
    clearTimeout(progressSaveTimer);
    progressSaveTimer = null;
    flushPrefs().catch(() => {});                // EQ/speed typed in the last second must survive the app being closed
    try { await saveProgressRecord(b); } catch { /* the position is also in localStorage and in the native service */ }
    return;
  }
  if(progressSaveTimer) return;
  // the position itself is already in localStorage (writeLastPlayback above); the IDB record is tiny (only this
  // book's position, no covers, no library) and is coalesced to once per 20 s while playing
  progressSaveTimer = setTimeout(async () => {
    progressSaveTimer = null;
    try { await saveProgressRecord(state.current || b); } catch { }
  }, 20000);
}

function updatePlayerUI(){
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
    // current chapter / track
    const album = isMusic(b);
    const chLen = chapterLength();
    const chPos = Math.max(0, Math.min(chLen || Infinity, Number(state.currentPos) || 0));
    if(!chDragging){
      const sc = $('seekCh');
      if(sc) sc.value = chLen > 0 ? Math.round(Math.min(1, chPos / chLen) * 1000) : 0;
      const cc = $('chCur');
      if(cc) cc.textContent = fmt(chPos);
    }
    const cd = $('chDur');
    if(cd) cd.textContent = fmt(chLen);
    const bp = $('bookProgress');                  // album: only the current track, no whole-book bar
    if(bp) bp.hidden = album;
    const cl = $('chLabel');
    if(cl) cl.textContent = partName(b);
    const pb = $('playBtn');
    if(pb) pb.innerHTML = icon(state.playing ? 'pause' : 'play');
    const ch = document.querySelector('.chapter');
    if(ch) ch.textContent = `${partName(b)} ${state.currentIndex+1} ${t('из')} ${b.files.length} · ${f?.name||''}`;
    const qt = $('queueTitle');
    if(qt) qt.textContent = t(album ? 'Треки' : 'Главы');
    const pv = $('prevBtn'), nx = $('nextBtn');
    if(pv) pv.setAttribute('aria-label', t(album ? 'Предыдущий трек' : 'Предыдущая глава'));
    if(nx) nx.setAttribute('aria-label', t(album ? 'Следующий трек' : 'Следующая глава'));
    document.querySelectorAll('[data-chapter]').forEach(el => {
      el.classList.toggle('current', +el.dataset.chapter === state.currentIndex);
    });
    updateSleepLabel();
    updateHeaderNowPlaying();
  });
}

function openQueuePanel(){
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

function closePlayer(){
  closeVisualizer();
  saveProgress(true);
  state.screen = 'shelf';
  render();
}

/**
 * The current book is gone (deleted book / deleted folder): stop EVERYTHING that still refers to it —
 * the <audio> element, the native service (queue + notification), timers, the visualizer and the saved resume record.
 */
export function unloadCurrent(){
  const b = state.current;
  clearTimeout(progressSaveTimer); progressSaveTimer = null;
  loadToken++;
  closeVisualizer();
  audio.pause();
  stopNativePlayer();
  if(state.blobUrl){ URL.revokeObjectURL(state.blobUrl); state.blobUrl = ''; }
  clearTimeout(state.sleepTimer); state.sleepEndsAt = 0;
  loadedKey = ''; pendingSeek = 0; restoring = false;
  state.current = null; state.currentIndex = 0; state.currentPos = 0; state.playing = false;
  if(b) clearLastPlayback(b.id);
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

// NOTE: the native player must NOT be stopped here — the WebView going away (screen off, app in background)
// must not interrupt playback. The service stops itself when the app is swiped from recents.
window.addEventListener('pagehide', () => { saveProgress(true); });
window.addEventListener('beforeunload', () => { saveProgress(true); });
audio.addEventListener('error', e => { restoring = false; showToast(t('Ошибка воспроизведения файла')); });

function setMediaSession(){
  if(NATIVE || !('mediaSession' in navigator) || !state.current) return;   // native: Media3 session owns notification/lock screen
  const b = state.current, f = b.files[state.currentIndex];
  try {
    navigator.mediaSession.metadata = new MediaMetadata({title: f?.name || b.title, artist: b.author || b.title, album: b.title, artwork: b.cover?[{src: b.cover, sizes:'512x512'}]:[]});
    navigator.mediaSession.playbackState = state.playing ? 'playing' : 'paused';
    navigator.mediaSession.setActionHandler('play', () => togglePlay(true));
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    // "stop" = pause and keep the position (never rewind to 0)
    navigator.mediaSession.setActionHandler('stop', () => audio.pause());
    navigator.mediaSession.setActionHandler('previoustrack', prevTrack);
    navigator.mediaSession.setActionHandler('nexttrack', nextTrack);
    navigator.mediaSession.setActionHandler('seekbackward', () => seekBy(-seekStep()));
    navigator.mediaSession.setActionHandler('seekforward', () => seekBy(seekStep()));
  } catch {}
}

// --- Native engine events (wiring lives in native-bridge.js; the state it touches lives here) ---------------
bindNativeEvents({
  trackChange(idx){
    if(!state.current) return;
    if(idx === state.currentIndex && loadedKey === curKey()) return;
    state.currentIndex = idx; state.currentPos = 0; pendingSeek = 0; restoring = false;
    loadedKey = curKey();
    snapshotPosition(); saveProgress(true);
    const list = $('chapterList');
    if(list){ list.innerHTML = chapterRows(state.current); bindChapterRows(); }
    updatePlayerUI();
  },
  durationChange(d){
    const f = state.current?.files?.[state.currentIndex];
    if(!f || !(d > 0) || loadedKey !== curKey()) return;
    if(Math.abs((Number(f.duration) || 0) - d) > 0.5){
      f.duration = d;
      saveBooksSoon(10000, 60000);
    }
  },
  ended(){
    if(!state.current) return;
    finishBook();
  },
  closed(){
    saveProgress(true);
    loadedKey = '';
    syncPlaying(); updatePlayerUI();
  }
});
