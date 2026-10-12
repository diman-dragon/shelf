import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const WWW = fileURLToPath(new URL('../www', import.meta.url));
const html = fs.readFileSync(WWW + '/index.html', 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { url: 'https://localhost/', pretendToBeVisual: true }); dom.window.localStorage.setItem('lang','ru');
const w = dom.window;
for (const k of ['window','document','localStorage','navigator','HTMLImageElement','HTMLElement','Event','EventTarget','requestAnimationFrame','cancelAnimationFrame']) {
  try { Object.defineProperty(globalThis, k, { value: k==='window'?w : w[k], configurable: true, writable: true }); } catch(e) {}
}
globalThis.window = w;
// Audio stub (jsdom has no media)
class FakeAudio extends w.EventTarget { constructor(){ super(); this.paused=true; this.ended=false; this.src=''; this.currentTime=0; this.duration=NaN; this.volume=1; this.muted=false; this.playbackRate=1; }
  pause(){ this.paused=true; this.dispatchEvent(new w.Event('pause')); } async play(){ this.paused=false; this.dispatchEvent(new w.Event('play')); } load(){} removeAttribute(){ this.src=''; } }
globalThis.Audio = FakeAudio; w.Audio = FakeAudio;
globalThis.fetch = async (u) => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(new URL(u), 'utf8')) });
w.fetch = globalThis.fetch;
globalThis.URL.createObjectURL = () => 'blob:x'; globalThis.URL.revokeObjectURL = () => {};
globalThis.MediaMetadata = class {};

// ---- fake idb-keyval ----
const store = new Map();
w.idbKeyval = { get: async k => structuredClone(store.get(k)), set: async (k,v) => { store.set(k, structuredClone(v)); }, del: async k => { store.delete(k); } };

// ---- fake Capacitor plugins (native mode) ----
const listeners = { Player: {}, ShelfFiles: {} };
const mkListen = name => (ev, fn) => { (listeners[name][ev] ||= []).push(fn); return {remove(){}}; };
const emit = (name, ev, data) => (listeners[name][ev] || []).forEach(f => f(data));
let nativeState = { loaded:false, saved:{} };
let queue = null;
const calls = [];
const Player = {
  addListener: mkListen('Player'),
  getState: async () => ({ saved: nativeState.saved, loaded: !!queue, ...(queue ? queue.state : {}) }),
  setQueue: async (o) => { queue = { o, state: { bookId:o.bookId, index:o.index, count:o.items.length, pos:o.pos, dur:100, playWhenReady:false, playing:false, state:3, speed:o.speed, sleepLeft:0 } }; calls.push(['setQueue', o.index, o.pos, o.items.length]); },
  play: async()=>{ queue.state.playWhenReady=true; queue.state.playing=true; }, pause: async()=>{ queue.state.playWhenReady=false; queue.state.playing=false; },
  seekTo: async()=>{}, setSpeed: async()=>{}, setFx: async(o)=>{ calls.push(['setFx', o]); return {peakBoostDb:0}; }, setSkipSilence: async(o)=>{ calls.push(['skip', o.on]); }, setSleepTimer: async(o)=>{ calls.push(['sleep', o.minutes]); }, setAlbumMode: async(o)=>{ calls.push(['album', o.on]); }, setOrderMode: async(o)=>{ calls.push(['order', o.mode]); }, skip: async(o)=>{ calls.push(['skip', o.forward]); }, setSeekStep: async(o)=>{ calls.push(['seek', o.sec]); }, setVisualizer: async()=>{}, stop: async()=>{ calls.push(['stop']); queue=null; }, openBatterySettings: async()=>{}
};
const scanCalls = [];
const ShelfFiles = { addListener: mkListen('ShelfFiles'), downloadFile: async(o)=>{ calls.push(['download', o.dir, o.name, o.url]); if(globalThis.__dlFail) throw new Error('denied'); return { uri:'content://tree/dl/'+o.name, size:o.size||1000 }; }, cancelDownload: async()=>{}, deleteFile: async(o)=>{ if(globalThis.__denyDelete) throw new Error('denied'); calls.push(['delete', o.uri]); }, pickFolder: async()=>({uri:'content://tree/primary%3AAudiobooks', name:'primary:Audiobooks'}),
  scanFolder: async (o) => { scanCalls.push(o); }, getMeta: async()=>({duration:0, cover:''}) };
w.Capacitor = { isNativePlatform: () => true, convertFileSrc: u => u, Plugins: { Player, ShelfFiles, App: { addListener(){}, getInfo: async()=>({version:'2.2.0'}), minimizeApp(){} } } };

globalThis.Capacitor = w.Capacitor;
let failures = 0;
const ok = (c, msg) => { if (!c) { failures++; console.log('  FAIL:', msg); } else console.log('  ok:', msg); };

// ---- seed storage: 2 books, a saved position in book 1, autoscan ON, folder exists but NOT selected -> must NOT open sheet ----
const mkBook = (id, title, n) => ({ id, title, author:'A', files: Array.from({length:n}, (_,i)=>({uri:`content://${id}/${i}`, name:`Ch ${i+1}`, duration:100})), added: Date.now(), marks:[], cover:'data:image/png;base64,AAAA' });
store.set('books', [mkBook('b1','Книга один',3), mkBook('b2','Книга два',2)]);
store.set('folders', [{ id:'f1', name:'primary:Audiobooks', uri:'content://tree/f1' }]);
store.set('settings', { theme:'dark', autoscan:true });
store.set('foldersSelected', []);                       // folders exist but nothing selected
w.localStorage.setItem('shelf:lastPlayback', JSON.stringify({ bookId:'b1', index:1, pos:42.5, ts: Date.now() }));

const errors = [];
process.on('unhandledRejection', e => errors.push(e));
w.addEventListener('error', e => errors.push(e.error || e.message));

console.log('== load app');
await import(pathToFileURL(WWW + '/app.js').href);
await new Promise(r => setTimeout(r, 900));          // let autoscan timer (500ms) fire
const { state } = await import(pathToFileURL(WWW + '/js/state.js').href);
ok(errors.length === 0, 'no uncaught errors during startup ' + (errors[0] ? String(errors[0].stack||errors[0]) : ''));
ok(state.books.length === 2, 'books loaded');
ok(state.current?.id === 'b1' && state.currentIndex === 1 && state.currentPos === 42.5, `position restored EXACTLY (idx=${state.currentIndex}, pos=${state.currentPos})`);
ok(w.document.getElementById('modalRoot').innerHTML.trim() === '', 'autoscan with no selected folders: no folder sheet');
ok(state.screen === 'shelf' && scanCalls.length === 0, 'autoscan with nothing selected does nothing');
ok(state.folders[0].name === 'Audiobooks', 'folder name prefix stripped: ' + state.folders[0].name);
ok(state.appVersion === '2.2.0', 'app version from Capacitor');
ok(w.document.querySelectorAll('.library-book-item').length === 2, 'shelf rendered 2 rows');
ok(!/onerror/.test(w.document.getElementById('main').innerHTML), 'no inline onerror handlers in DOM');

console.log('== every screen renders without errors');
{
  const { setScreen: go } = await import(pathToFileURL(WWW + '/js/router.js').href);
  for (const name of ['catalog', 'settings', 'shelf']) {
    const before = errors.length;
    go(name);
    ok(errors.length === before && w.document.querySelector('#main .screen'), `screen "${name}" rendered`);
  }
  go('catalog');
  ok(!!w.document.querySelector('#catForm') && w.document.querySelectorAll('[data-clang]').length === 5 && w.document.querySelectorAll('[data-csrc]').length === 3, 'catalog: search field, 3 sources and 5 language chips drawn');
  ok(!w.document.querySelector('[data-nav="discover"]') && !w.document.querySelector('[data-nav="playlists"]') && !!w.document.querySelector('[data-nav="catalog"]'), '«Для вас» is gone, «Каталог» is in the bottom bar');
  go('shelf');
}

console.log('== position survives native shutdown (the reported bug)');
const { audio, NATIVE } = await import(pathToFileURL(WWW + '/js/sound.js').href);
ok(NATIVE === true, 'native mode');
const player = await import(pathToFileURL(WWW + '/js/player.js').href);
const { setScreen } = await import(pathToFileURL(WWW + '/js/router.js').href);
setScreen('player'); await new Promise(r => setTimeout(r, 100));
ok(calls.some(c => c[0]==='setQueue' && c[1]===1 && c[2]===42.5), 'native queue loaded at saved chapter/position ' + JSON.stringify(calls));
ok(state.currentPos === 42.5, 'currentPos not wiped by loading (' + state.currentPos + ')');
// service reports playing at 60s
emit('Player','state',{ bookId:'b1', index:1, count:3, pos:60, dur:100, playWhenReady:true, playing:true, state:3, speed:1, sleepLeft:0 });
await new Promise(r => setTimeout(r, 50));
// notification X: service sends an EMPTY state (pos 0), then 'closed'
emit('Player','state',{ bookId:'', index:0, count:0, pos:0, dur:0, playWhenReady:false, playing:false, state:1, speed:1, sleepLeft:0 });
emit('Player','closed',{});
await new Promise(r => setTimeout(r, 100));
const rec = JSON.parse(w.localStorage.getItem('shelf:lastPlayback'));
ok(rec.bookId==='b1' && rec.index===1 && rec.pos>=59 && rec.pos<70, 'saved position after close = ' + JSON.stringify(rec));
const prog = store.get('progress');
ok(prog?.b1 && prog.b1.i===1 && prog.b1.t>=59, 'IDB progress record = ' + JSON.stringify(prog));

console.log('== storage layout');
await (await import(pathToFileURL(WWW + '/js/storage.js').href)).flushBooks();
const savedBooks = store.get('books');
ok(savedBooks.every(b => !('cover' in b)), 'books list stored WITHOUT covers');
ok(store.get('cover:b1') === 'data:image/png;base64,AAAA', 'cover stored under its own key');

console.log('== restart restores same position, no -10s drift');
w.localStorage.setItem('shelf:lastPlayback', JSON.stringify({ bookId:'b1', index:1, pos:75, ts: Date.now() }));
const st = await import(pathToFileURL(WWW + '/js/storage.js').href);
const loaded = await st.loadBooks();
const lb1 = loaded.find(b=>b.id==='b1');
ok(lb1.cover === undefined, 'covers are NOT read at start-up (lazy)');
ok((await st.loadCover(lb1)) === 'data:image/png;base64,AAAA' && lb1.cover === 'data:image/png;base64,AAAA', 'cover loaded on demand');
ok(st.getSavedPosition(loaded.find(b=>b.id==='b1')).t === 75, 'getSavedPosition = exact');

console.log('== finished book stays at 100%');
const { progress } = await import(pathToFileURL(WWW + '/js/progress.js').href);
audio.dispatchEvent(new w.Event('ended'));
await new Promise(r => setTimeout(r, 80));
ok(state.current.finished === true && state.currentIndex === 2, 'finished flag + last chapter, index=' + state.currentIndex);
ok(Math.round(progress(state.current)) === 100, 'progress 100% after ending');

console.log('== scan: stripExt, silent, incremental rows, dedup');
const scanner = await import(pathToFileURL(WWW + '/js/scanner.js').href);
state.selectedFolderIds = ['f1'];
setScreen('shelf');
await scanner.scanAllFolders({ silent: true });
ok(scanCalls.length === 1, 'silent scan started');
ok(w.document.getElementById('modalRoot').innerHTML.trim() === '' && state.screen === 'shelf', 'silent scan: no sheet');
emit('ShelfFiles','scanStarted',{ folderId:'f1', totalFiles:4, folderName:'Audiobooks' });
const f = (n,size) => ({ uri:'content://x/'+n, name:n, size, duration:10 });
emit('ShelfFiles','scanBook',{ folderId:'f1', folderName:'Audiobooks', path:'Автор/Мастер и Маргарита. Булгаков', title:'Мастер и Маргарита. Булгаков', author:'Автор', files:[f('01.mp3',111),f('02.mp3',222)] });
emit('ShelfFiles','scanBook',{ folderId:'f1', folderName:'Audiobooks', path:'Vol. 1 Foundation', title:'Vol. 1 Foundation', author:'', files:[f('Vol. 1 Foundation.m4b',333)] });
// duplicate of the first (other folder path, same sizes)
emit('ShelfFiles','scanBook',{ folderId:'f1', folderName:'Audiobooks', path:'copy/Копия', title:'Копия', author:'', files:[f('a.mp3',111),f('b.mp3',222)] });
const scrollEl = w.document.querySelector('.screen'); scrollEl.scrollTop = 123;
await new Promise(r => setTimeout(r, 700));
ok(state.books.some(b => b.title === 'Мастер и Маргарита. Булгаков'), 'folder title with dot kept intact');
ok(state.books.some(b => b.title === 'Vol. 1 Foundation'), '"Vol. 1 Foundation" kept intact');
const b3 = state.books.find(b => b.title === 'Vol. 1 Foundation');
ok(b3.files[0].name === 'Vol. 1 Foundation', 'file extension stripped: ' + b3.files[0].name);
ok(state.scan.skipped === 1 && !state.books.some(b => b.title === 'Копия'), 'duplicate skipped via index');
ok(w.document.querySelectorAll('.library-book-item').length === 4, 'rows appended incrementally: ' + w.document.querySelectorAll('.library-book-item').length);
ok(w.document.querySelector('.screen') === scrollEl && scrollEl.scrollTop === 123, 'shelf DOM + scroll position preserved during scan');
emit('ShelfFiles','scanComplete',{ folderId:'f1', processedFiles:4, totalFiles:4, errors:0, timeouts:0 });
await new Promise(r => setTimeout(r, 700));
ok(state.scan.active === false, 'scan finished');

console.log('== leave player: visualizer cleaned up, delete current book stops native');
setScreen('player'); await new Promise(r=>setTimeout(r,50));
setScreen('settings');
ok(!w.document.getElementById('visualizerCanvas'), 'player DOM gone');
state.current = state.books.find(b=>b.id==='b2'); state.currentIndex=0; state.currentPos=0;
setScreen('player'); await new Promise(r=>setTimeout(r,80));
calls.length = 0;
const lib = await import(pathToFileURL(WWW + '/js/library.js').href);
lib.openBookMenu('b2');
w.document.getElementById('menuDelete').click();
w.document.getElementById('bookHide').click();
await new Promise(r => setTimeout(r, 120));
ok(calls.some(c=>c[0]==='stop'), 'deleteBook stops the native player');
ok(state.screen === 'shelf' && state.current === null, 'screen -> shelf after delete from player');
ok(w.document.querySelector('.nav-item.active')?.dataset.nav === 'shelf', 'nav highlight = shelf');

console.log('== sleep timer remaining');
state.current = state.books[0]; state.currentIndex=0;
setScreen('player'); await new Promise(r=>setTimeout(r,60));
emit('Player','state',{ bookId:state.current.id, index:0, count:state.current.files.length, pos:1, dur:100, playWhenReady:true, playing:true, state:3, speed:1, sleepLeft:600 });
await new Promise(r=>setTimeout(r,50));
ok(state.sleepEndsAt > Date.now() + 590000, 'native sleepLeft mirrored into UI state');
ok(/^\d+:\d\d$/.test(w.document.getElementById('sleepLabel')?.textContent || ''), 'timer button shows remaining: ' + w.document.getElementById('sleepLabel')?.textContent);


console.log('== album mode: per-book, remembered, sent to the native player');
{
  const b = state.books.find(x => x.id === 'b1');
  state.current = b; state.currentIndex = 0; state.currentPos = 0;
  setScreen('player'); await new Promise(r=>setTimeout(r,80));
  ok(calls.some(c => c[0]==='album' && c[1]===false), 'book mode sent to the service when the queue is loaded');
  const btn = w.document.getElementById('modeBtn');
  ok(!!btn && /Книга/.test(btn.textContent), 'mode button present, default = Книга');
  calls.length = 0;
  btn.click(); await new Promise(r=>setTimeout(r,60));
  ok(b.mode === 'album' && calls.some(c => c[0]==='album' && c[1]===true), 'toggle -> album, service informed');
  ok(/Альбом/.test(w.document.getElementById('modeBtn').textContent), 'button label = Альбом');
  await new Promise(r=>setTimeout(r,1200));
  const prefs = store.get('bookprefs');
  ok(prefs?.b1?.mode === 'album', 'stored in bookprefs: ' + JSON.stringify(prefs?.b1));
  ok(!JSON.stringify(store.get('books')).includes('"mode"'), 'the library record itself is not touched');
  const st2 = await import(pathToFileURL(WWW + '/js/storage.js').href);
  const again = await st2.loadBooks();
  ok(again.find(x=>x.id==='b1').mode === 'album' && again.filter(x=>x.id!=='b1').every(x=>!x.mode), 'restored after restart, other books stay in book mode');
  calls.length = 0;
  w.document.getElementById('modeBtn').click(); await new Promise(r=>setTimeout(r,60));
  ok(b.mode === 'book' && calls.some(c => c[0]==='album' && c[1]===false), 'toggle back -> book');
}

console.log('== album track order: in order / one / all / shuffle, album only');
{
  const b = state.books.find(x => x.id === 'b1');
  state.current = b; state.currentIndex = 0; state.currentPos = 0; b.mode = 'book'; b.order = undefined;
  setScreen('player'); await new Promise(r=>setTimeout(r,80));
  const ob = () => w.document.getElementById('orderBtn');
  ok(!!ob() && ob().hidden, 'a book has no order button');
  w.document.getElementById('modeBtn').click(); await new Promise(r=>setTimeout(r,60));
  ok(!ob().hidden && /Подряд/.test(ob().textContent), 'an album shows it, default = in order');
  const seen = [];
  for(let k = 0; k < 4; k++){ calls.length = 0; ob().click(); await new Promise(r=>setTimeout(r,40)); seen.push([b.order, calls.find(c => c[0]==='order')?.[1], ob().textContent.trim()]); }
  ok(JSON.stringify(seen.map(x => x.slice(0,2))) === JSON.stringify([['one',1],['all',2],['shuffle',3],['order',0]]), 'cycle one -> all -> shuffle -> in order, the service gets 1, 2, 3, 0: ' + JSON.stringify(seen));
  ob().click(); ob().click(); await new Promise(r=>setTimeout(r,1200));
  ok(store.get('bookprefs')?.b1?.order === 'all', 'order stored in bookprefs: ' + JSON.stringify(store.get('bookprefs')?.b1));
  calls.length = 0;
  w.document.getElementById('modeBtn').click(); await new Promise(r=>setTimeout(r,60));
  ok(b.mode === 'book' && ob().hidden && calls.some(c => c[0]==='order' && c[1]===0), 'back to a book: button hidden, the service plays in order');
  w.document.getElementById('modeBtn').click(); await new Promise(r=>setTimeout(r,60));
  ok(b.mode === 'album' && /Повтор/.test(ob().textContent), 'the album remembers its order');
  calls.length = 0;
  w.document.getElementById('nextBtn').click(); await new Promise(r=>setTimeout(r,60));
  ok(calls.some(c => c[0]==='skip' && c[1]===true), 'next in a non-"in order" album is the player\'s own skip (shuffle / repeat aware)');
  b.order = 'order'; b.mode = 'book';
}

console.log('== album: take a track out of the list / delete it from the phone (never in a book)');
{
  const b = state.books.find(x => x.id === 'b1');
  b.files = [0,1,2,3].map(n => ({ name: 'Track ' + n, uri: 'content://t/' + n, duration: 100 }));
  b.mode = 'book'; b.marks = [{ i: 3, t: 5 }, { i: 1, t: 9 }]; b.removed = undefined;
  state.current = b; state.currentIndex = 2; state.currentPos = 7;
  setScreen('player'); await new Promise(r=>setTimeout(r,80));
  ok(!w.document.querySelector('[data-track-del]'), 'a book has no remove buttons');
  w.document.getElementById('modeBtn').click(); await new Promise(r=>setTimeout(r,60));
  ok(w.document.querySelectorAll('[data-track-del]').length === 4, 'an album has one per track');
  calls.length = 0;
  w.document.querySelector('[data-track-del="1"]').click();
  ok(!!w.document.getElementById('trackHide') && !!w.document.getElementById('trackErase'), 'the menu offers: remove from list / delete from the phone');
  w.document.getElementById('trackHide').click(); await new Promise(r=>setTimeout(r,120));
  ok(b.files.length === 3 && b.files.every(f => f.uri !== 'content://t/1'), 'the track is gone from the list');
  ok(JSON.stringify(b.removed) === '["content://t/1"]', 'remembered, so a rescan does not bring it back');
  ok(state.currentIndex === 1, 'the playing track keeps its place (index 2 -> 1)');
  ok(JSON.stringify(b.marks) === '[{"i":2,"t":5}]', 'bookmarks follow: the one on the removed track is dropped, the other shifts: ' + JSON.stringify(b.marks));
  ok(calls.some(c => c[0] === 'setQueue' && c[1] === 1 && c[3] === 3), 'the native queue is rebuilt without it, at the same track: ' + JSON.stringify(calls.filter(c => c[0] === 'setQueue')));
  ok(!calls.some(c => c[0] === 'delete'), 'nothing is deleted from the phone');
  calls.length = 0;
  w.document.querySelector('[data-track-del="0"]').click();
  w.document.getElementById('trackErase').click();
  ok(!!w.document.getElementById('trackEraseGo'), 'deleting a file asks once more');
  w.document.getElementById('trackEraseGo').click(); await new Promise(r=>setTimeout(r,120));
  ok(calls.some(c => c[0] === 'delete' && c[1] === 'content://t/0') && b.files.length === 2, 'confirmed: the file is deleted and the track leaves the list');
  globalThis.__denyDelete = true;
  w.document.querySelector('[data-track-del="0"]').click();
  w.document.getElementById('trackErase').click(); w.document.getElementById('trackEraseGo').click(); await new Promise(r=>setTimeout(r,100));
  ok(b.files.length === 2, 'no permission: nothing changes, a message is shown');
  globalThis.__denyDelete = false;
  b.mode = 'book';
}

console.log('== catalog: search, licence, listen online, download (Premium), tabs, nothing is lost after the trial');
{
  const C = await import(pathToFileURL(WWW + '/js/catalog.js').href);
  const Pm = await import(pathToFileURL(WWW + '/js/premium.js').href);
  const lib = await import(pathToFileURL(WWW + '/js/library.js').href);
  ok(/advancedsearch\.php/.test(C.searchUrl({ q: 'Булгаков', lang: 'ru', page: 2 })) && /collection%3Alibrivoxaudio/.test(C.searchUrl({ q: '', lang: 'en', page: 1 })), 'search URL: LibriVox collection, paged');
  ok(!/Russian/.test(decodeURIComponent(C.searchUrl({ q: '', lang: 'all', page: 1 }))) && /language%3A\(rus%20OR%20Russian\)/.test(C.searchUrl({ q: '', lang: 'ru', page: 1 })), 'search URL: language filter only when chosen');
  const parsed = C.parseSearch({ response: { numFound: 2, docs: [{ identifier: 'a1', title: 'T<b>x</b>', creator: ['Автор'], language: 'Russian' }, { title: 'no id' }] } });
  ok(parsed.total === 2 && parsed.items.length === 1 && parsed.items[0].title === 'T x' && parsed.items[0].author === 'Автор', 'search result parsed, items without id dropped');
  ok(C.parseLength('1234.5') === 1234.5 && C.parseLength('20:34') === 1234 && C.parseLength('1:02:03') === 3723 && C.parseLength('') === 0, 'length: seconds, mm:ss, h:mm:ss');
  ok(C.licenseOf({ licenseurl: 'http://creativecommons.org/licenses/by-sa/3.0/' }).name === 'CC BY-SA 3.0' && C.licenseOf({ licenseurl: 'https://creativecommons.org/publicdomain/zero/1.0/' }).name.startsWith('CC0') && /Общественное/.test(C.licenseOf({}).name), 'licence names: CC, CC0, default public domain');
  const picked = C.pickFiles('id1', [
    { name: 'b_02_64kb.mp3', format: '64Kbps MP3', length: '60', size: '1000', title: 'Две' }, { name: 'b_01_64kb.mp3', format: '64Kbps MP3', length: '30', size: '500', title: 'Раз' },
    { name: 'b_01_128kb.mp3', format: '128Kbps MP3', length: '30', size: '900' }, { name: 'all.zip', format: '64Kbps MP3 ZIP' }, { name: 'x.m4b', format: 'LibriVox Apple Audiobook' }]);
  ok(picked.length === 2 && picked[0].name === 'Раз' && picked[1].duration === 60 && /^https:\/\/archive\.org\/download\/id1\/b_02_64kb\.mp3$/.test(picked[1].uri), 'one set of chapters (64 kbps), in order, https links');

  const mu = decodeURIComponent(C.searchUrl({ q: '', lang: 'ru', page: 1, src: 'music' }));
  ok(/collection:netlabels/.test(mu) && /NOT licenseurl:\(\*-nc\*\)/.test(mu) && !/language:/.test(mu), 'music source: netlabels, no NC/ND, no language filter');
  ok(/audio_bookspoetry/.test(decodeURIComponent(C.searchUrl({ q: '', lang: 'ru', page: 1, src: 'books' }))) && /language:\(rus OR Russian\)/.test(decodeURIComponent(C.searchUrl({ q: '', lang: 'ru', page: 1, src: 'books' }))), 'other books source: its own collection, language filter');
  ok(C.licenseOf({}, true) === null && C.licenseOf({ licenseurl: 'https://creativecommons.org/licenses/by/4.0/' }, true).name === 'CC BY 4.0', 'outside LibriVox a missing licence is refused');
  const mp = C.pickFiles('alb', [{ name: 'a.mp3', format: '128Kbps MP3', length: '200', track: '1' }, { name: 'a_vbr.mp3', format: 'VBR MP3', length: '200', track: '1' }], true);
  ok(mp.length === 1 && mp[0].fileName === 'a_vbr.mp3' && mp[0].name === 'Трек 1', 'music prefers VBR MP3 and names tracks');
  const item = { id: 'rus1', title: 'Тест', author: 'Кто-то', language: 'Russian', license: 'Общественное достояние', licenseUrl: 'https://librivox.org/pages/public-domain/', files: picked.map(f => ({ ...f })), duration: 90, size: 1500 };
  const before = state.books.length;
  const book = await C.ensureBook(item);
  ok(state.books.length === before + 1 && book.online === true && book.source.id === 'rus1' && book.files[0].uri.startsWith('https://'), 'listen online: a library book with source and https files');
  ok((await C.ensureBook(item)) === book && state.books.length === before + 1, 'the same catalog book is never added twice');
  ok(/Онлайн · Общественное достояние/.test(C.sourceLine(book)), 'library row shows where it is from and the licence: ' + C.sourceLine(book));
  state.libraryFilterType = 'online'; setScreen('shelf'); await new Promise(r => setTimeout(r, 40));
  ok([...w.document.querySelectorAll('.library-book-item')].some(e => e.dataset.id === book.id), 'tab «Онлайн» lists it');
  state.libraryFilterType = 'book'; lib.renderShelf();
  ok(![...w.document.querySelectorAll('.library-book-item')].some(e => e.dataset.id === book.id), 'tab «Книги» does not list a streamed book');

  // download: Premium, into the chosen folder, files become content:// and the book is "downloaded"
  Pm._reset();                                                                // a fresh trial: everything open
  calls.length = 0;
  await C.saveBook(item);
  const dl = calls.filter(c => c[0] === 'download');
  ok(dl.length === 2 && dl[0][1] === 'AudioShelf/Тест' && /^001 - Раз\.mp3$/.test(dl[0][2]) && dl[0][3].startsWith('https://archive.org/'), 'download: chapter by chapter into AudioShelf/<title>: ' + JSON.stringify(dl.map(d => d[2])));
  ok(book.online === false && book.downloadedAt > 0 && book.files.every(f => f.uri.startsWith('content://')) && book.srcPath === state.folders[0].id + ':AudioShelf/Тест', 'after the download the book points at the local files and a rescan will update it, not copy it');
  state.libraryFilterType = 'book'; lib.renderShelf();
  const dlRow = [...w.document.querySelectorAll('.library-book-item')].find(e => e.dataset.id === book.id);
  ok(!!dlRow && !!dlRow.querySelector('.dl-badge'), 'tab «Книги» lists the downloaded book with a small download icon');
  state.libraryFilterType = 'online'; lib.renderShelf();
  ok(![...w.document.querySelectorAll('.library-book-item')].some(e => e.dataset.id === book.id), 'tab «Онлайн» no longer lists it once it is downloaded');
  ok(w.document.querySelectorAll('[data-filter]').length === 4, 'the library has four tabs: all, books, music, online');
  state.libraryFilterType = 'book'; lib.renderShelf();
  ok(/Скачано/.test(w.document.querySelector('.lib-lic')?.textContent || ''), 'row says «Скачано · licence»');

  // after the trial: nothing is hidden or deleted, only NEW downloads need Premium
  Pm._reset({ start: Date.now() - 40 * 86400000, seen: Date.now() });
  ok(Pm.status() === 'free', 'trial is over');
  ok(state.books.includes(book) && book.files.length === 2 && book.downloadedAt > 0, 'downloaded books stay in the library and keep playing after the trial');
  const item2 = { ...item, id: 'rus2', title: 'Второй' };
  calls.length = 0;
  await C.saveBook(item2);
  ok(calls.filter(c => c[0] === 'download').length === 0 && !state.books.some(b => b.source?.id === 'rus2' && !b.online), 'without Premium a new download does not start');
  const sheetOpen = !!w.document.querySelector('.pm-perks');
  ok(sheetOpen, 'the Premium sheet is shown instead');
  w.document.getElementById('modalRoot').innerHTML = '';
  // removing the library folder does not remove what was downloaded
  const keep = state.books.filter(b => b.sourceFolderId === book.sourceFolderId && b.downloadedAt).length;
  ok(keep === 1, 'a downloaded book is marked so that removing its folder keeps it');
  Pm._reset(); state.libraryFilterType = 'all';
  state.books = state.books.filter(b => !b.source);                        // the test books are not part of the later tests
  setScreen('shelf');
}

console.log('== play / pause from the notification shade: no redundant work, no flicker');
{
  const mk = (over={}) => ({ bookId:'b1', index:0, count:3, pos:5, dur:100, playWhenReady:true, playing:true, state:3, speed:1, sleepLeft:0, ...over });
  emit('Player','state', mk());
  await new Promise(r=>setTimeout(r,50));
  audio.dispatchEvent(new w.Event('play'));
  await new Promise(r=>setTimeout(r,30));
  calls.length = 0;
  for(let i=0;i<5;i++) audio.dispatchEvent(new w.Event('play'));     // start from the shade / return to the app / new chapter ...
  await new Promise(r=>setTimeout(r,60));
  ok(calls.filter(c=>c[0]==='setFx').length === 0, 'unchanged sound settings are NOT re-sent to the native DSP on play events');
  ok(calls.filter(c=>c[0]==='skip').length === 0, 'skip-silence is not re-sent either');

  const seen = []; const rec = e => seen.push(e.type);
  audio.addEventListener('play', rec); audio.addEventListener('pause', rec);
  audio.pause();                                                      // the person presses pause
  emit('Player','state', mk({ pos:5.2 }));                           // a state sent BEFORE the service saw the pause arrives late
  ok(audio._paused === true && !seen.includes('play'), 'a late "playing" state does not flip the button back (' + seen.join(',') + ')');
  emit('Player','state', mk({ pos:5.3, playWhenReady:false, playing:false }));
  ok(audio._paused === true && seen.filter(x=>x==='pause').length === 1, 'pause is reported exactly once');
  await new Promise(r=>setTimeout(r,800));                            // the command window is over: the real state wins again
  emit('Player','state', mk({ pos:6 }));                              // started from the shade
  ok(audio._paused === false && seen.includes('play'), 'start from the shade is picked up');
  audio.removeEventListener('play', rec); audio.removeEventListener('pause', rec);
}

console.log('== two progress bars in book mode, one in album mode');
{
  const b = state.books.find(x => x.id === 'b1');
  b.mode = 'book'; state.current = b; state.currentIndex = 1; state.currentPos = 30;
  setScreen('shelf'); setScreen('player'); await new Promise(r=>setTimeout(r,120));
  emit('Player','state',{ bookId:'b1', index:1, count:3, pos:30, dur:100, playWhenReady:false, playing:false, state:3, speed:1, sleepLeft:0 });   // the service reports chapter 2 at 0:30
  await new Promise(r=>setTimeout(r,120));
  const vis = id => { const el = w.document.getElementById(id); return !!el && !el.closest('[hidden]'); };
  ok(vis('seekCh') && vis('seek'), 'book mode: chapter bar AND whole-book bar are shown');
  ok(/Вся книга/.test(w.document.getElementById('bookProgress').textContent) && /Глава/.test(w.document.getElementById('chLabel').textContent), 'both are labelled');
  ok(w.document.getElementById('chCur').textContent === '0:30', 'chapter time is the position in the chapter: ' + w.document.getElementById('chCur').textContent);
  ok(w.document.getElementById('curTime').textContent !== w.document.getElementById('chCur').textContent, 'whole-book time differs from the chapter time');
  w.document.getElementById('modeBtn').click(); await new Promise(r=>setTimeout(r,80));
  ok(vis('seekCh') && !vis('seek'), 'album mode: only the current track bar');
  ok(/Трек/.test(w.document.getElementById('chLabel').textContent), 'labelled "Трек" in album mode');
  w.document.getElementById('modeBtn').click(); await new Promise(r=>setTimeout(r,80));
  ok(vis('seek'), 'back to book mode: both bars again');
}

console.log('== seek step: default 10, changeable in the settings, shown in the player');
{
  const { seekStep } = await import(pathToFileURL(WWW + '/js/state.js').href);
  ok(seekStep() === 10, 'default step is 10 s');
  ok(/−10/.test(w.document.getElementById('backVal').textContent) && /\+10/.test(w.document.getElementById('fwdVal').textContent), 'player buttons show −10 / +10');
  setScreen('settings'); await new Promise(r=>setTimeout(r,60));
  ok(/±10/.test(w.document.getElementById('seekSetting').textContent), 'settings show the current step');
  w.document.getElementById('seekSetting').click(); await new Promise(r=>setTimeout(r,40));
  calls.length = 0;
  w.document.querySelector('[data-seek="30"]').click(); await new Promise(r=>setTimeout(r,80));
  ok(seekStep() === 30 && state.settings.seekStep === 30, 'step changed to 30 s');
  ok(calls.some(c => c[0]==='seek' && c[1]===30), 'the native service is told (notification / widget use it too)');
  ok(store.get('settings')?.seekStep === 30, 'saved in the settings record');
  setScreen('player'); await new Promise(r=>setTimeout(r,80));
  ok(/−30/.test(w.document.getElementById('backVal').textContent) && /\+30/.test(w.document.getElementById('fwdVal').textContent), 'player buttons now show −30 / +30');
  setScreen('settings'); w.document.getElementById('seekSetting').click(); await new Promise(r=>setTimeout(r,40));
  w.document.getElementById('seekCustom').value = '7'; w.document.getElementById('seekCustomSave').click(); await new Promise(r=>setTimeout(r,80));
  ok(seekStep() === 7, 'a custom value works');
  setScreen('settings'); w.document.getElementById('seekSetting').click(); await new Promise(r=>setTimeout(r,40));
  w.document.getElementById('seekCustom').value = '999'; w.document.getElementById('seekCustomSave').click(); await new Promise(r=>setTimeout(r,40));
  ok(seekStep() === 7, 'an out-of-range value is rejected');
  w.document.querySelector('[data-seek="10"]').click(); await new Promise(r=>setTimeout(r,60));
  ok(seekStep() === 10, 'and back to the default');
}

console.log('== store requirements inside the app');
{
  setScreen('settings'); await new Promise(r=>setTimeout(r,50));
  w.document.getElementById('privacySetting').click(); await new Promise(r=>setTimeout(r,40));
  ok(/не собирает/.test(w.document.getElementById('modalRoot').textContent), 'privacy policy opens from the settings');
  w.document.querySelector('#modalRoot [data-close]').click(); await new Promise(r=>setTimeout(r,40));
  w.document.getElementById('licensesSetting').click(); await new Promise(r=>setTimeout(r,40));
  ok(/Capacitor/.test(w.document.getElementById('modalRoot').textContent) && /Media3/.test(w.document.getElementById('modalRoot').textContent), 'open-source licences open from the settings');
  w.document.querySelector('#modalRoot [data-close]').click(); await new Promise(r=>setTimeout(r,40));
}

console.log('== swipes: the picture changes on the player cover, everywhere else the screens move');
{
  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === 'createLinearGradient' || k === 'createRadialGradient') ? () => ({ addColorStop(){} }) : () => {}, set: () => true });
  const swipe = async (el, dir, during) => {
    const x0 = dir === 'left' ? 500 : 300, x1 = dir === 'left' ? 300 : 500;
    const mk = (type, x, key) => { const e = new w.Event(type, { bubbles: true, cancelable: true }); const t = { clientX: x, clientY: 300 }; e[key] = [t]; if(key !== 'touches') e.touches = []; return e; };
    el.dispatchEvent(mk('touchstart', x0, 'touches'));
    el.dispatchEvent(mk('touchmove', (x0 + x1) / 2, 'touches'));
    if(during) during();
    el.dispatchEvent(mk('touchend', x1, 'changedTouches'));
    await new Promise(r => setTimeout(r, 380));
  };
  const hidden = () => { const v = w.document.getElementById('visualizer'); return !v || v.classList.contains('hidden'); };
  state.current = state.books.find(b => b.id === 'b1'); state.currentIndex = 0; state.currentPos = 0;
  setScreen('shelf'); await new Promise(r => setTimeout(r, 40));
  const bar = w.document.querySelector('.library-filters-bar');
  Object.defineProperty(bar, 'scrollWidth', { value: 700, configurable: true }); Object.defineProperty(bar, 'clientWidth', { value: 360, configurable: true });
  await swipe(bar.firstElementChild, 'left', () => { bar.scrollLeft = 90; });
  ok(state.screen === 'shelf', 'a swipe that scrolled a sideways-scrolling row does not change the screen');
  await swipe(w.document.querySelector('.shelf-list, .shelf-grid'), 'left');
  ok(state.screen === 'player', 'library: swipe left -> player');
  await swipe(w.document.querySelector('.player-title'), 'left');
  ok(state.screen === 'catalog', 'player (outside the picture): swipe left -> next screen, not the visualizer');
  await swipe(w.document.querySelector('.catalog-screen .topbar'), 'right');
  ok(state.screen === 'player', 'swipe right goes back');
  await swipe(w.document.querySelector('.player-title'), 'right');
  ok(state.screen === 'shelf' && hidden(), 'player: swipe right -> library');
  await swipe(w.document.querySelector('.shelf-list, .shelf-grid'), 'right');
  ok(state.screen === 'settings', 'the order is a loop: library <- settings');
  await swipe(w.document.querySelector('.settings-group'), 'left');
  ok(state.screen === 'shelf', 'settings -> library (loop)');
  setScreen('player'); await new Promise(r => setTimeout(r, 60));
  ok(hidden(), 'cover shown');
  await swipe(w.document.getElementById('playerCover'), 'left');
  ok(state.screen === 'player' && !hidden(), 'on the cover: swipe left -> first visual (screen stays)');
  const VZ = await import(pathToFileURL(WWW + '/js/visualizer.js').href);
  const vname = () => w.document.getElementById('visualizerName').textContent;
  const nm = i => VZ.VISUAL_NAMES[VZ.VISUALS[i]];
  ok(VZ.VISUALS.length === 10, 'ten visuals');
  ok(vname() === nm(0), 'visual 1 = ' + vname());
  await swipe(w.document.getElementById('visualizer'), 'left');
  ok(vname() === nm(1) && !hidden(), 'on the visual: swipe left -> next visual');
  for(let i = 2; i < VZ.VISUALS.length; i++) await swipe(w.document.getElementById('visualizer'), 'left');
  ok(vname() === nm(VZ.VISUALS.length - 1), 'last visual');
  await swipe(w.document.getElementById('visualizer'), 'left');
  ok(hidden() && state.screen === 'player', 'after the last visual: back to the cover (a loop)');
  await swipe(w.document.getElementById('playerCover'), 'right');
  ok(!hidden() && vname() === nm(VZ.VISUALS.length - 1), 'swipe right on the cover -> last visual');
  for(let i = 0; i < VZ.VISUALS.length; i++) await swipe(w.document.getElementById('visualizer'), 'right');
  ok(hidden(), 'swiping right through all visuals returns to the cover');
  ok(w.document.querySelectorAll('.pic-dots i').length >= 2, 'two dots (cover / visuals) show the position in the loop');
  w.document.getElementById('modalRoot').innerHTML = '<div class="modal-back"><div class="modal"><p id="mm">x</p></div></div>';
  await swipe(w.document.getElementById('mm'), 'left');
  ok(state.screen === 'player', 'an open window is never swiped away');
  w.document.getElementById('modalRoot').innerHTML = '';
}

console.log('== music says "tracks", books say "chapters"');
{
  const b = state.books.find(x => x.id === 'b1');
  b.mode = 'book'; state.current = b; state.currentIndex = 0;
  setScreen('player'); await new Promise(r => setTimeout(r, 60));
  ok(/^Глава 1 из/.test(w.document.querySelector('.chapter').textContent) && w.document.getElementById('queueTitle').textContent === 'Главы', 'book: Глава / Главы');
  w.document.getElementById('modeBtn').click(); await new Promise(r => setTimeout(r, 60));
  ok(/^Трек 1 из/.test(w.document.querySelector('.chapter').textContent), 'music: "Трек 1 из ..." in the player');
  ok(w.document.getElementById('chLabel').textContent === 'Трек' && w.document.getElementById('queueTitle').textContent === 'Треки', 'music: Трек / Треки everywhere in the player');
  ok(/Предыдущий трек/.test(w.document.getElementById('prevBtn').getAttribute('aria-label')), 'music: buttons say "трек"');
  setScreen('shelf'); await new Promise(r => setTimeout(r, 40));
  const row = w.document.querySelector('.library-book-item[data-id="b1"] .lib-meta').textContent;
  ok(/треков|трека|трек/.test(row) && !/глав/.test(row), 'library row for music: ' + row.trim());
  ok(!/Книга|Альбом/.test(w.document.querySelector('.library-book-item[data-id="b1"] .lib-thumb').textContent), 'no words on covers');
  ok(!!w.document.querySelector('.library-book-item[data-id="b1"] .kind-badge.kind-music'), 'music cover: small vinyl mark');
  ok(!!w.document.querySelector('.library-book-item:not([data-id="b1"]) .kind-badge.kind-book'), 'book cover: small book mark');
  b.mode = 'book'; setScreen('player'); await new Promise(r => setTimeout(r, 40)); setScreen('shelf');
  ok(/глав/.test(w.document.querySelector('.library-book-item[data-id="b1"] .lib-meta').textContent), 'back to a book: chapters');
}

console.log('== English: no Russian is left on any screen, the language switch works, the picture loop runs both ways');
{
  const i18n = await import(pathToFileURL(WWW + '/js/i18n.js').href);
  const { setScreen: go } = await import(pathToFileURL(WWW + '/js/router.js').href);
  const sound = await import(pathToFileURL(WWW + '/js/sound.js').href);
  const lib = await import(pathToFileURL(WWW + '/js/library.js').href);
  const scn = await import(pathToFileURL(WWW + '/js/scanner.js').href);
  const V = await import(pathToFileURL(WWW + '/js/visualizer.js').href);
  i18n.setLangSetting('en');
  ok(i18n.getLang() === 'en' && w.document.documentElement.lang === 'en', 'language switched to English');
  const userData = /Книга (один|два)|Мастер и Маргарита\. Булгаков|Автор(?! не)/g;                     // titles come from the person's files, not from the app
  const left = () => { const tt = w.document.getElementById('toast'); if(tt) tt.textContent = ''; return (w.document.body.textContent + ' ' + [...w.document.querySelectorAll('[aria-label],[placeholder]')].map(e => (e.getAttribute('aria-label')||'') + ' ' + (e.getAttribute('placeholder')||'')).join(' ')).replace(userData, '').match(/[А-Яа-яЁё]+/g); };
  for (const name of ['shelf', 'catalog', 'settings', 'player']) {
    go(name); await new Promise(r => setTimeout(r, 60));
    const l = left(); ok(!l, `screen "${name}" is English` + (l ? ': ' + l.slice(0, 6).join(', ') : ''));
  }
  for (const [label, open] of [['sound', () => sound.openCurrentSound()], ['sort', () => lib.openSort()], ['filter', () => lib.openLibraryFilter()], ['folders', () => scn.openFolderSheet()]]) {
    go('player'); try { open(); } catch (e) { ok(false, label + ' threw ' + e.message); continue; }
    await new Promise(r => setTimeout(r, 40));
    const l = left(); ok(!l, `${label} window is English` + (l ? ': ' + l.slice(0, 6).join(', ') : ''));
    w.document.querySelector('[data-close]')?.click(); w.document.getElementById('modalRoot').innerHTML = '';
  }
  go('player'); await new Promise(r => setTimeout(r, 40));
  // the picture loop: cover -> ring -> bars -> wave -> cover, and the same backwards
  while (V.picturePosition() !== 0) V.stepPicture(1);
  V.stepPicture(-1);
  ok(V.picturePosition() === V.VISUALS.length, 'swiping back from the cover goes round to the last picture');
  V.stepPicture(1);
  ok(V.picturePosition() === 0, 'and forward from the last picture goes round to the cover');
  go('player'); V.closeVisualizer?.();
  i18n.setLangSetting('ru');
  go('settings'); await new Promise(r => setTimeout(r, 40));
  ok(/Настройки/.test(w.document.body.textContent) && /Язык/.test(w.document.body.textContent), 'back to Russian');
}

console.log('== Premium: what is locked after the trial, what comes back with Premium');
{
  const Pm = await import(pathToFileURL(WWW + '/js/premium.js').href);
  const V = await import(pathToFileURL(WWW + '/js/visualizer.js').href);
  const sound = await import(pathToFileURL(WWW + '/js/sound.js').href);
  const { setScreen: go } = await import(pathToFileURL(WWW + '/js/router.js').href);
  go('player'); await new Promise(r => setTimeout(r, 60));
  while (V.picturePosition() !== 0) V.stepPicture(1);
  Pm._reset({ start: Date.now() - 40 * 86400000 });
  V.stepPicture(1);
  ok(V.picturePosition() === 0, 'free: swiping the cover opens no visualizer');
  ok(!!w.document.querySelector('#modalRoot .modal, #modalRoot .pm-perks') || /Премиум/.test(w.document.getElementById('modalRoot').textContent), 'free: the Premium sheet is shown instead');
  w.document.getElementById('modalRoot').innerHTML = '';
  V.stepPicture(1);
  ok(V.picturePosition() === 0, 'free: the second swipe only shows a note');
  const b = state.current; b.sound = { preset: 'custom', volume: 2, gain: 0, eq: [6, 6, 6, 6, 6, 6, 6, 6, 6, 6] };
  calls.length = 0; Pm.setOwned('code', 'TEST'); await new Promise(r => setTimeout(r, 20));
  const fxOn = calls.filter(c => c[0] === 'setFx').at(-1)?.[1];
  ok(fxOn && fxOn.eq[0] === 6 && fxOn.volume === 2, 'Premium: the saved EQ and the 200 % volume are used');
  calls.length = 0; Pm.clearOwned('code'); await new Promise(r => setTimeout(r, 20));
  const fxOff = calls.filter(c => c[0] === 'setFx').at(-1)?.[1];
  ok(fxOff && fxOff.eq.every(v => v === 0) && fxOff.volume === 1, 'free: the sound is untouched (EQ flat, volume 100 %), the saved settings are kept');
  ok(b.sound.eq[0] === 6 && b.sound.volume === 2, 'free: what the person set is not erased');
  Pm.setOwned('code', 'TEST');
  V.stepPicture(1);
  ok(V.picturePosition() === 1, 'Premium: the visualizer opens');
  V.stepPicture(1); V.stepPicture(1); V.stepPicture(1);
  Pm._reset({});                                      // back to a fresh trial for the rest
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL OK');
process.exit(failures ? 1 : 0);
