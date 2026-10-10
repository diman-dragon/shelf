/* discover.js — the «Для вас» screen (replaces the old playlists):
 * shelves that make themselves from the library, listening statistics, every bookmark in one place, a random pick.
 * Nothing here is stored: it is all computed from the books and their saved positions.
 */
import { state, icon, escapeHtml, plural, durationOfBook, isMusic, partName, partsCount, main } from './state.js';
import { header } from './header.js';
import { bookCover, kindBadge, iconBtn, showToast } from './ui-utils.js';
import { progress, bookElapsed } from './progress.js';
import { loadCover, hasStoredCover } from './storage.js';
import { act } from './router.js';
import { t } from './i18n.js';

const QUICK_MAX_SEC = 2 * 3600;     // "one sitting": up to 2 hours
const RAIL_MAX = 12;                // cards per shelf
const MARKS_MAX = 8;

/** 3720 s -> "1 ч 2 мин" */
function fmtSpan(sec){
  sec = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
  if(h && m) return `${h} ${t('ч')} ${m} ${t('мин')}`;
  if(h) return `${h} ${t('ч')}`;
  return `${m} ${t('мин')}`;
}

const started = b => !b.finished && progress(b) > 0.5;
const total = b => durationOfBook(b);

/** What the screen is made of. Pure: easy to test, no DOM. */
export function collect(books = state.books){
  const live = books.filter(b => b.files?.length);
  const byRecent = (a, b) => (b.lastSavedAt || 0) - (a.lastSavedAt || 0);
  const inProgress = live.filter(started).sort(byRecent);
  const fresh = live.filter(b => !b.finished && !started(b)).sort((a, b) => (b.added || 0) - (a.added || 0));
  const quick = live.filter(b => !b.finished && total(b) > 0 && total(b) <= QUICK_MAX_SEC).sort((a, b) => total(a) - total(b));
  const music = live.filter(isMusic).sort((a, b) => (b.added || 0) - (a.added || 0));
  const done = live.filter(b => b.finished).sort(byRecent);
  let listened = 0;
  for(const b of live) listened += b.finished ? total(b) : bookElapsed(b);
  const marks = [];
  for(const b of live) (b.marks || []).forEach((m, k) => marks.push({b, m, k}));
  marks.sort((x, y) => byRecent(x.b, y.b) || x.k - y.k);
  // the book to offer "Continue" for: the one that is loaded, else the most recently listened unfinished one
  const cur = state.current && live.includes(state.current) && !state.current.finished ? state.current : inProgress[0] || null;
  return {live, inProgress, fresh, quick, music, done, listened, marks, cur};
}

function card(b){
  const p = progress(b);
  const n = b.files?.length || 0;
  const sub = b.finished ? t('прослушано') : (p > 0.5 ? `${Math.round(p)}%` : `${n} ${partsCount(b, n)}`);
  return `<button type="button" class="dv-card" data-open="${escapeHtml(b.id)}">
    <div class="dv-cover" data-cover-for="${escapeHtml(b.id)}">${bookCover(b)}${kindBadge(b)}</div>
    <div class="dv-title">${escapeHtml(b.title)}</div>
    <div class="dv-sub">${escapeHtml(sub)}</div>
    <div class="dv-prog"><i style="width:${p}%"></i></div>
  </button>`;
}

function rail(title, hint, list, extra = ''){
  if(!list.length) return '';
  const shown = list.slice(0, RAIL_MAX);
  return `<div class="dv-section"><div class="dv-head"><h3>${title}</h3><span>${hint}</span></div>
    <div class="dv-rail" data-noswipe>${shown.map(card).join('')}</div>${extra}</div>`;
}

function hero(b){
  if(!b) return '';
  const i = Math.max(0, Math.min(state.current?.id === b.id ? state.currentIndex : (b.lastChapterIndex || 0), b.files.length - 1));
  const left = Math.max(0, total(b) - bookElapsed(b));
  const p = progress(b);
  return `<div class="dv-hero" data-open="${escapeHtml(b.id)}">
    <div class="dv-hero-cover" data-cover-for="${escapeHtml(b.id)}">${bookCover(b)}${kindBadge(b)}</div>
    <div class="dv-hero-body">
      <small>${t('Продолжить')}</small>
      <div class="dv-hero-title">${escapeHtml(b.title)}</div>
      <div class="dv-hero-sub">${partName(b)} ${i + 1} ${t('из')} ${b.files.length}${left > 0 ? ` · ${t('осталось')} ${fmtSpan(left)}` : ''}</div>
      <div class="dv-prog"><i style="width:${p}%"></i></div>
    </div>
    <button type="button" class="dv-play" data-play="${escapeHtml(b.id)}" aria-label="${t('Слушать дальше')}">${icon('play')}</button>
  </div>`;
}

function stats(c){
  const tiles = [
    [fmtSpan(c.listened), t('прослушано всего')],
    [`${c.done.length}<i> ${t('из')} ${c.live.length}</i>`, plural(c.done.length, 'завершена', 'завершены', 'завершено')],
    [String(c.marks.length), plural(c.marks.length, 'закладка', 'закладки', 'закладок')]
  ];
  return `<div class="dv-stats">${tiles.map(([v, l]) => `<div class="dv-stat"><b>${v}</b><span>${l}</span></div>`).join('')}</div>`;
}

function marksBlock(c){
  if(!c.marks.length) return '';
  const rows = c.marks.slice(0, MARKS_MAX).map(({b, m}) => {
    const f = b.files[m.i];
    const sec = Math.round(Number(m.t) || 0);
    const clock = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    return `<div class="dv-mark" data-mark-book="${escapeHtml(b.id)}" data-mark-i="${m.i}" data-mark-t="${sec}">
      <span class="dv-mark-ico">${icon('bookmark')}</span>
      <div><b>${escapeHtml(b.title)}</b><small>${partName(b)} ${m.i + 1}${f?.name ? ' · ' + escapeHtml(f.name) : ''} · ${clock}</small></div>
      ${icon('chevron')}
    </div>`;
  }).join('');
  const more = c.marks.length - MARKS_MAX;
  return `<div class="dv-section"><div class="dv-head"><h3>${t('Ваши закладки')}</h3><span>${t('из всех книг')}</span></div>${rows}${more > 0 ? `<div class="dv-more">${t('и ещё {n}', { n: more })}</div>` : ''}</div>`;
}

export function renderDiscover(){
  const c = collect();
  let html = `<section class="screen discover-screen">`;
  html += header(t('Для вас'), t('Подборки из вашей библиотеки'), c.live.length ? iconBtn('shuffle', t('Что послушать? Случайный выбор'), 'randomPick') : '');
  if(!c.live.length){
    html += `<div class="dv-empty">${icon('spark')}<div>${t('Здесь появятся подборки')}</div><small>${t('Добавьте книги или музыку — продолжить, новинки, короткое на один присест, статистика и закладки соберутся сами.')}</small><button type="button" class="dv-btn" data-action="openAddSheet">${t('Добавить в библиотеку')}</button></div></section>`;
    main.innerHTML = html;
    return;
  }
  html += hero(c.cur);
  html += stats(c);
  html += `<button type="button" class="dv-surprise" data-surprise>${icon('shuffle')}<span><b>${t('Удиви меня')}</b><small>${t('случайный выбор из того, что ещё не слушали')}</small></span></button>`;
  html += rail(t('В процессе'), t('вы остановились здесь'), c.inProgress.filter(b => b !== c.cur));
  html += rail(t('Ещё не слушали'), t('новые в библиотеке'), c.fresh);
  html += rail(t('На один присест'), t('до 2 часов'), c.quick);
  html += rail(t('Музыка'), t('ваши альбомы'), c.music);
  html += marksBlock(c);
  html += rail(t('Прослушано'), t('можно начать заново'), c.done);
  html += `</section>`;
  main.innerHTML = html;
  bind(c);
  fillCovers(c);
}

function bind(c){
  const root = main.querySelector('.discover-screen');
  if(!root) return;
  root.onclick = e => {
    const play = e.target.closest('[data-play]');
    if(play){ e.stopPropagation(); act('playBook', play.dataset.play); return; }
    if(e.target.closest('[data-surprise]')){ randomPick(); return; }
    const mark = e.target.closest('[data-mark-book]');
    if(mark){ act('openPlayerAt', mark.dataset.markBook, +mark.dataset.markI, +mark.dataset.markT); return; }
    const open = e.target.closest('[data-open]');
    if(open) act('openPlayer', open.dataset.open);
  };
}

/** Covers are read lazily (see storage.js): load only the ones that are on screen and put them in place */
function fillCovers(c){
  const ids = new Set();
  if(c.cur) ids.add(c.cur.id);
  [c.inProgress, c.fresh, c.quick, c.music, c.done].forEach(l => l.slice(0, RAIL_MAX).forEach(b => ids.add(b.id)));
  for(const id of ids){
    const b = state.books.find(x => x.id === id);
    if(!b || b.cover || !hasStoredCover(b)) continue;
    loadCover(b).then(cv => {
      if(!cv || state.screen !== 'discover') return;
      document.querySelectorAll('[data-cover-for]').forEach(el => { if(el.dataset.coverFor === id) el.innerHTML = bookCover(b) + kindBadge(b); });
    }).catch(() => {});
  }
}

/** "Удиви меня": prefers something never started, never the book that is already open */
export function randomPick(){
  const live = state.books.filter(b => b.files?.length);
  if(!live.length){ showToast(t('Библиотека пуста')); return; }
  const pools = [
    live.filter(b => !b.finished && !started(b) && b !== state.current),
    live.filter(b => !b.finished && b !== state.current),
    live.filter(b => b !== state.current),
    live
  ];
  const pool = pools.find(p => p.length) || live;
  const b = pool[Math.floor(Math.random() * pool.length)];
  showToast(t('Случайный выбор: «{title}»', { title: b.title }));
  act('openPlayer', b.id);
}
