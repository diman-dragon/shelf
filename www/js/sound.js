/* sound.js — playback engine facade, Equalizer, Sound Enhancements
 *
 * Two backends behind ONE object, `audio`, which mimics the small part of HTMLMediaElement that player.js uses:
 *   - NATIVE (Android app): ExoPlayer (Media3) inside PlayerService. EQ / headroom / limiter run in the native
 *     audio pipeline (AudioFx.java), so playback does not depend on the WebView or on the screen being on.
 *   - WEB (browser / fallback): <audio> + Web Audio graph, with headroom compensation and a limiter.
 */
import { state, icon, escapeHtml, $, isNative, plugin } from './state.js';
import { saveBooksSoon } from './storage.js';
import { closeModal } from './ui-utils.js';

const NativePlayer = isNative() ? plugin('Player') : null;
export const NATIVE = !!NativePlayer;

// DSP constants live in www/dsp.json. The SAME file generates DspConfig.java (android/app/build.gradle),
// so the web graph and the native AudioFx can never drift apart.
const DSP = await fetch(new URL('../dsp.json', import.meta.url)).then(r => {
  if(!r.ok) throw new Error('dsp.json: HTTP ' + r.status);
  return r.json();
});
const EQ_BANDS = DSP.bands;
const SPECTRUM_BINS = 128;

const SOUND_PRESETS = {
  flat:{name:'Плоский',gain:0,eq:[0,0,0,0,0,0,0,0,0,0]},
  voice:{name:'Голос',gain:0,eq:[-3,-2,-1,2,3,4,3,2,1,0]},
  bass:{name:'Бас',gain:0,eq:[4,3,2,1,0,-1,-1,-1,0,0]},
  rock:{name:'Рок',gain:0,eq:[3,2,1,-1,-1,1,2,3,3,2]},
  classical:{name:'Классика',gain:0,eq:[2,1,1,0,0,0,1,1,2,2]},
  jazz:{name:'Джаз',gain:0,eq:[2,1,1,0,-1,1,2,2,1,1]},
  night:{name:'Ночь',gain:-2,eq:[-2,-1,0,1,2,1,0,-2,-3,-4]}
};

function ensureBookSound(b){
  if(!b) return null;
  // IMPORTANT: update b.sound IN PLACE. Replacing the object (b.sound = {...}) left the handlers of the
  // sound modal holding a stale copy, so presets / reset / volume were written to an object the engine never read.
  if(!b.sound || typeof b.sound !== 'object') b.sound = {};
  const s = b.sound, d = {preset:'flat', volume:1, gain:0, skipSilence:false};
  for(const k in d) if(s[k] === undefined) s[k] = d[k];
  if(!Array.isArray(s.eq) || s.eq.length !== EQ_BANDS.length) s.eq = EQ_BANDS.map(() => 0);
  return s;
}

/* =====================================================================================
 *  NATIVE backend facade
 * ===================================================================================== */
// signature of the queue loaded in the native player: a hash of ALL uris (the old "sum of uri lengths" collided
// for different books with equally long paths)
function hashStr(str){
  let h = 0x811c9dc5;
  for(let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
const sigOf = b => `${b.id}|${b.files.length}|${hashStr(b.files.map(f => f.uri || '').join('\n'))}`;

class NativeAudio extends EventTarget {
  constructor(P){
    super();
    this.P = P;
    this.isNative = true;
    this.queueSig = '';          // which book is loaded in the native player ('' = nothing / service closed)
    this.fft = null;
    this.defaultPlaybackRate = 1; this.muted = false; this.volume = 1; this.preload = 'auto';
    this._paused = true; this._ended = false; this._playing = false;
    this._pos = 0; this._ts = 0; this._dur = 0; this._rate = 1; this._index = -1; this._bookId = '';
    this._loading = 0;
    this._sleepGuard = 0;        // ignore native sleepLeft right after JS set a new timer (the service applies it asynchronously)
    P.addListener('state', s => this._apply(s));
    P.addListener('error', e => {
      const ev = new Event('error'); ev.detail = e; this.dispatchEvent(ev);
    });
    P.addListener('closed', () => {
      this._pos = this.currentTime; this._ts = performance.now();   // freeze the REAL last position before anything is reset
      this.queueSig = ''; this._index = -1; this._bookId = ''; state.sleepEndsAt = 0;
      const was = !this._paused;
      this._paused = true; this._playing = false;
      this.dispatchEvent(new Event('closed'));
      if(was) this.dispatchEvent(new Event('pause'));
    });
    P.addListener('fft', e => { this.fft = e?.d || null; });
  }

  // --- HTMLMediaElement-like surface used by player.js ---
  get paused(){ return this._paused; }
  get ended(){ return this._ended; }
  get src(){ return this.queueSig; }
  set src(_v){ /* queue is set via loadNative() */ }
  get duration(){ return this._dur > 0 ? this._dur : NaN; }
  get currentTime(){
    if(this._playing) return this._pos + ((performance.now() - this._ts) / 1000) * this._rate;
    return this._pos;
  }
  set currentTime(v){
    v = Math.max(0, Number(v) || 0);
    this._pos = v; this._ts = performance.now();
    if(this.queueSig) this.P.seekTo({pos: v}).catch(() => {});
  }
  get playbackRate(){ return this._rate; }
  set playbackRate(v){
    this._rate = Number(v) || 1;
    if(this.queueSig) this.P.setSpeed({speed: this._rate}).catch(() => {});
  }

  async play(){
    this._paused = false; this._ended = false;
    this.dispatchEvent(new Event('play'));
    try { await this.P.play(); }
    catch(e){ this._paused = true; this._playing = false; this.dispatchEvent(new Event('pause')); throw e; }
  }
  pause(){
    if(!this.queueSig || this._paused) return;
    this._pos = this.currentTime; this._ts = performance.now();
    this._paused = true; this._playing = false;
    this.dispatchEvent(new Event('pause'));
    this.P.pause().catch(() => {});
  }

  // --- native specifics ---
  hasQueue(b){ return !!b && this.queueSig === sigOf(b); }

  /** The book was removed / the native player was stopped: forget everything about the loaded queue */
  reset(){
    this.queueSig = ''; this._index = -1; this._bookId = '';
    this._paused = true; this._playing = false; this._ended = false;
    this._pos = 0; this._dur = 0; this.fft = null;
  }

  /** Load the whole book as a native playlist (or just seek, if it is already loaded) */
  async loadNative(b, index, pos){
    const sig = sigOf(b);
    this._loading++;
    try {
      if(this.queueSig === sig){
        await this.P.seekTo({index, pos});
      } else {
        await this.P.setQueue({
          items: b.files.map(f => ({uri: f.uri || '', title: f.name || b.title})),
          bookId: b.id, bookTitle: b.title || '', author: b.author || '',
          cover: (b.cover && b.cover.length < 400000) ? b.cover : '',
          index, pos, play: false, speed: state.speed || 1
        });
        this.queueSig = sig;
      }
      this._bookId = b.id; this._index = index; this._pos = pos; this._ts = performance.now(); this._ended = false;
      const st = await this.P.getState();
      this._applyNow(st);
      // the controller may not have caught up with setMediaItems() yet and still report position 0: trust what we just asked for
      if(!this._playing && st && st.index === index && this._pos < pos - 0.5) this._pos = pos;
    } finally { this._loading--; }
  }

  /** If the native service already plays this book (app restarted while it kept playing), take over its state */
  async adopt(b){
    let st;
    try { st = await this.P.getState(); } catch { return null; }
    if(!st || !st.loaded || st.bookId !== b.id || st.count !== b.files.length) return null;
    this.queueSig = sigOf(b); this._bookId = b.id; this._index = st.index;
    this._applyNow(st);
    return st;
  }

  async resync(){
    if(!this.queueSig) return;
    try { this._apply(await this.P.getState()); } catch {}
  }

  setSleep(minutes){
    this._sleepGuard = performance.now() + 1500;
    return this.P.setSleepTimer({minutes}).catch(() => {});
  }
  setSkipSilence(on){ return this.P.setSkipSilence({on: !!on}).catch(() => {}); }

  _apply(s){
    if(this._loading || !this.queueSig || !s) return;
    // The service reports an EMPTY queue (position 0, no book) while it shuts down — notification "X", stop(), deleted book.
    // Applying that state used to fire "pause" + "trackchange" and overwrite the saved position with 0.
    if(!s.bookId || !(s.count > 0)) return;
    if(this._bookId && s.bookId !== this._bookId) return;   // late event of a previous book
    this._applyNow(s);
  }

  _applyNow(s){
    if(!s) return;
    const wasPaused = this._paused, wasPlaying = this._playing, wasEnded = this._ended, oldDur = this._dur;
    this._rate = Number(s.speed) || 1;
    this._dur = Number(s.dur) || 0;
    this._pos = Number(s.pos) || 0; this._ts = performance.now();
    this._ended = s.state === 4;
    this._paused = !s.playWhenReady;
    this._playing = !!s.playing;
    if(typeof s.sleepLeft === 'number' && performance.now() > this._sleepGuard){
      state.sleepEndsAt = s.sleepLeft > 0 ? Date.now() + s.sleepLeft * 1000 : 0;   // remaining time shown on the timer button
    }
    if(typeof s.index === 'number' && s.index !== this._index){
      this._index = s.index;
      const ev = new Event('trackchange'); ev.detail = {index: s.index}; this.dispatchEvent(ev);
    }
    if(this._dur !== oldDur) this.dispatchEvent(new Event('durationchange'));
    if(wasPaused && !this._paused) this.dispatchEvent(new Event('play'));
    if(!wasPaused && this._paused) this.dispatchEvent(new Event('pause'));
    if(!wasPlaying && this._playing) this.dispatchEvent(new Event('playing'));
    this.dispatchEvent(new Event('timeupdate'));
    if(this._ended && !wasEnded) this.dispatchEvent(new Event('ended'));
  }
}

/* =====================================================================================
 *  Shared helpers (same constants as AudioFx.java)
 * ===================================================================================== */
const Q_PEAK = DSP.qPeak, HEADROOM = DSP.headroom;
const isFlat = s => !s.eq.some(v => Number(v)) && !Number(s.gain) && Number(s.volume ?? 1) === 1;

/**
 * Worst-case boost (dB) of the EQ cascade — used to lower the pre-gain so boosts never reach 0 dBFS.
 * The response is read from the browser's own BiquadFilterNodes (getFrequencyResponse) on a throw-away offline context,
 * so there is no second implementation of the filter maths here (the native side has its own, see AudioFx.java).
 */
let probeCtx = null;
function peakBoostDb(s, rate = 48000){
  try {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if(!OAC) return 0;
    probeCtx = probeCtx || new OAC(1, 1, rate);
    const N = 160, freqs = new Float32Array(N), mag = new Float32Array(N), phase = new Float32Array(N), total = new Float32Array(N).fill(1);
    for(let i = 0; i < N; i++) freqs[i] = 25 * Math.pow(18000 / 25, i / (N - 1));
    EQ_BANDS.forEach((hz, i) => {
      const g = Number(s.eq[i]) || 0;
      if(Math.abs(g) < 0.05 || hz >= rate * 0.45) return;
      const f = probeCtx.createBiquadFilter();
      f.type = 'peaking'; f.frequency.value = hz; f.Q.value = Q_PEAK; f.gain.value = g;
      f.getFrequencyResponse(freqs, mag, phase);
      for(let k = 0; k < N; k++) total[k] *= mag[k];
    });
    let best = 0;
    for(let k = 0; k < N; k++) best = Math.max(best, 20 * Math.log10(total[k] || 1));
    return best;
  } catch { return 0; }
}

/* =====================================================================================
 *  WEB backend (browser / fallback)
 * ===================================================================================== */
function makeWebAudio(){
  const a = new Audio();
  a.preload = 'auto'; a.volume = 1; a.muted = false; a.defaultMuted = false;
  a.isNative = false;
  a.hasQueue = () => !!a.src;
  return a;
}

export const audio = NATIVE ? new NativeAudio(NativePlayer) : makeWebAudio();

let audioContext = null;
let audioSource = null;
let analyser = null;
let gainNode = null;
let limiter = null;
let eqFilters = [];
let webFlat = null;

export async function ensureAudioGraph(){
  if(NATIVE) return;                                   // the native engine has its own pipeline
  if(!audioContext){
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return;
    // 'playback' = bigger buffers → no crackling/dropouts when the main thread is busy or throttled
    try { audioContext = new AC({latencyHint: 'playback'}); } catch { audioContext = new AC(); }
    audioSource = audioContext.createMediaElementSource(audio);
    gainNode = audioContext.createGain();
    eqFilters = EQ_BANDS.map((hz)=>{
      const f = audioContext.createBiquadFilter();
      f.type = 'peaking'; f.frequency.value = hz; f.Q.value = Q_PEAK; f.gain.value = 0;
      return f;
    });
    // brick-wall-ish limiter: whatever the EQ does, the output cannot hard-clip
    limiter = audioContext.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.003; limiter.release.value = 0.25;
    audioContext.onstatechange = () => {
      if(audioContext && audioContext.state !== 'running' && !audio.paused && !audio.ended){
        audioContext.resume().catch(() => {});
      }
    };
    analyser = audioContext.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = .82;
    // Chain: source -> EQ bands -> gain(headroom) -> limiter -> analyser -> destination
    let node = eqFilters[0];
    eqFilters.slice(1).forEach(f => { node.connect(f); node = f; });
    node.connect(gainNode);
    gainNode.connect(limiter);
    limiter.connect(analyser);
    analyser.connect(audioContext.destination);
    webFlat = null;
    applyCurrentFileSound();
    if(webFlat === null) routeWeb(true);      // no book yet: still connect the source, otherwise there is silence
  }
  if(audioContext.state === 'suspended') await audioContext.resume();
}

function routeWeb(flat){
  if(!audioSource || flat === webFlat) return;
  webFlat = flat;
  try { audioSource.disconnect(); } catch {}
  // flat sound = completely clean path, no filters, no limiter
  audioSource.connect(flat ? analyser : eqFilters[0]);
}

export function applyCurrentFileSound(){
  const b = state.current;
  if(!b) return;
  const s = ensureBookSound(b);
  const vol = Math.max(0, Math.min(1, Number(s.volume ?? 1)));

  if(NATIVE){
    NativePlayer.setFx({
      eq: s.eq.map(v => Number(v) || 0), gain: Number(s.gain) || 0, volume: vol
    }).then(r => {
      const el = document.getElementById('fxInfo');
      if(el && r) el.textContent = `Авто-запас громкости: −${(HEADROOM * Math.max(0, r.peakBoostDb || 0)).toFixed(1)} dB · лимитер включён`;
    }).catch(() => {});
    audio.setSkipSilence(!!s.skipSilence);
    return;
  }

  audio.muted = false;
  if(!gainNode){ audio.volume = vol; return; }
  audio.volume = 1;
  const now = audioContext.currentTime;
  eqFilters.forEach((filter, i) => filter.gain.setTargetAtTime(Number(s.eq[i]) || 0, now, .02));
  // headroom: lower the level by (almost) the loudest boost of the cascade, so boosts don't clip
  const preDb = -HEADROOM * Math.max(0, peakBoostDb(s)) + (Number(s.gain) || 0);
  gainNode.gain.setTargetAtTime(Math.pow(10, preDb / 20) * vol, now, .02);
  routeWeb(isFlat(s));
}

/* ----- spectrum for the visualizer (native: computed in AudioFx, web: AnalyserNode) ----- */
export function spectrumSize(){ return NATIVE ? SPECTRUM_BINS : (analyser ? analyser.frequencyBinCount : 0); }
export function hasSpectrum(){ return NATIVE || !!analyser; }
export function setSpectrumActive(on){
  if(NATIVE){ NativePlayer.setVisualizer({on: !!on}).catch(() => {}); if(!on) audio.fft = null; }
}
export function fillSpectrum(arr){
  if(NATIVE){
    const d = audio.fft;
    if(audio.paused || !d){ arr.fill(0); return; }
    for(let i = 0; i < arr.length; i++) arr[i] = d[i] || 0;
    return;
  }
  if(analyser) analyser.getByteFrequencyData(arr);
}

/**
 * Guarantees that "playing" really means audible: unmuted, volume restored, AudioContext running.
 * (Web backend only — the native player has its own audio focus handling.)
 */
export async function ensureAudible(){
  if(NATIVE) return;
  audio.muted = false;
  if(state.current) applyCurrentFileSound();
  if(audioContext && audioContext.state !== 'running'){
    try { await audioContext.resume(); } catch {}
  }
}

/* =====================================================================================
 *  Sound modal
 * ===================================================================================== */
function eqLabel(hz){ return hz>=1000 ? (hz/1000)+'k' : String(hz); }

const persistSoon = () => saveBooksSoon(500);

export function openCurrentSound(){
  const b = state.current;
  if(!b) return;
  const s = ensureBookSound(b);

  const presets = Object.entries(SOUND_PRESETS).map(([id,p])=>`<button class="sound-preset ${s.preset===id?'active':''}" data-preset="${id}"><b>${escapeHtml(p.name)}</b><small>${p.eq.filter(x=>x>0).length?'объёмный':'нейтральный'}</small></button>`).join('');
  const bands = EQ_BANDS.map((hz,i)=>`<div class="eq-band"><span>${eqLabel(hz)}</span><input type="range" min="-12" max="12" step="1" value="${Number(s.eq[i])||0}" data-eq="${i}" orient="vertical"><b id="eqv${i}">${(s.eq[i]>0?'+':'')}${s.eq[i]} dB</b></div>`).join('');
  const nativeRows = NATIVE ? `<div class="sound-setting"><div class="sound-head"><span>Пропуск тишины</span><input type="checkbox" id="skipSil" ${s.skipSilence?'checked':''}></div></div><div class="sound-setting"><div class="sound-head"><span>Работа с выключенным экраном</span><button class="secondary" id="batteryBtn" type="button">Настроить батарею</button></div></div>` : '';

  document.getElementById('modalRoot').innerHTML=`<div class="modal-back" id="soundBack"><div class="modal sound-modal"><div class="sound-modal-head"><div><h3>Звук книги</h3><small>${escapeHtml(b.title)}</small></div><button class="icon-btn" data-close aria-label="Закрыть">${icon('close')}</button></div><div class="sound-label">Пресет</div><div class="preset-grid">${presets}</div><div class="sound-setting"><div class="sound-head"><span>Громкость книги</span><b id="fileVolValue">${Math.round(s.volume*100)}%</b></div><input class="sound-range" id="fileVol" type="range" min="0" max="100" value="${Math.round(s.volume*100)}"></div>${nativeRows}<div class="eq-panel"><div class="sound-head"><span>10-полосный эквалайзер книги</span><b>±12 dB</b></div><div class="eq-grid">${bands}</div><small id="fxInfo" style="display:block;margin-top:8px;opacity:.65"></small></div><div class="modal-actions"><button class="secondary" id="soundDefault">Сбросить эквалайзер</button></div></div></div>`;

  $('soundBack').onclick = e => { if(e.target.id==='soundBack'||e.target.closest('[data-close]')) closeModal(); };
  document.querySelectorAll('[data-preset]').forEach(btn => btn.onclick = () => {
    const id = btn.dataset.preset, p = SOUND_PRESETS[id];
    s.preset = id; s.eq = [...p.eq]; s.gain = p.gain || 0;
    applyCurrentFileSound(); persistSoon(); openCurrentSound();
  });
  $('fileVol').oninput = e => {
    s.preset = 'custom'; s.volume = Number(e.target.value)/100;
    document.querySelectorAll('.sound-preset.active').forEach(x => x.classList.remove('active'));
    $('fileVolValue').textContent = Math.round(s.volume*100)+'%';
    applyCurrentFileSound(); persistSoon();
  };
  document.querySelectorAll('[data-eq]').forEach(inp => inp.oninput = e => {
    const i = Number(inp.dataset.eq);
    s.preset = 'custom'; s.eq[i] = Number(e.target.value); s.gain = 0;
    document.querySelectorAll('.sound-preset.active').forEach(x => x.classList.remove('active'));
    const v = $('eqv'+i); if(v) v.textContent = (s.eq[i]>0?'+':'')+s.eq[i]+' dB';
    applyCurrentFileSound(); persistSoon();
  });
  $('soundDefault').onclick = () => {
    s.preset = 'flat'; s.eq = EQ_BANDS.map(() => 0); s.volume = 1; s.gain = 0;
    applyCurrentFileSound(); persistSoon(); openCurrentSound();
  };
  if(NATIVE){
    $('skipSil').onchange = e => { s.skipSilence = e.target.checked; applyCurrentFileSound(); persistSoon(); };
    $('batteryBtn').onclick = () => NativePlayer.openBatterySettings().catch(() => {});
  }
  applyCurrentFileSound();   // also fills the "auto headroom" line
}
