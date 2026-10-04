/* visualizer.js — Audio Visualizer Canvas Rendering and Overlay */
import { state, icon, $ } from './state.js';
import { ensureAudioGraph, analyser } from './sound.js';
import { showToast } from './ui-utils.js';

let visualizerFrame = 0;
let visualizerOpen = false;

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
