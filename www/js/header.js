/* header.js — screen header with the compact "now playing" strip */
import { state, escapeHtml, $ } from './state.js';
import { bookCover, fmt } from './ui-utils.js';
import { progress, bookElapsed, bookTotal } from './progress.js';
import { t } from './i18n.js';

function coverSig(b){ return `${b.id}:${b.cover ? b.cover.length : 0}`; }

function nowPlayingTimeHtml(){
  return `<span class="np-cur">${fmt(bookElapsed(state.current))}</span> ${t('из')} <span class="np-total">${fmt(bookTotal(state.current))}</span>`;
}

/** Whole-book progress 0–100 for the header bar */
function nowPlayingPct(){
  if(!state.current) return 0;
  return progress(state.current);
}

export function header(title, subtitle, actions=''){
  // Under the title: if a book is active and we are not on the player screen — compact now-playing progress
  let subHtml = '';
  if(state.current && state.screen !== 'player'){
    const b = state.current;
    const pct = nowPlayingPct();
    subHtml = `<div class="now-playing" id="headerNowPlaying" data-action="openCurrent" data-book-id="${escapeHtml(b.id)}">
      <span class="now-playing-cover" data-cover-sig="${coverSig(b)}">${bookCover(b)}</span>
      <div class="now-playing-body">
        <div class="now-playing-title">${escapeHtml(b.title||'')}</div>
        <div class="now-playing-track" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100">
          <i style="width:${pct}%"></i>
        </div>
        <div class="now-playing-time">${nowPlayingTimeHtml()}</div>
      </div>
    </div>`;
  } else if(subtitle){
    subHtml = `<p id="headerSubtitle">${subtitle}</p>`;
  }
  return `<div class="topbar"><div class="topbar-main"><h2>${title}</h2>${subHtml}</div><div class="top-actions">${actions}</div></div>`;
}

export function updateHeaderNowPlaying(){
  requestAnimationFrame(() => {
    const el = $('headerNowPlaying');
    if(!el || !state.current) return;
    const pct = nowPlayingPct();
    const bar = el.querySelector('.now-playing-track i');
    if(bar) bar.style.width = pct + '%';
    const track = el.querySelector('.now-playing-track');
    if(track) track.setAttribute('aria-valuenow', String(Math.round(pct)));
    const tm = el.querySelector('.now-playing-time');
    if(tm) tm.innerHTML = nowPlayingTimeHtml();
    const cov = el.querySelector('.now-playing-cover');
    if(cov && cov.dataset.coverSig !== coverSig(state.current)){
      cov.dataset.coverSig = coverSig(state.current);
      cov.innerHTML = bookCover(state.current);
    }
    el.dataset.bookId = state.current.id;
    const title = el.querySelector('.now-playing-title');
    if(title && title.textContent !== (state.current.title||'')) title.textContent = state.current.title || '';
  });
}
