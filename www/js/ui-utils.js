/* ui-utils.js — UI Utilities: Time formatting, DOM element templates, Toasts, Modals */
import { state, icon, escapeHtml, modalRoot } from './state.js';

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

export function showToast(msg){
  console.warn('[toast]', msg);
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

function hashStr(str=''){
  let h = 0;
  for(let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function coverInitials(title=''){
  const words = String(title).replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if(!words.length) return '♪';
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
  return letters.toUpperCase();
}

/** Nicely styled SVG placeholder (used when there is no cover file or it failed to load) */
export function coverPlaceholder(b, hidden=false){
  const title = b?.title || '';
  const hue = hashStr(title + (b?.author || '')) % 360;
  const letters = escapeHtml(coverInitials(title));
  return `<div class="cover-ph" style="--h:${hue};${hidden?'display:none':''}">` +
    `<svg viewBox="0 0 100 145" preserveAspectRatio="xMidYMid slice" aria-hidden="true">` +
    `<rect x="0" y="0" width="7" height="145" fill="rgba(0,0,0,.28)"/>` +
    `<rect x="14" y="14" width="72" height="117" rx="3" fill="none" stroke="rgba(255,255,255,.26)" stroke-width="1.2"/>` +
    `<path d="M30 40h17a5 5 0 0 1 3 1 5 5 0 0 1 3-1h17v34H53a5 5 0 0 0-3 1 5 5 0 0 0-3-1H30z" fill="none" stroke="rgba(255,255,255,.78)" stroke-width="2" stroke-linejoin="round"/>` +
    `<path d="M50 41v34" stroke="rgba(255,255,255,.78)" stroke-width="2" stroke-linecap="round"/>` +
    `<text x="50" y="108" text-anchor="middle" font-family="Georgia,serif" font-size="24" font-weight="700" fill="rgba(255,255,255,.92)">${letters}</text>` +
    `<rect x="36" y="118" width="28" height="2" rx="1" fill="rgba(255,255,255,.35)"/>` +
    `</svg></div>`;
}

export function bookCover(b, extra=''){
  const body = b.cover
    ? `<img class="cover-image ${extra}" src="${escapeHtml(b.cover)}" alt="" loading="lazy" draggable="false" ` +
      `onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='block'">` +
      coverPlaceholder(b, true)
    : coverPlaceholder(b, false);
  return `<div class="cover-frame">${body}</div>`;
}

export function iconBtn(ic, label, action){
  return `<button type="button" class="icon-btn" aria-label="${label}" data-action="${action}">${icon(ic)}</button>`;
}

export function settingToggle(k, name, desc, on){
  return `<div class="setting" data-setting-toggle="${k}"><div class="setting-icon">${icon(k==='autoscan'?'refresh':'eye')}</div><div class="setting-main"><div class="setting-name">${name}</div><div class="setting-desc">${desc}</div></div><div class="switch ${on?'on':''}"><i></i></div></div>`;
}
