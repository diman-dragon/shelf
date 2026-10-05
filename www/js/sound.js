/* sound.js — playback engine facade, Equalizer, Sound Enhancements
 *
 * Two backends behind ONE object, `audio`, which mimics the small part of HTMLMediaElement that player.js uses:
 *   - NATIVE (Android app): ExoPlayer (Media3) inside PlayerService. EQ / headroom / limiter run in the native
 *     audio pipeline (AudioFx.java), so playback does not depend on the WebView or on the screen being on.
 *   - WEB (browser / fallback): <audio> + Web Audio graph, with headroom compensation and a limiter.
 */
import { state, icon, escapeHtml, $, isNative, plugin } from './state.js';
import { persist } from './storage.js';
import { closeModal } from './ui-utils.js';

const NativePlayer = isNative() ? plugin('Player') : null;
export const NATIVE = !!NativePlayer;

export const EQ_BANDS = [60,120,250,500,1000,2000,4000,8000,12000,16000];
export const SPECTRUM_BINS = 128;

export const SOUND_PRESETS = {
  flat:{name:'Плоский',gain:0,eq:[0,0,0,0,0,0,0,0,0,0]},
  voice:{name:'Голос',gain:0,eq:[-3,-2,-1,2,3,4,3,2,1,0]},
  bass:{name:'Бас',gain:0,eq:[4,3,2,1,0,-1,-1,-1,0,0]},
  rock:{name:'Рок',gain:0,eq:[3,2,1,-1,-1,1,2,3,3,2]},
  classical:{name:'Классика',gain:0,eq:[2,1,1,0,0,0,1,1,2,2]},
  jazz:{name:'Джаз',gain:0,eq:[2,1,1,0,-1,1,2,2,1,1]},
  night:{name:'Ночь',gain:-2,eq:[-2,-1,0,1,2,1,0,-2,-3,-4]}
};

export function ensureBookSound(b){
  if(!b) return null;
  // IMPORTANT: update b.sound IN PLACE. Replacing the object (b.sound = {...}) left the handlers of the
  // sound modal holding a stale copy, so presets / reset / volume were written to an object the engine never read.
  if(!b.sound || typeof b.sound !== 'object') b.sound = {};
  const s = b.sound, d = {preset:'flat', volume:1, gain:0, bass:0, treble:0, skipSilence:false};
  for(const k in d) if(s[k] === undefined) s[k] = d[k];
  if(!Array.isArray(s.eq) || s.eq.length !== 10) s.eq = [0,0,0,0,0,0,0,0,0,0];
  return s;
}

/* =====================================================================================
 *  NATIVE backend facade
 * ===================================================================================== */
const sigOf = b => `${b.id}|${b.files.length}|${b.files.reduce((a,f)=>a+(f.uri||'').length,0)}`;

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
    P.addListener('state', s => this._apply(s));
    P.addListener('error', e => {
      const ev = new Event('error'); ev.detail = e; this.dispatchEvent(ev);
    });
    P.addListener('closed', () => {
      this.queueSig = ''; this._index = -1; this._bookId = '';
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
      this._applyNow(await this.P.getState());
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

  setSleep(minutes){ return this.P.setSleepTimer({minutes}).catch(() => {}); }
  setSkipSilence(on){ return this.P.setSkipSilence({on: !!on}).catch(() => {}); }

  _apply(s){
    if(this._loading || !this.queueSig || !s) return;
    if(s.bookId && this._bookId && s.bookId !== this._bookId) return;   // late event of a previous book
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
const Q_PEAK = 1.4, Q_SHELF = 0.7071, BASS_HZ = 180, TREBLE_HZ = 4200, HEADROOM = 0.85;
const isFlat = s => !s.eq.some(v => Number(v)) && !Number(s.bass) && !Number(s.treble) && !Number(s.gain) && Number(s.volume ?? 1) === 1;

/** Worst-case boost (dB) of the cascade — used to lower the pre-gain so boosts never reach 0 dBFS */
function peakBoostDb(s, rate = 48000){
  const filters = [];
  const add = (type, f0, dB) => { if(Math.abs(dB) >= 0.05 && f0 < rate * 0.45) filters.push(coeffs(type, f0, dB, rate)); };
  add('low', BASS_HZ, Number(s.bass) || 0);
  add('high', TREBLE_HZ, Number(s.treble) || 0);
  EQ_BANDS.forEach((hz, i) => add('peak', hz, Number(s.eq[i]) || 0));
  let best = 0;
  for(let i = 0; i < 160; i++){
    const fr = 25 * Math.pow(18000 / 25, i / 159);
    if(fr > rate * 0.45) break;
    const w = 2 * Math.PI * fr / rate;
    let db = 0;
    for(const c of filters){
      const nr = c.b0 + c.b1 * Math.cos(w) + c.b2 * Math.cos(2*w), ni = -(c.b1 * Math.sin(w) + c.b2 * Math.sin(2*w));
      const dr = 1 + c.a1 * Math.cos(w) + c.a2 * Math.cos(2*w), di = -(c.a1 * Math.sin(w) + c.a2 * Math.sin(2*w));
      db += 10 * Math.log10((nr*nr + ni*ni) / (dr*dr + di*di));
    }
    if(db > best) best = db;
  }
  return best;
}
function coeffs(type, f0, dB, rate){
  const A = Math.pow(10, dB / 40), w0 = 2 * Math.PI * f0 / rate, cs = Math.cos(w0), sn = Math.sin(w0);
  let B0, B1, B2, A0, A1, A2;
  if(type === 'peak'){
    const al = sn / (2 * Q_PEAK);
    B0 = 1 + al*A; B1 = -2*cs; B2 = 1 - al*A; A0 = 1 + al/A; A1 = -2*cs; A2 = 1 - al/A;
  } else {
    const al = sn / (2 * Q_SHELF), sa = 2 * Math.sqrt(A) * al;
    if(type === 'low'){
      B0 = A*((A+1) - (A-1)*cs + sa); B1 = 2*A*((A-1) - (A+1)*cs); B2 = A*((A+1) - (A-1)*cs - sa);
      A0 = (A+1) + (A-1)*cs + sa; A1 = -2*((A-1) + (A+1)*cs); A2 = (A+1) + (A-1)*cs - sa;
    } else {
      B0 = A*((A+1) + (A-1)*cs + sa); B1 = -2*A*((A-1) + (A+1)*cs); B2 = A*((A+1) + (A-1)*cs - sa);
      A0 = (A+1) - (A-1)*cs + sa; A1 = 2*((A-1) - (A+1)*cs); A2 = (A+1) - (A-1)*cs - sa;
    }
  }
  return {b0: B0/A0, b1: B1/A0, b2: B2/A0, a1: A1/A0, a2: A2/A0};
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

export let audioContext = null;
let audioSource = null;
export let analyser = null;
export let gainNode = null;
export let bassFilter = null;
export let trebleFilter = null;
export let limiter = null;
export let eqFilters = [];
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
    bassFilter = audioContext.createBiquadFilter(); bassFilter.type = 'lowshelf'; bassFilter.frequency.value = BASS_HZ; bassFilter.Q.value = Q_SHELF;
    trebleFilter = audioContext.createBiquadFilter(); trebleFilter.type = 'highshelf'; trebleFilter.frequency.value = TREBLE_HZ; trebleFilter.Q.value = Q_SHELF;
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
    // Chain: source -> bass -> treble -> EQ bands -> gain(headroom) -> limiter -> analyser -> destination
    let node = bassFilter;
    node.connect(trebleFilter); node = trebleFilter;
    eqFilters.forEach(f => { node.connect(f); node = f; });
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
  audioSource.connect(flat ? analyser : bassFilter);
}

export function applyCurrentFileSound(){
  const b = state.current;
  if(!b) return;
  const s = ensureBookSound(b);
  const vol = Math.max(0, Math.min(1, Number(s.volume ?? 1)));

  if(NATIVE){
    NativePlayer.setFx({
      eq: s.eq.map(v => Number(v) || 0), bass: Number(s.bass) || 0, treble: Number(s.treble) || 0,
      gain: Number(s.gain) || 0, volume: vol
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
  if(bassFilter) bassFilter.gain.setTargetAtTime(Number(s.bass) || 0, now, .02);
  if(trebleFilter) trebleFilter.gain.setTargetAtTime(Number(s.treble) || 0, now, .02);
  eqFilters.forEach((filter, i) => filter.gain.setTargetAtTime(Number(s.eq[i]) || 0, now, .02));
  // headroom: lower the level by (almost) the loudest boost of the cascade, so boosts don't clip
  const preDb = -HEADROOM * Math.max(0, peakBoostDb(s, audioContext.sampleRate)) + (Number(s.gain) || 0);
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
export function eqLabel(hz){ return hz>=1000 ? (hz/1000)+'k' : String(hz); }

let persistTimer = 0;
const persistSoon = () => { clearTimeout(persistTimer); persistTimer = setTimeout(() => persist(), 500); };

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
    s.preset = 'flat'; s.eq = [0,0,0,0,0,0,0,0,0,0]; s.volume = 1; s.gain = 0;
    applyCurrentFileSound(); persistSoon(); openCurrentSound();
  };
  if(NATIVE){
    $('skipSil').onchange = e => { s.skipSilence = e.target.checked; applyCurrentFileSound(); persistSoon(); };
    $('batteryBtn').onclick = () => NativePlayer.openBatterySettings().catch(() => {});
  }
  applyCurrentFileSound();   // also fills the "auto headroom" line
}
