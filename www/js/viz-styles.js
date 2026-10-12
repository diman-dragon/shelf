/* viz-styles.js — the ten pictures of the visualizer (plain 2D canvas, no WebGL: light on battery and the same on every phone).
 * Each style is draw(ctx, F, Z):
 *   F = one frame of analysis { w, h, S, cx, cy, t, dt, hue, bass, mid, hi, sm, pk, beat, playing }  (sm/pk: smoothed band levels and falling peaks, 0..1)
 *   Z = this style's own memory (particles, stars...), created lazily and thrown away when the visualizer is restarted.
 * The canvas is cleared before every frame; the overlay behind it is a dark night-blue.
 */
const TAU = Math.PI * 2;
const hsl = (h, s, l, a = 1) => `hsla(${((h % 360) + 360) % 360},${s}%,${l}%,${a})`;
const at = (sm, u) => sm[Math.max(0, Math.min(sm.length - 1, Math.floor(u * sm.length)))];
const lerp = (a, b, k) => a + (b - a) * k;
const glow = (ctx, x, y, r, col0, col1 = 'rgba(0,0,0,0)') => {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, col0); g.addColorStop(1, col1);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
};

/* 1. Audio Aurora: curtains of northern light over dark hills */
function aurora(ctx, F, Z){
  const { w, h, t, hue, bass, sm } = F;
  if(!Z.stars) Z.stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random() * .62, p: Math.random() * TAU, r: .5 + Math.random() * 1.1 }));
  ctx.globalCompositeOperation = 'source-over';
  for(const s of Z.stars){
    ctx.fillStyle = `rgba(255,255,255,${.22 + .22 * Math.sin(t * 1.4 + s.p)})`;
    ctx.beginPath(); ctx.arc(s.x * w, s.y * h, s.r, 0, TAU); ctx.fill();
  }
  const base = h * .74, STEP = Math.max(5, Math.floor(w / 64));
  ctx.globalCompositeOperation = 'lighter';
  for(let L = 0; L < 4; L++){
    const k = L / 3, hh = 105 + hue * .12 + L * 40;
    const xs = [], ys = [];
    for(let x = 0; x <= w + STEP; x += STEP){
      const u = x / w, e = at(sm, u * .85);
      xs.push(x);
      ys.push(base - h * (.17 + k * .05) - Math.sin(u * TAU * (1.1 + k * .5) + t * (.35 + k * .12) + L * 1.9) * h * .07
        - Math.sin(u * TAU * 2.7 - t * .5 + L) * h * .03 - e * h * (.22 - k * .04) - bass * h * .04);
    }
    ctx.beginPath(); ctx.moveTo(xs[0], ys[0]);
    for(let i = 1; i < xs.length; i++) ctx.lineTo(xs[i], ys[i]);
    ctx.lineTo(w + STEP, h); ctx.lineTo(0, h); ctx.closePath();
    const g = ctx.createLinearGradient(0, base - h * .5, 0, base + h * .04);
    g.addColorStop(0, hsl(hh, 90, 60, 0)); g.addColorStop(1, hsl(hh, 90, 58, .17 + bass * .1));
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 1.6;
    for(let i = 0; i < xs.length; i += 3){          // rays standing on the lower edge
      const e = at(sm, xs[i] / w * .85);
      ctx.strokeStyle = hsl(hh + 15, 95, 70, .03 + e * .1);
      ctx.beginPath(); ctx.moveTo(xs[i], base); ctx.lineTo(xs[i], ys[i]); ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#04060b';
  ctx.beginPath(); ctx.moveTo(0, h);
  for(let x = 0; x <= w + STEP; x += STEP){ const u = x / w; ctx.lineTo(x, base + h * .035 - Math.abs(Math.sin(u * 5 + 1)) * h * .05 - Math.abs(Math.sin(u * 11 + 2)) * h * .02 + Math.sin(u * 29) * h * .004); }
  ctx.lineTo(w + STEP, h); ctx.closePath(); ctx.fill();
}

/* 2. Neon Ribbons: twisting ribbons of light */
function ribbons(ctx, F){
  const { w, h, S, cy, t, hue, bass, sm } = F;
  const N = 6, STEP = Math.max(6, Math.floor(w / 60));
  ctx.globalCompositeOperation = 'lighter';
  for(let r = 0; r < N; r++){
    const k = r / (N - 1), energy = at(sm, k * .8 + .05);
    const amp = S * (.05 + energy * .2), wid = S * (.025 + energy * .06 + bass * .02);
    const hh = hue + r * 48, ph = t * (.5 + k * .35) + r * 1.4;
    const top = [], bot = [];
    for(let x = -STEP; x <= w + STEP; x += STEP){
      const u = x / w, env = .35 + .65 * Math.sin(Math.PI * Math.min(1, Math.max(0, u)));
      const y = cy + (k - .5) * S * .3 + env * (Math.sin(u * TAU * (1.1 + k * .4) + ph) * amp + Math.sin(u * TAU * 2.3 - ph * 1.2) * amp * .35);
      const tw = Math.sin(u * TAU * 1.5 + ph * 1.3) * wid * env;       // the twist: the ribbon narrows to a line and widens again
      top.push(x, y - tw); bot.push(x, y + tw);
    }
    ctx.beginPath(); ctx.moveTo(top[0], top[1]);
    for(let i = 2; i < top.length; i += 2) ctx.lineTo(top[i], top[i + 1]);
    for(let i = bot.length - 2; i >= 0; i -= 2) ctx.lineTo(bot[i], bot[i + 1]);
    ctx.closePath();
    ctx.fillStyle = hsl(hh, 95, 55, .16 + energy * .18); ctx.fill();
    ctx.lineWidth = 1.8 + energy * 2; ctx.strokeStyle = hsl(hh + 25, 100, 72, .75);
    ctx.beginPath(); ctx.moveTo(top[0], top[1]);
    for(let i = 2; i < top.length; i += 2) ctx.lineTo(top[i], top[i + 1]);
    ctx.stroke();
  }
}

/* 3. Spectrum Pulse: rings that leave the centre on every beat */
function pulse(ctx, F, Z){
  const { w, h, S, cx, cy, t, dt, hue, bass, beat, sm } = F;
  const rings = Z.rings || (Z.rings = []);
  Z.cool = (Z.cool || 0) - dt;
  if(beat || (Z.cool <= 0 && rings.length < 2)){ rings.push({ r: S * .09, h: hue, a: 1 }); Z.cool = beat ? .35 : 1.4; }
  ctx.globalCompositeOperation = 'lighter';
  for(let i = rings.length - 1; i >= 0; i--){
    const g = rings[i];
    g.r += dt * S * (.28 + bass * .3); g.a -= dt * .5;
    if(g.a <= 0){ rings.splice(i, 1); continue; }
    ctx.lineWidth = 2 + g.a * 6;
    ctx.strokeStyle = hsl(g.h + g.r / S * 120, 95, 62, g.a * .75);
    ctx.beginPath(); ctx.arc(cx, cy, g.r, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = hsl(g.h + g.r / S * 120 + 40, 100, 85, g.a * .5);
    ctx.beginPath(); ctx.arc(cx, cy, g.r * .96, 0, TAU); ctx.stroke();
  }
  // a thin ring that shows the spectrum itself
  const M = 90, R = S * .16;
  ctx.lineWidth = 2; ctx.strokeStyle = hsl(hue + 160, 90, 72, .85);
  ctx.beginPath();
  for(let i = 0; i <= M; i++){
    const u = i / M, j = u < .5 ? u * 2 : 2 - u * 2, a = u * TAU - Math.PI / 2;
    const r = R + at(sm, j) * S * .09;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if(i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.stroke();
  glow(ctx, cx, cy, S * (.14 + bass * .08), hsl(hue + 30, 100, 82, .55 + bass * .3));
}

/* 4. Nebula Flow: a turning galaxy */
function nebula(ctx, F, Z){
  const { cx, cy, S, t, dt, hue, bass, sm } = F;
  if(!Z.p) Z.p = Array.from({ length: 520 }, (_, i) => {
    const arm = i % 3, f = Math.pow(Math.random(), .7);
    return { arm, f, off: (Math.random() - .5) * .5 * (.3 + f), z: Math.random(), s: .6 + Math.random() * 1.7, hh: Math.random() * 60 - 30 };
  });
  Z.rot = (Z.rot || 0) + dt * (.12 + bass * .5);
  const tilt = .62;
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, cx, cy, S * (.5 + bass * .06), hsl(hue + 250, 70, 40, .24));
  for(const p of Z.p){
    const e = at(sm, p.f * .9);
    const r = S * (.06 + p.f * .56) * (1 + e * .12);
    const a = Z.rot * (1.6 - p.f) + p.arm * TAU / 3 + p.f * 5 + p.off;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * tilt;
    ctx.fillStyle = hsl(hue + 200 + p.hh + p.f * 70, 85, 60 + e * 25, .35 + e * .5 - p.f * .15);
    ctx.beginPath(); ctx.arc(x, y, p.s * 1.5 * (.7 + e * .9), 0, TAU); ctx.fill();
  }
  glow(ctx, cx, cy, S * (.14 + bass * .07), hsl(hue + 40, 100, 88, .85), hsl(hue + 40, 100, 60, 0));
  for(let k = 0; k < 14; k++){                   // dust twinkle
    const a = k * 2.4 + t * .1, r = S * (.12 + (k * .037) % .38);
    ctx.fillStyle = `rgba(255,255,255,${.3 + .3 * Math.sin(t * 2 + k)})`;
    ctx.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r * tilt, 1.5, 1.5);
  }
}

/* 5. Cyber Grid: a synthwave road, a striped sun and mountains that follow the spectrum */
function grid(ctx, F, Z){
  const { w, h, S, t, dt, hue, bass, sm } = F;
  const hy = h * .5;
  Z.scroll = ((Z.scroll || 0) + dt * (.35 + bass * 1.2)) % 1;
  ctx.globalCompositeOperation = 'source-over';
  // sun
  const sr = S * (.24 + bass * .02), sy = hy - sr * .35;
  const sg = ctx.createLinearGradient(0, sy - sr, 0, sy + sr);
  sg.addColorStop(0, hsl(50, 100, 62)); sg.addColorStop(.55, hsl(15, 100, 58)); sg.addColorStop(1, hsl(320, 90, 50));
  ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(w / 2, sy, sr, 0, TAU); ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';       // stripes cut out of the lower half
  for(let i = 0; i < 6; i++){
    const yy = sy + sr * (.1 + i * .16), th = 1.5 + i * 1.6;
    ctx.fillRect(w / 2 - sr, yy, sr * 2, th);
  }
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, w / 2, sy, sr * 1.7, hsl(330, 90, 55, .22 + bass * .12));
  // mountains left and right of the road, made from the spectrum
  ctx.fillStyle = '#0a0618';
  ctx.strokeStyle = hsl(hue + 300, 95, 65, .9); ctx.lineWidth = 1.6;
  ctx.globalCompositeOperation = 'source-over';
  ctx.beginPath(); ctx.moveTo(0, hy);
  const MS = Math.max(8, Math.floor(w / 36));
  for(let x = 0; x <= w + MS; x += MS){
    const u = x / w, side = Math.abs(u - .5) * 2;
    ctx.lineTo(x, hy - Math.max(0, side - .15) * at(sm, side * .8) * S * .42 - Math.max(0, side - .15) * S * .03);
  }
  ctx.lineTo(w + MS, hy); ctx.closePath(); ctx.fill(); ctx.stroke();
  // the floor
  ctx.globalCompositeOperation = 'lighter';
  const fl = ctx.createLinearGradient(0, hy, 0, h);
  fl.addColorStop(0, hsl(hue + 280, 80, 30, .0)); fl.addColorStop(1, hsl(hue + 280, 80, 30, .28));
  ctx.fillStyle = fl; ctx.fillRect(0, hy, w, h - hy);
  const ROWS = 12, SEG = 22;
  for(let i = 0; i < ROWS; i++){
    const z = (i + Z.scroll) / ROWS, y0 = hy + (h - hy) * z * z;
    ctx.strokeStyle = hsl(hue + 190, 95, 65, .15 + z * .6); ctx.lineWidth = .8 + z * 1.6;
    ctx.beginPath();
    for(let s = 0; s <= SEG; s++){
      const u = s / SEG, side = Math.abs(u - .5) * 2;
      const lift = at(sm, side * .8) * S * .26 * Math.max(0, side - .1) * z * z;       // the ground rises with the music near the edges
      const x = u * w, y = y0 - lift;
      if(s) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  ctx.lineWidth = 1.2;
  for(let i = -8; i <= 8; i++){
    ctx.strokeStyle = hsl(hue + 300, 95, 65, .4);
    ctx.beginPath(); ctx.moveTo(w / 2 + i * w * .018, hy); ctx.lineTo(w / 2 + i * w * .26, h); ctx.stroke();
  }
}

/* 6. Vortex of Light: a black hole with a glowing accretion disk */
function vortex(ctx, F, Z){
  const { cx, cy, S, t, dt, hue, bass, sm } = F;
  if(!Z.p) Z.p = Array.from({ length: 380 }, () => ({ f: Math.pow(Math.random(), .8), a: Math.random() * TAU, s: .7 + Math.random() * 1.6 }));
  const R0 = S * (.14 + bass * .014), tilt = .36;
  for(const p of Z.p) p.a += dt * (1.9 + bass * 2.2) / (.35 + p.f * 1.4) * (1 - p.f * .55);
  const pos = p => {
    const r = R0 * 1.25 + p.f * S * .5;
    return [cx + Math.cos(p.a) * r, cy + Math.sin(p.a) * r * tilt, r, Math.sin(p.a) < 0];
  };
  const dot = (p, behind) => {
    const [x, y, r] = pos(p);
    const e = at(sm, p.f * .85);
    const heat = 1 - p.f;
    ctx.fillStyle = hsl(lerp(8, 52, heat) + (hue % 40) * .2, 100, lerp(48, 90, heat) + e * 10, (behind ? .55 : .85) * (.35 + e * .5 + heat * .3));
    ctx.beginPath(); ctx.arc(x, behind ? y - Math.sin(p.a) * 0 : y, p.s * 1.4 * (.7 + heat * .9 + e), 0, TAU); ctx.fill();
  };
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, cx, cy, S * (.46 + bass * .05), hsl(hue % 40 + 15, 100, 50, .12));
  for(const p of Z.p) if(Math.sin(p.a) < 0) dot(p, true);           // the far half of the disk
  // the hole
  ctx.globalCompositeOperation = 'source-over';
  const hg = ctx.createRadialGradient(cx, cy, R0 * .7, cx, cy, R0 * 1.5);
  hg.addColorStop(0, '#000'); hg.addColorStop(.62, '#000'); hg.addColorStop(.66, hsl(35 + hue % 20, 100, 70, .95)); hg.addColorStop(1, hsl(20, 100, 50, 0));
  ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(cx, cy, R0 * 1.5, 0, TAU); ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = hsl(40, 100, 80, .5 + bass * .4); ctx.lineWidth = 2;                // light bent over and under the hole
  ctx.beginPath(); ctx.ellipse(cx, cy, R0 * 1.12, R0 * 1.12, 0, 0, TAU); ctx.stroke();
  for(const p of Z.p) if(Math.sin(p.a) >= 0) dot(p, false);          // the near half, in front of the hole
}

/* 7. Plasma Pulse: arcs of lightning around a glowing core */
function plasma(ctx, F, Z){
  const { cx, cy, S, t, hue, bass, beat, sm } = F;
  const N = 9;
  Z.n = (Z.n || 0) + 1;
  if(!Z.bolts || Z.n % 3 === 0){
    Z.bolts = Array.from({ length: N + (beat ? 4 : 0) }, (_, i) => {
      const e = i < N ? at(sm, i / N * .8) : .9;
      const a = (i < N ? i / N * TAU + t * .12 : Math.random() * TAU);
      const len = S * (.2 + e * .42 + bass * .08), segs = 9, pts = [];
      for(let s = 0; s <= segs; s++){
        const f = s / segs, j = (Math.random() - .5) * S * .08 * (.3 + e) * Math.sin(f * Math.PI);
        pts.push([cx + Math.cos(a) * (S * .09 + f * len) - Math.sin(a) * j, cy + Math.sin(a) * (S * .09 + f * len) + Math.cos(a) * j]);
      }
      return { pts, e };
    });
  }
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, cx, cy, S * (.3 + bass * .08), hsl(hue + 230, 90, 50, .2));
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for(const b of Z.bolts){
    const pass = [[S * .018, .14], [S * .008, .45], [1.6, .95]];
    pass.forEach(([lw, al], k) => {
      ctx.lineWidth = lw; ctx.strokeStyle = k === 2 ? `rgba(255,255,255,${al * (.4 + b.e)})` : hsl(hue + 215, 95, 62, al * (.4 + b.e));
      ctx.beginPath(); b.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
    });
  }
  glow(ctx, cx, cy, S * (.09 + bass * .05), 'rgba(255,255,255,.95)', hsl(hue + 220, 100, 60, 0));
  glow(ctx, cx, cy, S * (.13 + bass * .06), hsl(hue + 220, 100, 70, .5));
}

/* 8. Chromatic Rain: neon drops falling in columns */
function rain(ctx, F, Z){
  const { w, h, S, dt, hue, bass, sm } = F;
  const cols = Math.max(10, Math.floor(w / 15));
  if(!Z.d || Z.d.length !== cols) Z.d = Array.from({ length: cols }, () => ({ y: Math.random() * h, v: .6 + Math.random() * .8, len: .14 + Math.random() * .26 }));
  ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  for(let i = 0; i < cols; i++){
    const d = Z.d[i], u = i / cols, e = at(sm, u * .85);
    d.y += dt * h * (.18 + e * .9 + bass * .6) * d.v;
    const len = h * d.len * (.7 + e * 1.4);
    if(d.y - len > h){ d.y = -Math.random() * h * .3; d.v = .6 + Math.random() * .8; d.len = .1 + Math.random() * .22; }
    const x = (i + .5) * (w / cols), hh = hue + u * 200;
    const g = ctx.createLinearGradient(x, d.y - len, x, d.y);
    g.addColorStop(0, hsl(hh, 100, 55, 0)); g.addColorStop(1, hsl(hh, 100, 62, .55 + e * .4));
    ctx.strokeStyle = g; ctx.lineWidth = 2 + e * 2.2;
    ctx.beginPath(); ctx.moveTo(x, d.y - len); ctx.lineTo(x, d.y); ctx.stroke();
    ctx.fillStyle = hsl(hh + 30, 100, 90, .9);
    ctx.beginPath(); ctx.arc(x, d.y, 1.6 + e * 2.2, 0, TAU); ctx.fill();
  }
  const g = ctx.createLinearGradient(0, h * .8, 0, h);                 // a faint pool of light at the bottom
  g.addColorStop(0, hsl(hue + 100, 90, 55, 0)); g.addColorStop(1, hsl(hue + 100, 90, 55, .14 + bass * .14));
  ctx.fillStyle = g; ctx.fillRect(0, h * .8, w, h * .2);
}

/* 9. Stellar Core: a star with flames that follow the bass and the voice */
function star(ctx, F, Z){
  const { cx, cy, S, t, dt, hue, bass, beat, sm } = F;
  const R = S * (.15 + bass * .04), hh = 30 + (hue % 60) * .35;
  Z.flare = Math.max(0, (Z.flare || 0) - dt * 1.2); if(beat) Z.flare = 1;
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, cx, cy, S * (.46 + bass * .08), hsl(hh, 100, 50, .16));
  glow(ctx, cx, cy, S * (.27 + bass * .06), hsl(hh - 6, 100, 55, .26));
  const P = 48;
  for(let i = 0; i < P; i++){                                         // prominences: curved flames
    const u = i / P, e = at(sm, (u < .5 ? u * 2 : 2 - u * 2) * .85);
    const a = u * TAU + t * .08, len = S * (.05 + e * .3), curl = Math.sin(t * 1.3 + i) * .35 + e * .5;
    const x0 = cx + Math.cos(a) * R, y0 = cy + Math.sin(a) * R;
    const x1 = cx + Math.cos(a + curl * .5) * (R + len), y1 = cy + Math.sin(a + curl * .5) * (R + len);
    const xc = cx + Math.cos(a + curl) * (R + len * 1.15), yc = cy + Math.sin(a + curl) * (R + len * 1.15);
    ctx.strokeStyle = hsl(hh + e * 20, 100, 62 + e * 20, .25 + e * .5); ctx.lineWidth = 1.5 + e * 3.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(xc, yc, x1, y1); ctx.stroke();
  }
  if(Z.flare > 0){                                                     // a flash ring on every beat
    ctx.strokeStyle = hsl(hh + 10, 100, 80, Z.flare * .6); ctx.lineWidth = 2 + Z.flare * 4;
    ctx.beginPath(); ctx.arc(cx, cy, R + (1 - Z.flare) * S * .3, 0, TAU); ctx.stroke();
  }
  glow(ctx, cx, cy, R * 1.25, hsl(hh + 12, 100, 90, 1), hsl(hh, 100, 55, .85));
  for(let k = 0; k < 5; k++){                                          // granulation: slow spots crossing the surface
    const a = t * (.25 + k * .06) + k * 1.9;
    glow(ctx, cx + Math.cos(a) * R * .55, cy + Math.sin(a * 1.2) * R * .45, R * .35, hsl(hh - 10, 100, 60, .35), hsl(hh - 10, 100, 60, 0));
  }
}

/* 10. Quantum Dots: an LED matrix; every column is a band of the spectrum */
function dots(ctx, F){
  const { w, h, S, hue, bass, sm, pk } = F;
  const cols = 22, rows = Math.max(10, Math.round(cols * h / w * .62));
  const cw = w * .88 / cols, ch = Math.min(h * .62 / rows, cw * 1.25);
  const x0 = (w - cw * cols) / 2 + cw / 2, y0 = h * .5 + ch * rows / 2 - ch / 2;
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, w / 2, h * .5, S * (.55 + bass * .1), hsl(hue + 220, 80, 40, .1));
  const rad = Math.min(cw, ch) * .34;
  for(let c = 0; c < cols; c++){
    const u = c / (cols - 1), lvl = at(sm, u * .9) * rows, peak = at(pk, u * .9) * rows;
    for(let r = 0; r < rows; r++){
      const x = x0 + c * cw, y = y0 - r * ch;
      const lit = r < lvl, isPeak = Math.abs(r - Math.round(peak)) < .5 && peak > 1;
      const f = r / rows, hh = hue + u * 120 + f * 90;
      if(lit){ ctx.fillStyle = hsl(hh, 95, 52 + f * 22, .95); ctx.beginPath(); ctx.arc(x, y, rad * (.85 + f * .25), 0, TAU); ctx.fill(); ctx.fillStyle = hsl(hh, 100, 65, .12); ctx.beginPath(); ctx.arc(x, y, rad * 2, 0, TAU); ctx.fill(); }
      else if(isPeak){ ctx.fillStyle = hsl(hh, 100, 85, .9); ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill(); }
      else { ctx.fillStyle = hsl(hh, 60, 55, .09); ctx.beginPath(); ctx.arc(x, y, rad * .6, 0, TAU); ctx.fill(); }
    }
  }
}

export const STYLES = { aurora, ribbons, pulse, nebula, grid, vortex, plasma, rain, star, dots };
