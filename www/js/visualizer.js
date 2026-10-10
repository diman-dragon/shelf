/* visualizer.js — Audio Visualizer Canvas Rendering and Overlay */
import { state, $ } from './state.js';
import { audio, ensureAudioGraph, hasSpectrum, spectrumSize, fillSpectrum, setSpectrumActive } from './sound.js';
import { showToast } from './ui-utils.js';
import { t } from './i18n.js';

let visualizerFrame = 0;
let visualizerOpen = false;

/* ---------------- the player "picture": the cover, then the visuals, in a loop ----------------
 * A swipe on the player cover (or on the visual itself) moves along this list: left = next, right = previous.
 * Position 0 is the cover; 1..n are the visuals. The last one used is remembered.
 */
export const VISUALS = ['ring', 'bars', 'wave'];
const VISUAL_NAMES = { ring: 'Кольцо', bars: 'Эквалайзер', wave: 'Волны' };
let visual = 'ring';
try { const v = localStorage.getItem('viz.style'); if(VISUALS.includes(v)) visual = v; } catch {}

/** 0 = cover, 1.. = visuals */
export function picturePosition(){ return visualizerOpen ? VISUALS.indexOf(visual) + 1 : 0; }

export function stepPicture(step){
  const n = VISUALS.length + 1;
  const pos = (picturePosition() + (step < 0 ? -1 : 1) + n) % n;
  if(pos === 0){ closeVisualizer(); return; }
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
  const pos = picturePosition();
  document.querySelectorAll('.pic-dots').forEach(host => {
    if(!host.children.length){
      host.innerHTML = Array.from({length: VISUALS.length + 1}, () => '<i></i>').join('');
    }
    Array.from(host.children).forEach((d, i) => d.classList.toggle('on', i === pos));
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
const BARS = 72;            // total bars around the circle (mirrored left/right)
const HALF = BARS / 2;
const MAX_PARTICLES = 90;

function startVisualizer(){
  const canvas = $('visualizerCanvas');
  if(!canvas || !hasSpectrum()) return;
  stopVisualizer();
  const ctx = canvas.getContext('2d');
  const data = new Uint8Array(spectrumSize());

  const sm = new Float32Array(HALF);     // smoothed level per band
  const pk = new Float32Array(HALF);     // falling peak markers
  const particles = [];
  let bass = 0, prevBass = 0, beatCooldown = 0, hue = 200, last = performance.now(), t = 0, calmSince = 0;

  // log-ish mapping: more resolution on low/mid (voice), upper bins quiet in speech
  const binOf = j => Math.min(data.length - 1, Math.floor(Math.pow(j / HALF, 1.6) * data.length * 0.8) + 1);

  const spawn = (cx, cy, r, h) => {
    const a = Math.random() * TAU, sp = 18 + Math.random() * 46;
    particles.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: 1, decay: .35 + Math.random() * .5, size: 1.2 + Math.random() * 2.4, hue: h + Math.random() * 80 - 40 });
    if(particles.length > MAX_PARTICLES) particles.shift();
  };

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
    for(let j = 0; j < HALF; j++){
      const b0 = binOf(j), b1 = Math.max(b0 + 1, binOf(j + 1));
      let s = 0; for(let k = b0; k < b1; k++) s = Math.max(s, data[k]);
      let v = Math.min(1, Math.pow(s / 255, .85) * (1 + j / HALF * .55));   // tilt: lift quiet highs
      v = Math.max(v, idle);
      sm[j] += (v - sm[j]) * (v > sm[j] ? Math.min(1, dt * 22) : Math.min(1, dt * 6));
      pk[j] = Math.max(sm[j], pk[j] - dt * .35);
    }
    let bsum = 0; for(let k = 0; k < 6; k++) bsum += data[k] || 0;
    prevBass = bass; bass += (bsum / 6 / 255 - bass) * Math.min(1, dt * 14);
    beatCooldown -= dt;
    hue = (hue + dt * 14 + bass * dt * 40) % 360;

    const S = Math.min(w, h), cx = w / 2, cy = h * .49;
    const r0 = S * .2 + bass * S * .015;

    const style = visual;
    if(style === 'bars') drawBars(ctx, {w, h, S, t, hue, bass, sm, pk});
    else if(style === 'wave') drawWave(ctx, {w, h, S, t, hue, bass, sm});
    else {
      // ---- aurora background: drifting colour blobs ----
      ctx.globalCompositeOperation = 'lighter';
      for(let i = 0; i < 3; i++){
        const ph = t * (.18 + i * .07) + i * 2.1;
        const bx = cx + Math.cos(ph) * w * .28, by = cy + Math.sin(ph * 1.3) * h * .22;
        const br = S * (.7 + bass * .25);
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        g.addColorStop(0, `hsla(${(hue + i * 120) % 360},85%,50%,${.13 + bass * .12})`);
        g.addColorStop(1, 'hsla(0,0%,0%,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      }

      // ---- faint rotating guide rings ----
      ctx.lineWidth = 1;
      for(let k = 0; k < 3; k++){
        const rr = S * (.3 + k * .09) + bass * S * .01 * (k + 1);
        ctx.strokeStyle = `hsla(${(hue + k * 50) % 360},70%,65%,${.07 - k * .015})`;
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
      }
      ctx.fillStyle = `hsla(${(hue + 180) % 360},90%,75%,.75)`;
      for(let k = 0; k < 6; k++){
        const a = t * .35 + k * TAU / 6, rr = S * .3;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1.8, 0, TAU); ctx.fill();
      }

      // ---- spectrum bars (mirrored), rainbow along the circle ----
      ctx.lineCap = 'round';
      const bw = Math.max(2.2, TAU * r0 / BARS * .55);
      for(let i = 0; i < BARS; i++){
        const j = i < HALF ? i : BARS - 1 - i;
        const v = sm[j];
        const a = i / BARS * TAU - Math.PI / 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const len = S * .018 + v * S * .21;
        const hh = (hue + i / BARS * 300) % 360;
        const x0 = cx + ca * r0, y0 = cy + sa * r0, x1 = cx + ca * (r0 + len), y1 = cy + sa * (r0 + len);
        // glow pass
        ctx.strokeStyle = `hsla(${hh},95%,60%,${.10 + v * .16})`; ctx.lineWidth = bw * 2.8;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        // core
        const g = ctx.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, `hsla(${hh},90%,55%,.95)`); g.addColorStop(1, `hsla(${(hh + 40) % 360},100%,${68 + v * 18}%,1)`);
        ctx.strokeStyle = g; ctx.lineWidth = bw;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        // inward reflection
        const x2 = cx + ca * (r0 - 5 - len * .35), y2 = cy + sa * (r0 - 5 - len * .35);
        ctx.strokeStyle = `hsla(${hh},90%,60%,${.18 + v * .25})`; ctx.lineWidth = bw * .7;
        ctx.beginPath(); ctx.moveTo(cx + ca * (r0 - 5), cy + sa * (r0 - 5)); ctx.lineTo(x2, y2); ctx.stroke();
        // falling peak dot
        const pr = r0 + S * .018 + pk[j] * S * .21 + 8;
        ctx.fillStyle = `hsla(${hh},100%,85%,${.35 + pk[j] * .6})`;
        ctx.beginPath(); ctx.arc(cx + ca * pr, cy + sa * pr, bw * .38, 0, TAU); ctx.fill();
      }

      // ---- outer flowing ring, coloured segment by segment ----
      ctx.lineWidth = 2.4;
      const ringR = i => {
        const j = i < HALF ? i : BARS - 1 - i;
        return S * .39 + sm[j] * S * .07 + Math.sin(t * 1.2 + i * .4) * 1.5;
      };
      for(let i = 0; i < BARS; i++){
        const i2 = (i + 1) % BARS;
        const a = i / BARS * TAU - Math.PI / 2, a2 = i2 / BARS * TAU - Math.PI / 2;
        ctx.strokeStyle = `hsla(${(hue + i / BARS * 300 + 30) % 360},95%,68%,.8)`;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * ringR(i), cy + Math.sin(a) * ringR(i));
        ctx.lineTo(cx + Math.cos(a2) * ringR(i2), cy + Math.sin(a2) * ringR(i2));
        ctx.stroke();
      }

      // ---- central orb pulsing with the bass ----
      const or = S * .11 + bass * S * .05;
      const og = ctx.createRadialGradient(cx, cy, 0, cx, cy, or * 1.9);
      og.addColorStop(0, `hsla(${(hue + 40) % 360},100%,88%,${.55 + bass * .35})`);
      og.addColorStop(.35, `hsla(${hue},90%,58%,${.3 + bass * .25})`);
      og.addColorStop(1, 'hsla(0,0%,0%,0)');
      ctx.fillStyle = og; ctx.beginPath(); ctx.arc(cx, cy, or * 1.9, 0, TAU); ctx.fill();

      // ---- particles on beats ----
      if(bass - prevBass > .035 && bass > .22 && beatCooldown <= 0){
        beatCooldown = .16;
        const n = 6 + Math.floor(bass * 10);
        for(let k = 0; k < n; k++) spawn(cx, cy, S * .39, hue + 150);
      }
      for(let k = particles.length - 1; k >= 0; k--){
        const p = particles[k];
        p.life -= p.decay * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .985; p.vy *= .985;
        if(p.life <= 0){ particles.splice(k, 1); continue; }
        ctx.fillStyle = `hsla(${p.hue % 360},100%,72%,${p.life * .85})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (.5 + p.life * .6), 0, TAU); ctx.fill();
      }
    }

    ctx.globalCompositeOperation = 'source-over';

    // paused/silent and everything has settled: leave the last frame on screen and stop burning CPU/GPU/battery
    let settled = !playing && particles.length === 0 && bass < .02;
    for(let j = 0; settled && j < HALF; j++) if(sm[j] - idle > .015) settled = false;
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


/* ---------------- visual 2: mirrored equaliser bars ---------------- */
function drawBars(ctx, {w, h, S, t, hue, bass, sm, pk}){
  const N = sm.length;                       // one bar per band (already smoothed in the shared analysis)
  const cy = h * .5, pad = w * .07, gap = Math.max(2, w * .006);
  const bw = (w - pad * 2 - gap * (N - 1)) / N;
  const maxH = h * .34;
  ctx.globalCompositeOperation = 'lighter';
  const bg = ctx.createRadialGradient(w / 2, cy, 0, w / 2, cy, S * (.8 + bass * .2));
  bg.addColorStop(0, `hsla(${hue % 360},80%,45%,${.12 + bass * .12})`);
  bg.addColorStop(1, 'hsla(0,0%,0%,0)');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.lineCap = 'round';
  for(let i = 0; i < N; i++){
    const v = sm[i], x = pad + i * (bw + gap) + bw / 2;
    const len = 3 + v * maxH, hh = (hue + i / N * 240) % 360;
    const g = ctx.createLinearGradient(x, cy - len, x, cy + len);
    g.addColorStop(0, `hsla(${(hh + 40) % 360},100%,72%,.95)`);
    g.addColorStop(.5, `hsla(${hh},90%,55%,.95)`);
    g.addColorStop(1, `hsla(${(hh + 40) % 360},100%,72%,.95)`);
    ctx.strokeStyle = `hsla(${hh},95%,60%,${.08 + v * .14})`; ctx.lineWidth = bw * 2.2;
    ctx.beginPath(); ctx.moveTo(x, cy - len); ctx.lineTo(x, cy + len); ctx.stroke();
    ctx.strokeStyle = g; ctx.lineWidth = Math.max(2, bw);
    ctx.beginPath(); ctx.moveTo(x, cy - len); ctx.lineTo(x, cy + len); ctx.stroke();
    const py = pk[i] * maxH + 8;
    ctx.fillStyle = `hsla(${hh},100%,88%,${.4 + pk[i] * .55})`;
    ctx.beginPath(); ctx.arc(x, cy - py, Math.max(1.4, bw * .32), 0, TAU); ctx.arc(x, cy + py, Math.max(1.4, bw * .32), 0, TAU); ctx.fill();
  }
  // a thin pulsing centre line
  ctx.strokeStyle = `hsla(${(hue + 180) % 360},80%,75%,${.18 + bass * .3})`; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, cy); ctx.lineTo(w - pad, cy); ctx.stroke();
}

/* ---------------- visual 3: layered flowing waves ---------------- */
function drawWave(ctx, {w, h, S, t, hue, bass, sm}){
  const N = sm.length, cy = h * .5;
  const band = (a, b) => { let m = 0, c = 0; for(let i = Math.floor(a * N); i < Math.ceil(b * N); i++){ m += sm[i]; c++; } return c ? m / c : 0; };
  const lo = band(0, .2), mid = band(.2, .6), hi = band(.6, 1);
  ctx.globalCompositeOperation = 'lighter';
  const LAYERS = 5, STEP = Math.max(6, Math.floor(w / 70));
  for(let L = 0; L < LAYERS; L++){
    const k = L / (LAYERS - 1);
    const energy = L < 2 ? lo : (L < 4 ? mid : hi);
    const amp = S * (.035 + energy * .17) * (1 - k * .25);
    const freq = 1.3 + L * .55, speed = .55 + L * .22, ph = t * speed + L * 1.7;
    const yOff = (k - .5) * S * .13;
    const path = [];
    for(let x = 0; x <= w + STEP; x += STEP){
      const u = x / w, env = Math.sin(Math.PI * Math.min(1, Math.max(0, u)));            // calm at the edges
      const j = Math.min(N - 1, Math.floor(u * N));
      const y = cy + yOff + env * (Math.sin(u * TAU * freq + ph) * amp + Math.sin(u * TAU * freq * 2.3 - ph * 1.3) * amp * .35 * (1 + sm[j]));
      path.push(x, y);
    }
    const hh = (hue + L * 55) % 360;
    ctx.beginPath(); ctx.moveTo(path[0], path[1]);
    for(let i = 2; i < path.length; i += 2) ctx.lineTo(path[i], path[i + 1]);
    ctx.strokeStyle = `hsla(${hh},95%,65%,${.55 - k * .15})`; ctx.lineWidth = 2.2 + energy * 3; ctx.stroke();
    ctx.lineTo(w + STEP, h); ctx.lineTo(0, h); ctx.closePath();
    const g = ctx.createLinearGradient(0, cy - amp * 2, 0, h);
    g.addColorStop(0, `hsla(${hh},90%,55%,${.10 + energy * .14})`);
    g.addColorStop(1, 'hsla(0,0%,0%,0)');
    ctx.fillStyle = g; ctx.fill();
  }
  const og = ctx.createRadialGradient(w / 2, cy, 0, w / 2, cy, S * (.25 + bass * .12));
  og.addColorStop(0, `hsla(${(hue + 40) % 360},100%,80%,${.18 + bass * .3})`);
  og.addColorStop(1, 'hsla(0,0%,0%,0)');
  ctx.fillStyle = og; ctx.fillRect(0, 0, w, h);
}
