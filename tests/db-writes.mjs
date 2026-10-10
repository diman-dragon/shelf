import { JSDOM } from 'jsdom';
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';

const WWW = fileURLToPath(new URL('../www', import.meta.url));
// ---------- virtual clock ----------
let now = 1_800_000_000_000, perf = 0, seq = 0;
const timers = new Map();
const realST = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms = 0, ...a) => { const id = ++seq; timers.set(id, { at: now + Math.max(0, ms), fn, a, iv: 0 }); return id; };
globalThis.clearTimeout = id => timers.delete(id);
globalThis.setInterval = (fn, ms = 0, ...a) => { const id = ++seq; timers.set(id, { at: now + Math.max(1, ms), fn, a, iv: Math.max(1, ms) }); return id; };
globalThis.clearInterval = globalThis.clearTimeout;
Date.now = () => now;
const realPerf = performance.now.bind(performance);
Object.defineProperty(globalThis, 'performance', { value: { now: () => perf, timeOrigin: 0 }, configurable: true });
async function advance(ms) {
  const end = now + ms;
  for (;;) {
    let nextId = 0, nextAt = Infinity;
    for (const [id, t] of timers) if (t.at < nextAt) { nextAt = t.at; nextId = id; }
    if (!nextId || nextAt > end) break;
    const t = timers.get(nextId); perf += nextAt - now; now = nextAt;
    if (t.iv) t.at = now + t.iv; else timers.delete(nextId);
    try { t.fn(...t.a); } catch (e) { console.error('timer error', e); }
    await Promise.resolve();
  }
  perf += end - now; now = end;
  await new Promise(r => realST(r, 0));
}

const html = fs.readFileSync(WWW + '/index.html', 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { url: 'https://localhost/', pretendToBeVisual: true }); dom.window.localStorage.setItem('lang','ru');
const w = dom.window;
for (const k of ['window','document','localStorage','navigator','HTMLImageElement','HTMLElement','Event','EventTarget','requestAnimationFrame','cancelAnimationFrame'])
  try { Object.defineProperty(globalThis, k, { value: k === 'window' ? w : w[k], configurable: true, writable: true }); } catch {}
class FakeAudio extends w.EventTarget { constructor(){ super(); this.paused=true; this.ended=false; this.src=''; this.currentTime=0; this.duration=NaN; this.volume=1; this.playbackRate=1; } pause(){ this.paused=true; this.dispatchEvent(new w.Event('pause')); } async play(){ this.paused=false; this.dispatchEvent(new w.Event('play')); } load(){} removeAttribute(){ this.src=''; } }
globalThis.Audio = FakeAudio; w.Audio = FakeAudio;
globalThis.fetch = async u => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(new URL(u), 'utf8')) });
globalThis.URL.createObjectURL = () => 'blob:x'; globalThis.URL.revokeObjectURL = () => {};
globalThis.MediaMetadata = class {};

// ---------- instrumented storage ----------
const store = new Map(); const writes = []; // {key, bytes}
const size = v => JSON.stringify(v ?? null).length;
let coverReads = 0;
w.idbKeyval = { get: async k => { if(k.startsWith('cover:')) coverReads++; return structuredClone(store.get(k)); }, set: async (k, v) => { writes.push({ t: now, key: k.startsWith('cover:') ? 'cover:*' : k, bytes: size(v) }); store.set(k, structuredClone(v)); }, del: async k => { writes.push({ t: now, key: 'DEL ' + (k.startsWith('cover:') ? 'cover:*' : k), bytes: 0 }); store.delete(k); } };
let lsWrites = 0; const realSet = w.Storage.prototype.setItem; w.Storage.prototype.setItem = function (k, v) { lsWrites++; return realSet.call(this, k, v); };

// ---------- fake native ----------
const L = {}; const listen = (ev, fn) => { (L[ev] ||= []).push(fn); return { remove(){} }; }; const emit = (ev, d) => (L[ev] || []).forEach(f => f(d));
let queue = null;
const Player = { addListener: listen, getState: async () => ({ saved: {}, loaded: !!queue, ...(queue || {}) }),
  setQueue: async o => { queue = { bookId: o.bookId, index: o.index, count: o.items.length, pos: o.pos, dur: 100, playWhenReady: false, playing: false, state: 3, speed: o.speed, sleepLeft: 0 }; },
  play: async () => {}, pause: async () => {}, seekTo: async () => {}, setSpeed: async () => {}, setFx: async () => ({ peakBoostDb: 0 }), setSkipSilence: async () => {}, setSleepTimer: async () => {}, setAlbumMode: async () => {}, setSeekStep: async () => {}, setVisualizer: async () => {}, stop: async () => {}, openBatterySettings: async () => {} };
w.Capacitor = { isNativePlatform: () => true, convertFileSrc: u => u, Plugins: { Player, ShelfFiles: { addListener: listen, scanFolder: async () => {}, getMeta: async () => ({ duration: 0, cover: '' }) }, App: { addListener(){}, getInfo: async () => ({ version: '2.2.0' }), minimizeApp(){} } } };
globalThis.Capacitor = w.Capacitor;

// ---------- a realistic library: 300 books x 20 chapters, covers ----------
const books = Array.from({ length: 300 }, (_, i) => ({ id: 'b' + i, title: 'Книга ' + i, author: 'Автор', added: i, marks: [],
  files: Array.from({ length: 20 }, (_, j) => ({ uri: `content://com.android.externalstorage.documents/tree/primary%3AAudiobooks/document/primary%3AAudiobooks%2FBook${i}%2F${j}.mp3`, name: 'Глава ' + (j + 1), duration: 0, size: 12_000_000 + j })),
  hasCover: i < 100 }));
for (let i = 0; i < 100; i++) store.set('cover:b' + i, 'data:image/jpeg;base64,' + 'A'.repeat(30000));
store.set('books', books); store.set('folders', []); store.set('settings', { theme: 'dark', autoscan: false }); store.set('foldersSelected', []);
w.localStorage.setItem('shelf:lastPlayback', JSON.stringify({ bookId: 'b5', index: 0, pos: 10, ts: now }));

await import(pathToFileURL(WWW + '/app.js').href);
await advance(1500);
const { state } = await import(pathToFileURL(WWW + '/js/state.js').href);
const { setScreen } = await import(pathToFileURL(WWW + '/js/router.js').href);
const sound = await import(pathToFileURL(WWW + '/js/sound.js').href);
await (await import(pathToFileURL(WWW + '/js/storage.js').href)).flushBooks();   // finish the one-time legacy migration first
await advance(2000);
writes.length = 0; lsWrites = 0;                 // measure only the session itself

setScreen('player'); await advance(300);
let pos = 10, idx = 0;
const ev = (over = {}) => emit('state', { bookId: 'b5', index: idx, count: 20, pos, dur: 1800, playWhenReady: true, playing: true, state: 3, speed: state.speed || 1, sleepLeft: 0, ...over });
const SESSION = 600_000, STEP = 500;
const marks = { speed: 120_000, eq: 200_000, chapter: 300_000, pause: 420_000, resume: 440_000 };
let did = {};
for (let t = 0; t < SESSION; t += STEP) {
  pos += STEP / 1000 * (state.speed || 1);
  if (t === marks.speed && !did.speed) { did.speed = 1; for (let k = 0; k < 3; k++) w.document.getElementById('speedBtn').click(); }
  if (t === marks.eq && !did.eq) { did.eq = 1; sound.openCurrentSound(); const sl = [...w.document.querySelectorAll('[data-eq]')]; for (let k = 0; k < 30; k++) { const el = sl[k % sl.length]; el.value = String(((k * 3) % 13) - 6); el.dispatchEvent(new w.Event('input')); await advance(120); } }
  if (t === marks.chapter && !did.chapter) { did.chapter = 1; idx = 1; pos = 0; ev({ dur: 1777.7 }); }   // next chapter, duration unknown in the library -> discovered by the decoder
  if (t === marks.pause && !did.pause) { did.pause = 1; ev({ playWhenReady: false, playing: false }); }
  if (t === marks.resume && !did.resume) { did.resume = 1; }
  ev(did.pause && !did.resume ? { playWhenReady: false, playing: false } : {});
  await advance(STEP);
}
await advance(30_000);   // let debounced writes land

const by = {}; for (const x of writes) { (by[x.key] ||= { n: 0, bytes: 0 }); by[x.key].n++; by[x.key].bytes += x.bytes; }
const total = writes.reduce((a, x) => a + x.bytes, 0);
let fail = 0; const ok = (c, m) => { if (!c) fail++; console.log(c ? '  ok:' : '  FAIL:', m); };
console.log('IndexedDB writes in a 10-minute session:', JSON.stringify(by));
ok(coverReads <= 2, `covers are read lazily at start-up (${coverReads} reads, 100 books have a cover)`);
ok((by.books?.n || 0) <= 4, `the whole library is rewritten at most 4 times (${by.books?.n || 0}) — speed/EQ clicks must not touch it`);
ok((by.bookprefs?.bytes || 0) < 2000, `per-book prefs stay tiny (${by.bookprefs?.bytes || 0} bytes)`);
ok((by.progress?.n || 0) <= 40, `position records: ${by.progress?.n || 0} writes in 10 minutes`);
ok(!by.folders && !by.playlists, 'folders / playlists are not rewritten while listening');
console.log(fail ? fail + ' FAILURE(S)' : 'DB WRITES OK');
process.exit(fail ? 1 : 0);
