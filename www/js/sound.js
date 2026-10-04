/* sound.js — Web Audio API, Equalizer, Sound Enhancements */
import { state, icon, escapeHtml, $, modalRoot } from './state.js';
import { persist } from './storage.js';

export const audio = new Audio();
audio.preload = 'metadata';
audio.crossOrigin = 'anonymous';

export let audioContext = null;
export let audioSource = null;
export let analyser = null;
export let gainNode = null;
export let bassFilter = null;
export let trebleFilter = null;
export let eqFilters = [];
export const EQ_BANDS = [60,120,250,500,1000,2000,4000,8000,12000,16000];

export const SOUND_PRESETS = {
  flat:{name:'Плоский',gain:0,eq:[0,0,0,0,0,0,0,0,0,0]},
  voice:{name:'Голос',gain:0,eq:[-3,-2,-1,2,4,5,4,2,1,0]},
  bass:{name:'Бас',gain:0,eq:[6,5,4,2,0,-1,-2,-2,-1,0]},
  rock:{name:'Рок',gain:0,eq:[4,3,2,-1,-2,1,3,4,4,3]},
  classical:{name:'Классика',gain:0,eq:[3,2,1,0,-1,-1,1,2,3,3]},
  jazz:{name:'Джаз',gain:0,eq:[3,2,1,0,-1,1,3,3,2,1]},
  night:{name:'Ночь',gain:-2,eq:[-2,-1,0,1,2,1,0,-2,-3,-4]}
};

export function ensureFileSound(f){
  if(!f) return;
  f.sound = {
    preset:'flat',
    volume:Number(state.settings.volume ?? 1),
    gain:0,
    eq:[0,0,0,0,0,0,0,0,0,0],
    bass:Number(state.settings.bass)||0,
    treble:Number(state.settings.treble)||0,
    ...(f.sound||{})
  };
  if(f.sound.volume > 1) f.sound.volume = f.sound.volume / 100;
  if(!Array.isArray(f.sound.eq) || f.sound.eq.length!==10) f.sound.eq=[0,0,0,0,0,0,0,0,0,0];
}

export function applyAudioSettings(){
  const f = state.current?.files?.[state.currentIndex];
  if(f){
    ensureFileSound(f);
    applyCurrentFileSound();
    return;
  }
  audio.volume = Math.max(0, Math.min(1, Number(state.settings.volume ?? 1)));
}

export function applyCurrentFileSound(){
  const f = state.current?.files?.[state.currentIndex];
  if(!f) return;
  ensureFileSound(f);
  const s = f.sound;
  audio.volume = Math.max(0, Math.min(1, Number(s.volume ?? 1)));
  if(gainNode) gainNode.gain.value = Math.pow(10, Number(s.gain || 0) / 20);
  if(bassFilter) bassFilter.gain.value = Number(s.bass) || 0;
  if(trebleFilter) trebleFilter.gain.value = Number(s.treble) || 0;
  eqFilters.forEach((filter, i) => filter.gain.value = Number(s.eq[i]) || 0);
}

export function eqLabel(hz){ return hz>=1000 ? (hz/1000)+'k' : String(hz); }

export function openCurrentSound(){
  const f = state.current?.files?.[state.currentIndex];
  if(!f) return;
  ensureFileSound(f);
  const s = f.sound;

  const presets = Object.entries(SOUND_PRESETS).map(([id,p])=>`<button class="sound-preset ${s.preset===id?'active':''}" data-preset="${id}"><b>${escapeHtml(p.name)}</b><small>${p.eq.filter(x=>x>0).length?'объёмный':'нейтральный'}</small></button>`).join('');
  const bands = EQ_BANDS.map((hz,i)=>`<div class="eq-band"><span>${eqLabel(hz)}</span><input type="range" min="-12" max="12" step="1" value="${Number(s.eq[i])||0}" data-eq="${i}" orient="vertical"><b id="eqv${i}">${(s.eq[i]>0?'+':'')}${s.eq[i]} dB</b></div>`).join('');

  modalRoot.innerHTML=`<div class="modal-back" id="soundBack"><div class="modal sound-modal"><div class="sound-modal-head"><div><h3>Звук главы</h3><small>${escapeHtml(f.name)}</small></div><button class="icon-btn" data-close aria-label="Закрыть">${icon('close')}</button></div><div class="sound-label">Пресет</div><div class="preset-grid">${presets}</div><div class="sound-setting"><div class="sound-head"><span>Громкость файла</span><b id="fileVolValue">${Math.round(s.volume*100)}%</b></div><input class="sound-range" id="fileVol" type="range" min="0" max="100" value="${Math.round(s.volume*100)}"></div><div class="eq-panel"><div class="sound-head"><span>10-полосный эквалайзер файла</span><b>±12 dB</b></div><div class="eq-grid">${bands}</div></div><div class="modal-actions"><button class="secondary" id="soundDefault">Сбросить эквалайзер</button></div></div></div>`;

  $('soundBack').onclick = e => { if(e.target.id==='soundBack'||e.target.closest('[data-close]')) closeModal(); };
  document.querySelectorAll('[data-preset]').forEach(btn => btn.onclick = () => {
    const id = btn.dataset.preset, p = SOUND_PRESETS[id];
    s.preset = id; s.eq = [...p.eq];
    applyCurrentFileSound(); set('books', state.books); openCurrentSound();
  });
  $('fileVol').oninput = e => {
    s.preset = 'custom'; s.volume = Number(e.target.value)/100;
    $('fileVolValue').textContent = Math.round(s.volume*100)+'%';
    applyCurrentFileSound(); set('books', state.books);
  };
  document.querySelectorAll('[data-eq]').forEach(inp => inp.oninput = e => {
    const i = Number(inp.dataset.eq);
    s.preset = 'custom'; s.eq[i] = Number(e.target.value);
    const v = $('eqv'+i); if(v) v.textContent = (s.eq[i]>0?'+':'')+s.eq[i]+' dB';
    applyCurrentFileSound(); set('books', state.books);
  });
  $('soundDefault').onclick = () => {
    s.preset = 'flat'; s.eq = [0,0,0,0,0,0,0,0,0,0]; s.volume = 1;
    applyCurrentFileSound(); set('books', state.books); openCurrentSound();
  };
}

export async function ensureAudioGraph(){
  if(!audioContext){
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return;
    audioContext = new AC();
    audioSource = audioContext.createMediaElementSource(audio);
    gainNode = audioContext.createGain();
    bassFilter = audioContext.createBiquadFilter(); bassFilter.type = 'lowshelf'; bassFilter.frequency.value = 180;
    trebleFilter = audioContext.createBiquadFilter(); trebleFilter.type = 'highshelf'; trebleFilter.frequency.value = 4200;
    eqFilters = EQ_BANDS.map((hz)=>{
      const f = audioContext.createBiquadFilter();
      f.type = 'peaking'; f.frequency.value = hz; f.Q.value = 1.05; f.gain.value = 0;
      return f;
    });
    analyser = audioContext.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = .82;
    let node = audioSource;
    if(bassFilter){ node.connect(bassFilter); node = bassFilter; }
    eqFilters.forEach(f => { node.connect(f); node = f; });
    if(trebleFilter){ node.connect(trebleFilter); node = trebleFilter; }
    node.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(audioContext.destination);
    applyAudioSettings();
  }
  if(audioContext.state === 'suspended') await audioContext.resume();
}
import { closeModal } from './ui.js';
