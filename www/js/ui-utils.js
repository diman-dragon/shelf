/* ui-utils.js — UI Utilities: Time formatting, DOM element templates, Toasts, Modals */
import { state, icon, escapeHtml, modalRoot } from './state.js';

let toastTimer;

export function fmt(sec){
  sec = Number(sec) || 0;
  if(sec < 0) sec = 0;
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
}

export function showToast(msg){
  clearTimeout(toastTimer);
  const t = document.getElementById('toast');
  if(!t) return;
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

export function bookCover(b, extra=''){
  const title = escapeHtml(b.title || 'Без названия');
  const author = escapeHtml(b.author || '');
  const body = b.cover ?
    `<img class="cover-image ${extra}" src="${escapeHtml(b.cover)}" alt="" loading="lazy" draggable="false" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='flex'">` +
    `<div class="fallback-cover ${extra}" style="display:none"><div class="cover-title">${title}</div>${author?`<div class="cover-author">${author}</div>`:''}</div>` :
    `<div class="fallback-cover ${extra}"><div class="cover-title">${title}</div>${author?`<div class="cover-author">${author}</div>`:''}</div>`;
  return `<div class="cover-frame">${body}</div>`;
}

export function iconBtn(ic, label, action){
  return `<button type="button" class="icon-btn" aria-label="${label}" data-action="${action}">${icon(ic)}</button>`;
}

export function settingToggle(k, name, desc, on){
  return `<div class="setting" data-setting-toggle="${k}"><div class="setting-icon">${icon(k==='autoscan'?'refresh':'eye')}</div><div class="setting-main"><div class="setting-name">${name}</div><div class="setting-desc">${desc}</div></div><div class="switch ${on?'on':''}"><i></i></div></div>`;
}
