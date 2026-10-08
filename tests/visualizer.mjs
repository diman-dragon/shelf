// visualizer lifecycle: runs only while playing in foreground; sleeps when paused; stops on hidden / screen change
import { JSDOM } from 'jsdom'; import fs from 'fs'; import { pathToFileURL, fileURLToPath } from 'url';
const WWW = fileURLToPath(new URL('../www', import.meta.url));
const html = fs.readFileSync(WWW+'/index.html','utf8').replace(/<script[\s\S]*?<\/script>/g,'');
const dom = new JSDOM(html,{url:'https://localhost/',pretendToBeVisual:true}); const w=dom.window;
for(const k of ['window','document','localStorage','navigator','HTMLImageElement','HTMLElement','Event','EventTarget']) try{Object.defineProperty(globalThis,k,{value:k==='window'?w:w[k],configurable:true,writable:true})}catch{}
let rafQ=[]; globalThis.requestAnimationFrame=cb=>{rafQ.push(cb);return rafQ.length}; globalThis.cancelAnimationFrame=()=>{rafQ=[]};
let T=0; const runFrames=n=>{for(let i=0;i<n;i++){const q=rafQ;rafQ=[];T+=34;q.forEach(f=>f(T));}};
const ctxStub=new Proxy({}, {get:(t,k)=>k==='createLinearGradient'||k==='createRadialGradient'?()=>({addColorStop(){}}):()=>{}, set:()=>true});
w.HTMLCanvasElement.prototype.getContext=()=>ctxStub;
Object.defineProperty(w.HTMLElement.prototype,'clientWidth',{get:()=>400}); Object.defineProperty(w.HTMLElement.prototype,'clientHeight',{get:()=>800});
class FakeAudio extends w.EventTarget{constructor(){super();this.paused=true;this.src='x'}pause(){}async play(){}} globalThis.Audio=FakeAudio; w.Audio=FakeAudio;
w.idbKeyval={get:async()=>undefined,set:async()=>{},del:async()=>{}};
globalThis.fetch=async u=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(new URL(u),'utf8'))});
const viz=[]; const L={};
const Player={addListener:(e,f)=>{(L[e]||=[]).push(f);return{remove(){}}},getState:async()=>({saved:{}}),setVisualizer:async o=>{viz.push(o.on)},setFx:async()=>({peakBoostDb:0}),setSkipSilence:async()=>{}};
w.Capacitor={isNativePlatform:()=>true,convertFileSrc:u=>u,Plugins:{Player,ShelfFiles:{addListener:()=>({remove(){}})},App:{addListener(){}}}}; globalThis.Capacitor=w.Capacitor;
let fail=0; const ok=(c,m)=>{if(!c)fail++;console.log(c?'  ok:':'  FAIL:',m)};
const {state}=await import(pathToFileURL(WWW+'/js/state.js').href);
const sound=await import(pathToFileURL(WWW+'/js/sound.js').href);
const V=await import(pathToFileURL(WWW+'/js/visualizer.js').href);
// minimal DOM for the overlay
w.document.body.insertAdjacentHTML('beforeend','<div id="visualizer" class="hidden"><canvas id="visualizerCanvas"></canvas></div>');
sound.audio.fft=new Uint8Array(128);
Object.assign(sound.audio,{}); 
state.playing=true;
V.openVisualizer(); await new Promise(r=>setTimeout(r,20));
ok(viz.includes(true),'native FFT turned on when opened');
runFrames(5); ok(rafQ.length===1,'loop running while playing');
// background
viz.length=0; Object.defineProperty(w.document,'hidden',{value:true,configurable:true}); w.document.dispatchEvent(new w.Event('visibilitychange'));
await new Promise(r=>setTimeout(r,20)); ok(viz.at(-1)===false && rafQ.length===0,'app in background: loop + native FFT stopped');
Object.defineProperty(w.document,'hidden',{value:false,configurable:true}); w.document.dispatchEvent(new w.Event('visibilitychange'));
await new Promise(r=>setTimeout(r,20)); runFrames(2); ok(viz.at(-1)===true && rafQ.length===1,'back in foreground: resumed');
// pause -> sleeps
state.playing=false; viz.length=0; runFrames(200);
ok(rafQ.length===0 && viz.at(-1)===false,'paused + settled: loop asleep, native FFT off');
// play -> wakes
state.playing=true; viz.length=0; sound.audio.dispatchEvent(new w.Event('play')); await new Promise(r=>setTimeout(r,20)); runFrames(2);
ok(viz.at(-1)===true && rafQ.length===1,'play wakes it up again');
// leaving the screen (canvas removed) -> stops by itself
w.document.getElementById('visualizerCanvas').remove(); viz.length=0; runFrames(3);
ok(rafQ.length===0 && viz.at(-1)===false,'canvas gone (other screen): loop and native FFT stopped');
console.log(fail?`${fail} FAILURE(S)`:'VIZ ALL OK'); process.exit(fail?1:0);
