/* visualizer.js — Audio Visualizer Canvas Rendering and Overlay */
import { state, $ } from './state.js';
import { audio, ensureAudioGraph, hasSpectrum, spectrumSize, fillSpectrum, setSpectrumActive } from './sound.js';
import { showToast } from './ui-utils.js';
import { t } from './i18n.js';
import { isPremium } from './premium.js';
import { gate } from './premium-ui.js';
import { STYLES } from './viz-styles.js';

let visualizerFrame = 0;
let visualizerOpen = false;

/* ---------------- the player "picture": the cover, then the visuals, in a loop ----------------
 * A swipe on the player cover (or on the visual itself) moves along this list: left = next, right = previous.
 * Position 0 is the cover; 1..n are the visuals. The last one used is remembered.
 */
export const VISUALS = ['aurora', 'ribbons', 'pulse', 'nebula', 'grid', 'vortex', 'plasma', 'rain', 'star', 'dots'];
export const VISUAL_NAMES = {
  aurora: 'Северное сияние', ribbons: 'Неоновые ленты', pulse: 'Пульс', nebula: 'Туманность', grid: 'Кибер-сетка',
  vortex: 'Чёрная дыра', plasma: 'Плазма', rain: 'Неоновый дождь', star: 'Звезда', dots: 'Светодиодная матрица'
};
let visual = 'aurora';
try { const v = localStorage.getItem('viz.style'); if(VISUALS.includes(v)) visual = v; } catch {}

/** 0 = cover, 1.. = visuals */
export function picturePosition(){ return visualizerOpen ? VISUALS.indexOf(visual) + 1 : 0; }

export function stepPicture(step){
  const n = VISUALS.length + 1;
  const pos = (picturePosition() + (step < 0 ? -1 : 1) + n) % n;
  if(pos === 0){ closeVisualizer(); return; }
  if(!gate('visualizer', isPremium())) return;                // visualizers are Premium: the sheet / a note instead
  setVisual(VISUALS[pos - 1]);
  if(!visualizerOpen) openVisualizer();
  else { syncPictureDots(); resumeVisualizer(); }      // a paused, "asleep" canvas must repaint in the new style
}

function setVisual(v){
  visual = v;
  try { localStorage.setItem('viz.style', v); } catch {}
  const name = $('visualizerName');
  if(name) name.textContent = t(VISUAL_NAMES[v] || '');
}

/** The little dots (one per picture) on the cover and on the visual: where you are in the loop */
export function syncPictureDots(){
  // two stops: the cover (with its animation beside it) and the visualizers; the counter says which of the ten is on
  const pos = picturePosition();
  document.querySelectorAll('.pic-dots').forEach(host => {
    host.innerHTML = `<i class="${pos === 0 ? 'on' : ''}"></i><i class="${pos > 0 ? 'on' : ''}"></i>${pos > 0 ? `<b class="pic-num">${pos}/${VISUALS.length}</b>` : ''}`;
  });
}

export function openVisualizer(){
  const el = $('visualizer');
  if(!el) return;
  visualizerOpen = true;
  setVisual(visual);
  syncPictureDots();
  el.classList.remove('hidden');
  el.setAttribute('aria-hidden', 'false');
  ensureAudioGraph().then(() => { setSpectrumActive(true); startVisualizer(); }).catch(() => showToast(t('Визуализатор недоступен')));
}

export function closeVisualizer(){
  visualizerOpen = false;
  setSpectrumActive(false);
  const el = $('visualizer');
  if(el){ el.classList.add('hidden'); el.setAttribute('aria-hidden', 'true'); }
  stopVisualizer();
  syncPictureDots();
}

/* ---------------- when the visualizer is allowed to run ----------------
 * It animates ONLY while: its overlay is open, the player screen is visible, the app is in the foreground and audio is playing.
 *  - another screen            -> router.js onLeave closes it (and draw() stops by itself if its canvas was removed)
 *  - app in background/screen off -> loop and native FFT stream are paused, resumed on return
 *  - paused / silent           -> the loop goes to sleep after the bars settle (the canvas keeps the last frame), wakes on "play"
 *  - battery <= 20 % and not charging -> half the frame rate
 */
let lowPower = false;
try {
  navigator.getBattery?.().then(b => {
    const upd = () => { lowPower = !b.charging && b.level <= 0.2; };
    upd(); b.addEventListener('levelchange', upd); b.addEventListener('chargingchange', upd);
  }).catch(() => {});
} catch {}

function resumeVisualizer(){
  if(!visualizerOpen || visualizerFrame || document.hidden) return;
  if(!$('visualizerCanvas')?.isConnected) return;
  setSpectrumActive(true);
  startVisualizer();
}

document.addEventListener('visibilitychange', () => {
  if(!visualizerOpen) return;
  if(document.hidden){ stopVisualizer(); setSpectrumActive(false); }
  else resumeVisualizer();
});
audio.addEventListener('play', resumeVisualizer);

const TAU = Math.PI * 2;
const BANDS = 36;            // smoothed bands handed to every style

function startVisualizer(){
  const canvas = $('visualizerCanvas');
  if(!canvas || !hasSpectrum()) return;
  stopVisualizer();
  const ctx = canvas.getContext('2d');
  const data = new Uint8Array(spectrumSize());

  const sm = new Float32Array(BANDS);     // smoothed level per band
  const pk = new Float32Array(BANDS);     // falling peak markers
  const memory = {};                      // each style keeps its own particles / stars here
  let bass = 0, prevBass = 0, beatCooldown = 0, hue = 200, last = performance.now(), t = 0, calmSince = 0, shown = '';

  // log-ish mapping: more resolution on low/mid (voice), upper bins quiet in speech
  const binOf = j => Math.min(data.length - 1, Math.floor(Math.pow(j / BANDS, 1.6) * data.length * 0.8) + 1);

  const draw = (now) => {
    // leaked / detached canvas (screen was re-rendered): stop the loop and the native FFT stream
    if(!visualizerOpen || !canvas.isConnected){
      visualizerFrame = 0;
      if(visualizerOpen){ visualizerOpen = false; setSpectrumActive(false); }
      return;
    }
    // 30 fps is plenty (the native FFT only updates at ~15 Hz and the motion is smoothed); 15 fps on a low battery
    if(now - last < (lowPower ? 64 : 31)){ visualizerFrame = requestAnimationFrame(draw); return; }
    const dt = Math.min(.05, (now - last) / 1000 || .033); last = now; t += dt;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), w = canvas.clientWidth, h = canvas.clientHeight;
    if(w < 2 || h < 2){ visualizerFrame = requestAnimationFrame(draw); return; }
    if(canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)){
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fillSpectrum(data);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);

    // ---- analysis: smooth bands (fast attack, slow release), bass energy, beat ----
    const playing = !!state.playing;
    const idle = .035 + (playing ? .02 * Math.sin(t * 1.6) : 0);     // gentle "breathing" only while audio plays
    for(let j = 0; j < BANDS; j++){
      const b0 = binOf(j), b1 = Math.max(b0 + 1, binOf(j + 1));
      let s = 0; for(let k = b0; k < b1; k++) s = Math.max(s, data[k]);
      let v = Math.min(1, Math.pow(s / 255, .85) * (1 + j / BANDS * .55));   // tilt: lift quiet highs
      v = Math.max(v, idle);
      sm[j] += (v - sm[j]) * (v > sm[j] ? Math.min(1, dt * 22) : Math.min(1, dt * 6));
      pk[j] = Math.max(sm[j], pk[j] - dt * .35);
    }
    let bsum = 0; for(let k = 0; k < 6; k++) bsum += data[k] || 0;
    prevBass = bass; bass += (bsum / 6 / 255 - bass) * Math.min(1, dt * 14);
    beatCooldown -= dt;
    let beat = false;
    if(bass - prevBass > .035 && bass > .22 && beatCooldown <= 0){ beat = true; beatCooldown = .16; }
    hue = (hue + dt * 14 + bass * dt * 40) % 360;
    const mean = (a, b) => { let m = 0; for(let i = Math.floor(a * BANDS); i < Math.ceil(b * BANDS); i++) m += sm[i]; return m / Math.max(1, Math.ceil(b * BANDS) - Math.floor(a * BANDS)); };

    const S = Math.min(w, h);
    if(shown !== visual){ shown = visual; for(const k of Object.keys(memory)) delete memory[k]; }      // a new picture starts clean
    const fn = STYLES[visual] || STYLES.aurora;
    fn(ctx, { w, h, S, cx: w / 2, cy: h * .49, t, dt, hue, bass, mid: mean(.2, .6), hi: mean(.6, 1), sm, pk, beat, playing }, memory);
    ctx.globalCompositeOperation = 'source-over';

    // paused/silent and everything has settled: leave the last frame on screen and stop burning CPU/GPU/battery
    let settled = !playing && bass < .02;
    for(let j = 0; settled && j < BANDS; j++) if(sm[j] - idle > .015) settled = false;
    if(settled){
      calmSince = calmSince || now;
      if(now - calmSince > 1000){ visualizerFrame = 0; setSpectrumActive(false); return; }
    } else calmSince = 0;

    visualizerFrame = requestAnimationFrame(draw);
  };
  visualizerFrame = requestAnimationFrame(draw);
}

function stopVisualizer(){
  if(visualizerFrame){ cancelAnimationFrame(visualizerFrame); visualizerFrame = 0; }
}
