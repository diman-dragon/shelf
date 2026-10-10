/* ui-utils.js — UI Utilities: Time formatting, DOM element templates, Toasts, Modals */
import { icon, escapeHtml, modalRoot, isMusic } from './state.js';

let toastTimer;

export function fmt(sec){
  sec = Number(sec) || 0;
  if(sec < 0) sec = 0;
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
}

/** Last-resort banner: used when #toast does not exist (error before/while the DOM is mounted) so a message is never lost */
function showFallbackBanner(msg){
  try {
    let el = document.getElementById('fatalBanner');
    if(!el){
      el = document.createElement('div');
      el.id = 'fatalBanner';
      el.setAttribute('role', 'alert');
      el.style.cssText = 'position:fixed;left:8px;right:8px;top:calc(8px + env(safe-area-inset-top,0px));z-index:9999;' +
        'padding:10px 14px;border-radius:12px;background:#7a1f18;color:#fff;font:13px/1.35 system-ui,sans-serif;' +
        'box-shadow:0 6px 24px rgba(0,0,0,.45);word-break:break-word';
      el.onclick = () => el.remove();
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = String(msg);
    clearTimeout(showFallbackBanner.t);
    showFallbackBanner.t = setTimeout(() => el.remove(), 8000);
  } catch {}
}

/** Light icons on the dark app, dark icons on the light one. Native only (Capacitor 8 SystemBars); a no-op in the browser. */
export function applySystemBars(theme){
  try {
    window.Capacitor?.Plugins?.SystemBars?.setStyle?.({style: theme === 'light' ? 'LIGHT' : 'DARK'})?.catch?.(() => {});
  } catch {}
}

export function showToast(msg){
  clearTimeout(toastTimer);
  const t = document.getElementById('toast');
  if(!t){ showFallbackBanner(msg); return; }
  t.textContent = msg;
  t.classList.add('show');
  toastTimer = setTimeout(()=>t.classList.remove('show'), 2300);
}

export function openModal(body){
  if(!modalRoot) return;
  modalRoot.innerHTML = `<div class="modal-back" id="modalBack"><div class="modal">${body}</div></div>`;
  const back = document.getElementById('modalBack');
  if(back){
    back.addEventListener('click', e => {
      if(e.target.id === 'modalBack' || e.target.closest('[data-close]')) closeModal();
    });
  }
}

export function closeModal(){
  if(modalRoot) modalRoot.innerHTML = '';
}

function bookPlaceholder(hidden=false){
  return `<div class="cover-ph" style="${hidden?'display:none':''}">` +
    `<svg viewBox="0 0 100 145" preserveAspectRatio="xMidYMid slice" aria-hidden="true">` +
    `<defs>` +
    `<linearGradient id="bookGrad" x1="0%" y1="0%" x2="100%" y2="100%">` +
    `<stop offset="0%" stop-color="#2c2438"/>` +
    `<stop offset="100%" stop-color="#14111c"/>` +
    `</linearGradient>` +
    `<linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">` +
    `<stop offset="0%" stop-color="#f5cd88"/>` +
    `<stop offset="100%" stop-color="#c88a38"/>` +
    `</linearGradient>` +
    `</defs>` +
    `<rect width="100" height="145" fill="url(#bookGrad)"/>` +
    `<rect x="12" y="12" width="76" height="121" rx="4" fill="none" stroke="rgba(245,205,136,0.22)" stroke-width="1.2"/>` +
    `<path d="M30 48c7-4 15-6 20-6s13 2 20 6v49c-7-4-15-6-20-6s-13 2-20 6V48z" fill="rgba(255,255,255,0.06)" stroke="url(#goldGrad)" stroke-width="2" stroke-linejoin="round"/>` +
    `<path d="M50 42v51" stroke="url(#goldGrad)" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M36 58h8M36 65h8M36 72h6" stroke="rgba(255,255,255,0.3)" stroke-width="1.5" stroke-linecap="round"/>` +
    `<path d="M56 58h8M56 65h8M56 72h6" stroke="rgba(255,255,255,0.3)" stroke-width="1.5" stroke-linecap="round"/>` +
    `</svg></div>`;
}

function albumPlaceholder(hidden=false){
  return `<div class="cover-ph" style="${hidden?'display:none':''}">` +
    `<svg viewBox="0 0 100 145" preserveAspectRatio="xMidYMid slice" aria-hidden="true">` +
    `<defs>` +
    `<linearGradient id="albumGrad" x1="0%" y1="0%" x2="100%" y2="100%">` +
    `<stop offset="0%" stop-color="#1e293b"/>` +
    `<stop offset="100%" stop-color="#0f172a"/>` +
    `</linearGradient>` +
    `<linearGradient id="vinylGrad" x1="0%" y1="0%" x2="100%" y2="100%">` +
    `<stop offset="0%" stop-color="#38bdf8"/>` +
    `<stop offset="100%" stop-color="#0284c7"/>` +
    `</linearGradient>` +
    `</defs>` +
    `<rect width="100" height="145" fill="url(#albumGrad)"/>` +
    `<rect x="12" y="12" width="76" height="121" rx="4" fill="none" stroke="rgba(56,189,248,0.22)" stroke-width="1.2"/>` +
    `<circle cx="50" cy="72" r="28" fill="#090d16" stroke="rgba(56,189,248,0.3)" stroke-width="1.5"/>` +
    `<circle cx="50" cy="72" r="21" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>` +
    `<circle cx="50" cy="72" r="14" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>` +
    `<circle cx="50" cy="72" r="8" fill="url(#vinylGrad)"/>` +
    `<circle cx="50" cy="72" r="3" fill="#0f172a"/>` +
    `</svg></div>`;
}

/** Nicely styled SVG placeholder (used when there is no cover file or it failed to load) */
function coverPlaceholder(b, hidden=false){
  return isMusic(b) ? albumPlaceholder(hidden) : bookPlaceholder(hidden);
}

export function bookCover(b, extra=''){
  // no inline onerror: the CSP forbids inline handlers (see the capture listener below)
  const body = b.cover
    ? `<img class="cover-image ${extra}" src="${escapeHtml(b.cover)}" alt="" loading="lazy" draggable="false">` +
      coverPlaceholder(b, true)
    : coverPlaceholder(b, false);
  return `<div class="cover-frame">${body}</div>`;
}

/** A tiny corner mark on a cover: a book or a vinyl record. Icon only — no words on covers. */
export function kindBadge(b){
  const music = isMusic(b);
  return `<span class="kind-badge ${music ? 'kind-music' : 'kind-book'}" aria-label="${music ? 'Музыка' : 'Книга'}">${icon(music ? 'vinyl' : 'book', 'icon kind-ico')}</span>`;
}

// <img> "error" events do not bubble, but they can be caught in the capture phase: broken cover -> show the placeholder
if(typeof document !== 'undefined'){
  document.addEventListener('error', e => {
    const img = e.target;
    if(!(img instanceof HTMLImageElement) || !img.classList.contains('cover-image')) return;
    img.style.display = 'none';
    if(img.nextElementSibling) img.nextElementSibling.style.display = 'block';
  }, true);
}

export function iconBtn(ic, label, action){
  return `<button type="button" class="icon-btn" aria-label="${label}" data-action="${action}">${icon(ic)}</button>`;
}

export function settingToggle(k, name, desc, on, ic='refresh'){
  return `<div class="setting" data-setting-toggle="${k}"><div class="setting-icon">${icon(ic)}</div><div class="setting-main"><div class="setting-name">${name}</div><div class="setting-desc">${desc}</div></div><div class="switch ${on?'on':''}"><i></i></div></div>`;
}
