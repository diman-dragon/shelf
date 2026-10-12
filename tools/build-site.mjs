#!/usr/bin/env node
/* build-site.mjs — builds the static GitHub Pages site into ./site from store/*.md (single source of truth for the legal texts).
 * Usage: node tools/build-site.mjs [--strict]     --strict fails while store/site.json still holds placeholders (used by the Pages workflow). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'site');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const cfg = JSON.parse(read('store/site.json'));
const strict = process.argv.includes('--strict');
const placeholder = /\[[^\]]*(e-mail|дата|date)[^\]]*\]/i;
if(strict && Object.values(cfg).some(v => placeholder.test(v))){
  console.error('store/site.json still has placeholders (email / date). Fill them in first.'); process.exit(1);
}
const subst = s => s
  .replace(/\[ваш e-mail для связи\]|\[your contact e-mail\]/g, cfg.email)
  .replace(/\[дата публикации\]|\[publication date\]/g, cfg.date);

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function inline(s){
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/(https?:\/\/[^\s)<]+)/g, '<a href="$1" rel="noopener">$1</a>');
  s = s.replace(/([\w.+-]+@[\w-]+\.[\w.-]+)/g, '<a href="mailto:$1">$1</a>');
  return s;
}
function md(src){                                   // headings, lists, tables, paragraphs: all the policies use
  const lines = src.split('\n'); let html = '', list = false, para = [], table = [];
  const flushP = () => { if(para.length){ html += `<p>${inline(para.join(' '))}</p>`; para = []; } };
  const flushL = () => { if(list){ html += '</ul>'; list = false; } };
  const flushT = () => {
    if(!table.length) return;
    const rows = table.filter(r => !/^\|[\s|:-]+\|$/.test(r)).map(r => r.slice(1, -1).split('|').map(c => c.trim()));
    html += '<div class="tbl"><table><thead><tr>' + rows[0].map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
      rows.slice(1).map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>';
    table = [];
  };
  for(const raw of lines){
    const l = raw.trimEnd();
    if(/^\|.*\|$/.test(l)){ flushP(); flushL(); table.push(l); continue; } flushT();
    if(!l.trim()){ flushP(); flushL(); continue; }
    let m;
    if((m = l.match(/^(#{1,3}) (.*)/))){ flushP(); flushL(); const n = Math.min(m[1].length + 1, 4); html += `<h${n}>${inline(m[2])}</h${n}>`; }
    else if((m = l.match(/^[-•] (.*)/))){ flushP(); if(!list){ html += '<ul>'; list = true; } html += `<li>${inline(m[1])}</li>`; }
    else para.push(l.trim());
  }
  flushP(); flushL(); flushT(); return html;
}
/** "RU text --- EN text" → {ru, en} bodies without the leading H1 */
function split(src){
  const [ru, en] = subst(src).split(/\n---\n/);
  const strip = s => (s || '').replace(/^# .*\n+/, '');
  return { ru: md(strip(ru)), en: md(strip(en)) };
}

const T = {
  ru: { home: 'Главная', privacy: 'Конфиденциальность', terms: 'Условия', support: 'Поддержка', licenses: 'Лицензии', rights: 'Все права защищены.', apps: 'Приложения' },
  en: { home: 'Home', privacy: 'Privacy', terms: 'Terms', support: 'Support', licenses: 'Licences', rights: 'All rights reserved.', apps: 'Apps' }
};
const bi = (ru, en) => `<div lang="ru" data-l="ru">${ru}</div><div lang="en" data-l="en">${en}</div>`;
const bis = (ru, en) => `<span data-l="ru">${ru}</span><span data-l="en">${en}</span>`;

const CSS = `
@font-face{font-family:Literata;font-style:normal;font-weight:200 900;font-display:swap;src:url(fonts/literata-cyrillic-wght-normal.woff2) format("woff2");unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
@font-face{font-family:Literata;font-style:normal;font-weight:200 900;font-display:swap;src:url(fonts/literata-latin-wght-normal.woff2) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:Literata;font-style:italic;font-weight:200 900;font-display:swap;src:url(fonts/literata-cyrillic-wght-italic.woff2) format("woff2");unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
@font-face{font-family:Literata;font-style:italic;font-weight:200 900;font-display:swap;src:url(fonts/literata-latin-wght-italic.woff2) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"Fira Extra";font-weight:600;font-display:swap;src:url(fonts/fira-sans-extra-condensed-cyrillic-600-normal.woff2) format("woff2");unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
@font-face{font-family:"Fira Extra";font-weight:600;font-display:swap;src:url(fonts/fira-sans-extra-condensed-latin-600-normal.woff2) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
:root{--wall:#d5dbcf;--ink:#16211f;--mute:#4b5955;--rule:rgba(22,33,31,.24);--plank:#46301f;--plank2:#2f1f13;--paper:#eef0e8;--on-ink:#e9eee4;--gold:#e8b66d;--serif:Literata,Georgia,"Times New Roman",serif;--spine:"Fira Extra","Arial Narrow",sans-serif}
:root[data-theme=dark]{--wall:#111614;--ink:#e6eae2;--mute:#97a39d;--rule:rgba(230,234,226,.22);--plank:#2d2118;--plank2:#1a130d;--paper:#1a211f;--on-ink:#111614}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--wall);color:var(--ink);font:400 17px/1.7 var(--serif);font-optical-sizing:auto;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
body[data-lang=ru] [data-l=en],body[data-lang=en] [data-l=ru]{display:none!important}
a{color:inherit;text-decoration-thickness:1px;text-underline-offset:.22em}a:hover{text-decoration-thickness:2px}
:focus-visible{outline:2px solid var(--ink);outline-offset:3px;border-radius:2px}
.wrap{max-width:1060px;margin:0 auto;padding:0 24px}
header.top .wrap{display:flex;align-items:baseline;gap:22px;padding-top:20px;padding-bottom:6px;flex-wrap:wrap}
.brand{font:600 21px/1 var(--serif);text-decoration:none;display:flex;align-items:center;gap:10px;margin-right:auto}
.brand img{width:28px;height:28px;border-radius:7px;align-self:center}
nav{display:flex;gap:20px;flex-wrap:wrap;font-size:15px}
nav a{text-decoration:none;color:var(--mute)}nav a:hover,nav a[aria-current]{color:var(--ink);text-decoration:underline}
.ctls{display:flex;gap:14px;font-size:15px}
.ctl{background:none;border:0;border-bottom:1px solid var(--rule);color:var(--mute);font:inherit;padding:0;cursor:pointer}.ctl:hover{color:var(--ink);border-color:var(--ink)}
@media(max-width:700px){nav{order:3;width:100%}}

/* ---- the shelf ---- */
.intro{padding:46px 0 0}
.intro h1{font:600 clamp(38px,6.4vw,78px)/1.04 var(--serif);letter-spacing:-.022em;margin:0 0 22px;max-width:15ch;font-variation-settings:"opsz" 72}
.intro p.lead{font-size:clamp(18px,2vw,21px);max-width:34em;margin:0 0 26px;color:var(--mute)}
.get{display:flex;gap:22px;align-items:center;flex-wrap:wrap;margin-bottom:6px}
.btn{display:inline-block;background:var(--ink);color:var(--on-ink);padding:13px 24px;border-radius:3px;font:600 17px/1.2 var(--serif);text-decoration:none}
.btn.off{opacity:.88}
.get small{color:var(--mute);font-size:15px}
.shelf{position:relative;margin:48px 0 0;padding-top:20px}
.shelf .books{display:flex;align-items:flex-end;gap:3px;height:300px;padding:0 max(24px,calc((100vw - 1060px)/2 + 24px));overflow:hidden}
.plank{height:22px;background:linear-gradient(var(--plank),var(--plank2));box-shadow:0 14px 22px -10px rgba(0,0,0,.45)}
.spine{flex:none;border:0;padding:0;margin:0;cursor:pointer;color:#f0e9d8;display:flex;align-items:center;justify-content:center;writing-mode:vertical-rl;font:600 15px/1 var(--spine);letter-spacing:.03em;position:relative;transition:transform .18s ease-out;background:var(--c);box-shadow:inset -3px 0 0 rgba(0,0,0,.18),inset 3px 0 0 rgba(255,255,255,.08);border-radius:2px 2px 0 0}
.spine::before,.spine::after{content:"";position:absolute;left:0;right:0;height:5px;border-block:1px solid rgba(240,233,216,.45)}
.spine::before{top:14px}.spine::after{bottom:14px}
.spine span{padding:26px 0;max-height:100%;overflow:hidden;white-space:nowrap}
.spine:hover,.spine.out{transform:translateY(-14px)}
.spine.lean{transform-origin:bottom left;transform:rotate(-7deg)}
.spine.lean:hover{transform:rotate(-7deg) translateY(-8px)}
.note{margin:14px 0 0;min-height:3.4em;color:var(--mute);font-size:16px}
.note b{color:var(--ink);font-weight:600}

/* the album and the book that are playing: the same animation as the cover in the app */
.stage{flex:none;display:flex;align-items:flex-end;gap:34px;margin:0 16px;cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent}
.album{position:relative;width:min(336px,60vw);height:min(240px,43vw);flex:none}
.sleeve{position:absolute;left:0;top:0;width:71.43%;height:100%;z-index:2;background:#1f4563;border-radius:3px;box-shadow:0 6px 16px rgba(0,0,0,.4);display:grid;place-items:center;color:#f0e9d8;font:italic 600 clamp(17px,2.6vw,25px)/1.12 var(--serif);text-align:center;padding:14px}
.sleeve::before{content:"";position:absolute;inset:12px;border:1px solid rgba(240,233,216,.5)}
.sleeve span{position:relative}
.vinyl{position:absolute;right:0;top:4%;height:92%;aspect-ratio:1;z-index:1;transform:translateX(-30%);transition:transform 1.4s cubic-bezier(.3,.7,.2,1)}
.playing .vinyl{transform:none}
.record{width:100%;height:100%;border-radius:50%;background:radial-gradient(circle,transparent 0 30%,rgba(255,255,255,.06) 30.5%,transparent 31.5%,transparent 44%,rgba(255,255,255,.06) 44.5%,transparent 45.5%,transparent 58%,rgba(255,255,255,.06) 58.5%,transparent 59.5%),conic-gradient(from 20deg,#141210,#2e2a25 12%,#141210 25%,#141210 50%,#2e2a25 62%,#141210 75%);box-shadow:0 6px 18px rgba(0,0,0,.45);animation:spin 3.4s linear infinite;animation-play-state:paused;position:relative}
.record i{position:absolute;inset:35%;border-radius:50%;background:radial-gradient(circle,#0b0a09 0 7%,var(--gold) 8%)}
.playing .record{animation-play-state:running}
@keyframes spin{to{transform:rotate(360deg)}}
.arm{position:absolute;inset:0;width:100%;height:100%;z-index:3;pointer-events:none;overflow:visible}
.arm g{transform-box:view-box;transform-origin:128px 10px;transform:rotate(50deg);transition:transform 1.3s cubic-bezier(.4,0,.2,1) .5s}
.playing .arm g{transform:none}
.arm circle{fill:#4a4237;stroke:var(--gold)}.arm path{stroke:#b9b2a5;stroke-width:2.4;stroke-linecap:round;fill:none}.arm rect{fill:var(--gold)}
.tome{position:relative;width:min(122px,22vw);height:min(176px,32vw);flex:none}
.tome .cover{position:absolute;inset:0;z-index:2;background:#7a2230;border-radius:3px 6px 6px 3px;box-shadow:0 6px 16px rgba(0,0,0,.4),inset 5px 0 0 rgba(0,0,0,.2);color:#f0e9d8;display:grid;align-content:center;justify-items:center;gap:10px;padding:12px;text-align:center;font:600 clamp(16px,2vw,20px)/1.08 var(--serif)}
.tome .cover::before{content:"";position:absolute;inset:12px 12px 12px 18px;border:1px solid rgba(240,233,216,.5)}
.tome .cover small{font:italic 400 12px/1.2 var(--serif);position:relative;opacity:.9}.tome .cover b{position:relative;font-weight:600}
.tome{margin-right:min(88px,15vw)}
.openbook{position:absolute;left:45%;top:17%;height:66%;aspect-ratio:1.3;z-index:1;perspective:900px;transform:translateX(-34%);transition:transform 1.4s cubic-bezier(.3,.7,.2,1)}
.playing .openbook{transform:none}
.openbook::before{content:"";position:absolute;inset:-3px;border-radius:6px;background:#5a2630;box-shadow:0 6px 16px rgba(0,0,0,.4)}
.openbook{container-type:size}
.openbook .pg,.openbook .lf{position:absolute;top:0;width:50%;height:100%;overflow:hidden;background:#f2ead6;color:#3a2f20;font:3.5cqw/1.38 var(--serif);text-align:justify;hyphens:auto;padding:9% 8% 12%;box-sizing:border-box}
.openbook p{margin:0}.openbook h6{margin:0 0 6%;font:italic 600 4.6cqw/1.1 var(--serif);text-align:center}
.openbook .pg-l p::first-letter{float:left;font:700 11cqw/.85 var(--serif);padding:1% 2% 0 0;color:#6a2a2a}
.openbook .pg::after,.openbook .lf::after{content:attr(data-n);position:absolute;left:0;right:0;bottom:4%;text-align:center;font-size:3cqw;opacity:.6}
.openbook .pg-l{left:0;border-radius:3px 0 0 3px;box-shadow:inset -14px 0 14px -10px rgba(0,0,0,.35)}
.openbook .pg-r{right:0;border-radius:0 3px 3px 0;box-shadow:inset 14px 0 14px -10px rgba(0,0,0,.35)}
.openbook .lf{right:0;border-radius:0 3px 3px 0;transform-origin:0 50%;backface-visibility:hidden;box-shadow:inset 14px 0 14px -10px rgba(0,0,0,.3);animation:turn 9s ease-in-out infinite;animation-play-state:paused}
.playing .openbook .lf{animation-play-state:running}
.openbook .lf:nth-child(4){animation-delay:-3s}.openbook .lf:nth-child(5){animation-delay:-6s}
@keyframes turn{0%,52%{transform:rotateY(0)}72%,100%{transform:rotateY(-178deg)}}
@media(max-width:700px){.shelf .books{height:250px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}.shelf .books::-webkit-scrollbar{display:none}.spine.hide-s{display:none}.stage{gap:22px;margin:0 8px}}
@media(prefers-reduced-motion:reduce){.record,.openbook .lf{animation:none!important}.vinyl,.openbook,.arm g,.spine{transition:none!important}}

/* ---- the text ---- */
section{padding:72px 0 0}
h2{font:600 clamp(27px,3.6vw,40px)/1.12 var(--serif);letter-spacing:-.015em;margin:0 0 10px;max-width:22ch}
.sec-sub{color:var(--mute);margin:0 0 30px;max-width:38em}
.cards{display:grid;gap:18px;grid-template-columns:repeat(auto-fill,minmax(290px,1fr))}
.card{position:relative;background:var(--paper);border:1px solid var(--rule);border-top:5px solid var(--c,var(--ink));border-radius:4px;padding:22px 22px 24px}
.card .ico{width:40px;height:40px;border-radius:3px;background:var(--c,var(--ink));color:#f0e9d8;display:grid;place-items:center;margin-bottom:14px;box-shadow:inset -3px 0 0 rgba(0,0,0,.18)}
.card .ico svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.card h3{margin:0 0 6px;font:600 21px/1.2 var(--serif)}.card p{margin:0;color:var(--mute);font-size:16px}
.tag{display:inline-block;font:600 15px/1 var(--spine);letter-spacing:.02em;color:#f0e9d8;background:var(--c,var(--ink));padding:5px 10px 4px;border-radius:2px;margin-bottom:12px}
.modes{display:grid;gap:18px;grid-template-columns:1fr 1fr}@media(max-width:700px){.modes{grid-template-columns:1fr}}
.shots{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;align-items:start}
.shots figure{margin:0}.shots figure:nth-child(2){margin-top:56px}.shots figure:nth-child(3){margin-top:18px}
.shots img{display:block;width:100%;height:auto;border-radius:14px;outline:1px solid var(--rule);outline-offset:-1px}
.shots figcaption{margin-top:12px;font-size:15px;color:var(--mute);max-width:24em}
@media(max-width:700px){.shots{grid-template-columns:1fr;max-width:320px}.shots figure:nth-child(n){margin-top:0}}
.plans{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));align-items:stretch}
.plan .price{font:600 38px/1.1 var(--spine);letter-spacing:.01em;margin:2px 0 10px}
.plan.hl{background:var(--ink);color:var(--on-ink);border-color:var(--ink)}.plan.hl p{color:inherit;opacity:.82}
.plan ul{margin:0;padding-left:20px;color:var(--mute);font-size:16px}.plan.hl ul{color:inherit;opacity:.85}
.fine{color:var(--mute);font-size:16px;max-width:40em;margin:20px 0 0}
.band{background:var(--paper);border:1px solid var(--rule);border-left:6px solid var(--ink);border-radius:4px;padding:30px 32px;display:grid;gap:18px 40px;grid-template-columns:1.4fr 1fr;align-items:center}
@media(max-width:760px){.band{grid-template-columns:1fr;padding:24px}}
.band h2{margin-bottom:10px}.band p{margin:0;color:var(--mute);max-width:36em}
.band .btn{white-space:nowrap}
.family .books{height:230px;padding:0;margin-top:30px;display:flex;align-items:flex-end;gap:3px}
.family .shelf{margin:0}.family .plank{margin:0 -24px}
.spine.am{--c:#1f4563}
.spine.soon{opacity:.62}
footer{margin-top:88px;border-top:1px solid var(--rule);padding:26px 0 40px;color:var(--mute);font-size:15px}
footer .wrap{display:flex;gap:10px 28px;flex-wrap:wrap}footer .wrap>span:first-child{margin-right:auto}
article{padding:44px 0 70px}article .wrap{max-width:780px}
article h1{font:600 clamp(30px,4.4vw,46px)/1.1 var(--serif);letter-spacing:-.02em;margin:0 0 10px}
article h2{font-size:23px;margin:34px 0 8px;max-width:none}article h3{font-size:18px;margin:22px 0 6px}article ul{padding-left:22px}
article code{background:var(--paper);padding:1px 6px;border-radius:4px;font-size:.88em}
.tbl{overflow-x:auto;max-width:100%}table{border-collapse:collapse;width:100%;font-size:15px}
article th,article td{border-bottom:1px solid var(--rule);padding:8px 10px;text-align:left;vertical-align:top}
pre{background:var(--paper);border-radius:6px;padding:14px;overflow:auto;font-size:12px;line-height:1.5;white-space:pre-wrap}
details{border-top:1px solid var(--rule);padding:14px 0}details:last-of-type{border-bottom:1px solid var(--rule)}
summary{cursor:pointer;font-weight:600}details p{margin:10px 0 0;color:var(--mute);max-width:40em}
`;
const JS = `(function(){var d=document.body,r=document.documentElement,l,th;
try{l=localStorage.getItem('lang');th=localStorage.getItem('theme')}catch(e){}
if(l!=='ru'&&l!=='en')l=/^(ru|uk|be|kk)/i.test(navigator.language||'')?'ru':'en';
if(th!=='dark'&&th!=='light')th=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
function paint(){d.dataset.lang=l;r.lang=l;r.dataset.theme=th;
 var b=document.getElementById('lb');if(b)b.textContent=l==='ru'?'English':'Русский';
 var m=document.getElementById('tb');if(m)m.textContent=th==='dark'?(l==='ru'?'Светлая тема':'Light theme'):(l==='ru'?'Тёмная тема':'Dark theme');
 var t=document.querySelector('title');if(t&&t.dataset[l])t.textContent=t.dataset[l];
 document.querySelectorAll('img[data-shot]').forEach(function(i){i.src='shots/'+i.dataset.shot+'-'+th+(l==='en'?'-en':'')+'.webp'})}
paint();
document.getElementById('lb').onclick=function(){l=l==='ru'?'en':'ru';try{localStorage.setItem('lang',l)}catch(e){}paint()};
document.getElementById('tb').onclick=function(){th=th==='dark'?'light':'dark';try{localStorage.setItem('theme',th)}catch(e){}paint()};
var sh=document.querySelector('.shelf'),st=document.getElementById('stage');
if(sh){var note=document.getElementById('note');
 sh.addEventListener('click',function(e){var s=e.target.closest('.spine');if(!s)return;
  sh.querySelectorAll('.spine.out').forEach(function(x){x.classList.remove('out')});s.classList.add('out');
  if(note&&s.dataset.ru){note.querySelector('[data-l=ru]').innerHTML=s.dataset.ru;note.querySelector('[data-l=en]').innerHTML=s.dataset.en}});
 if(st){var go=function(){st.classList.toggle('playing')};
  st.addEventListener('click',go);
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches)setTimeout(function(){st.classList.add('playing')},500);else st.classList.add('playing')}}})();`;

function page(file, titles, body, { hero = '' } = {}){
  const nav = ['home', 'privacy', 'terms', 'support', 'licenses'].map(k => {
    const href = k === 'home' ? 'index.html' : k + '.html';
    return `<a href="${href}"${href === file ? ' aria-current="page"' : ''}>${bis(T.ru[k], T.en[k])}</a>`;
  }).join('');
  const year = new Date().getFullYear();
  return `<!doctype html><html lang="ru" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title data-ru="${esc(titles.ru)}" data-en="${esc(titles.en)}">${esc(titles.ru)}</title>
<meta name="description" content="${esc(titles.desc || '')}"><meta name="theme-color" content="#d5dbcf">
<meta property="og:title" content="${esc(titles.en)}"><meta property="og:description" content="${esc(titles.desc || '')}"><meta property="og:image" content="feature.png">
<link rel="icon" href="icon.png"><link rel="preload" href="fonts/literata-cyrillic-wght-normal.woff2" as="font" type="font/woff2" crossorigin><style>${CSS}</style></head><body data-lang="ru">
<header class="top"><div class="wrap"><a class="brand" href="index.html"><img src="icon.png" alt="">AudioShelf</a><nav>${nav}</nav>
<div class="ctls"><button class="ctl" id="tb" type="button">Тёмная тема</button><button class="ctl" id="lb" type="button">English</button></div></div></header>
${hero}${body}
<footer><div class="wrap"><span>© ${year} DataLaw. ${bis(T.ru.rights, T.en.rights)}</span><a href="mailto:${esc(cfg.email)}">${esc(cfg.email)}</a><a href="${esc(cfg.repoUrl)}" rel="noopener">GitHub</a></div></footer>
<script>${JS}</script></body></html>`;
}

fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(root, 'store/graphics/icon-512.png'), path.join(out, 'icon.png'));
fs.copyFileSync(path.join(root, 'store/graphics/feature-graphic-1024x500.png'), path.join(out, 'feature.png'));
fs.cpSync(path.join(root, 'store/graphics/shots'), path.join(out, 'shots'), { recursive: true });
fs.cpSync(path.join(root, 'store/graphics/fonts'), path.join(out, 'fonts'), { recursive: true });
fs.writeFileSync(path.join(out, '.nojekyll'), '');

// ---- landing ----
// public-domain books that really exist in the LibriVox catalog: the spines are the catalog, drawn
const SPINES = [
  ['Идиот', 'Ф. Достоевский', 'Idiot', 'F. Dostoyevsky', '#7a2230', 250], ['Война и мир', 'Л. Толстой', 'War and Peace', 'L. Tolstoy', '#1f4563', 285],
  ['Анна Каренина', 'Л. Толстой', 'Anna Karenina', 'L. Tolstoy', '#5c6b2f', 240], ['Мёртвые души', 'Н. Гоголь', 'Dead Souls', 'N. Gogol', '#c99a2e', 215],
  ['Отцы и дети', 'И. Тургенев', 'Fathers and Sons', 'I. Turgenev', '#4c2b57', 260], ['Дубровский', 'А. Пушкин', 'Dubrovsky', 'A. Pushkin', '#3b4750', 200],
  null,
  ['Pride and Prejudice', 'Jane Austen', 'Pride and Prejudice', 'Jane Austen', '#1f4563', 255], ['Dracula', 'Bram Stoker', 'Dracula', 'Bram Stoker', '#7a2230', 270],
  ['Frankenstein', 'Mary Shelley', 'Frankenstein', 'Mary Shelley', '#3b4750', 230], ['Moby Dick', 'Herman Melville', 'Moby Dick', 'Herman Melville', '#5c6b2f', 280],
  ['The Time Machine', 'H. G. Wells', 'The Time Machine', 'H. G. Wells', '#c99a2e', 205], ['Wuthering Heights', 'Emily Brontë', 'Wuthering Heights', 'Emily Brontë', '#4c2b57', 245]
];
const spine = (s, i) => {
  const w = 34 + (i * 7) % 15;
  const note = (a, b) => `<b>${esc(a)}</b>, ${esc(b)}. `;
  const ru = note(s[0], s[1]) + 'Свободная запись LibriVox, общественное достояние.';
  const en = note(s[2], s[3]) + 'Free LibriVox recording, public domain.';
  return `<button type="button" class="spine${i % 5 === 3 ? ' hide-s' : ''}" style="--c:${s[4]};height:${s[5]}px;width:${w}px" data-ru="${esc(ru)}" data-en="${esc(en)}" aria-label="${esc(s[0])}"><span>${esc(s[0])}</span></button>`;
};
const half = (list) => list.map(spine).join('');
const left = SPINES.slice(0, 6), right = SPINES.slice(7);
const P1 = ['Мой дядя самых честных правил, когда не в шутку занемог, он уважать себя заставил и лучше выдумать не мог. Его пример другим наука; но, боже мой, какая скука с больным сидеть и день и ночь, не отходя ни шагу прочь!', 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife. However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families.'];
const P2 = ['Какое низкое коварство полуживого забавлять, ему подушки поправлять, печально подносить лекарство, вздыхать и думать про себя: когда же чёрт возьмёт тебя!', 'That he is considered the rightful property of some one or other of their daughters. “My dear Mr. Bennet,” said his lady to him one day, “have you heard that Netherfield Park is let at last?”'];
const openbook = `<div class="openbook" aria-hidden="true"><div class="pg pg-l" data-n="12"><h6>${bis('Глава I', 'Chapter I')}</h6><p>${bis(P1[0], P1[1])}</p></div><div class="pg pg-r" data-n="13"><p>${bis(P2[0], P2[1])}</p></div>${
  [1, 2, 3].map(() => `<div class="lf" data-n="13"><p>${bis(P2[0], P2[1])}</p></div>`).join('')}</div>`;
const stage = `<div class="stage" id="stage" role="button" tabindex="0" aria-label="${esc('Пластинка и книга: нажмите, чтобы остановить или запустить')}">
<div class="album"><div class="sleeve"><span>${bis('Вечерний альбом', 'Evening album')}</span></div><div class="vinyl"><div class="record"><i></i></div></div>
<svg class="arm" viewBox="0 0 140 100" aria-hidden="true"><g><circle cx="128" cy="10" r="6.5"/><path d="M128 10 L108 24"/><rect x="102" y="21" width="9" height="5.5" rx="1.5" transform="rotate(35 106 24)"/></g></svg></div>
<div class="tome">${openbook}<div class="cover"><b>${bis('Идиот', 'The Idiot')}</b><small>${bis('Ф. Достоевский', 'F. Dostoyevsky')}</small></div></div></div>`;
const play = cfg.playUrl
  ? `<a class="btn" href="${esc(cfg.playUrl)}" rel="noopener">${bis('Скачать в Google Play', 'Get it on Google Play')}</a>`
  : `<span class="btn off">${bis('Скоро в Google Play', 'Coming soon to Google Play')}</span>`;
const hero = `<div class="intro"><div class="wrap"><h1>${bis('Аудиокниги и альбомы на одной полке', 'Audiobooks and albums on one shelf')}</h1>
<p class="lead">${bis('AudioShelf для Android запоминает, где вы остановились, не показывает рекламу и не просит аккаунт.', 'AudioShelf for Android remembers where you stopped, shows no ads and asks for no account.')}</p>
<div class="get">${play}<small>${bis('Android 7.0 и новее. Бесплатно, Premium по желанию.', 'Android 7.0 and newer. Free, Premium is optional.')}</small></div></div>
<div class="shelf"><div class="books">${half(left)}${stage}${half(right)}</div><div class="plank"></div>
<div class="wrap"><p class="note" id="note" aria-live="polite"><span data-l="ru">Нажмите на корешок, чтобы вытащить книгу. Пластинку и книгу рядом можно остановить нажатием: так выглядит обложка в плеере.</span><span data-l="en">Tap a spine to pull the book out. Tap the record and the book to stop them: this is how the cover looks in the player.</span></p></div></div></div>`;

const defs = [
  ['Помнит место', 'Remembers the place', 'Позиция сохраняется с точностью до секунды, даже если телефон перезагрузился. У каждой книги свои скорость, эквалайзер и громкость. Закладки ставятся в любом месте.', 'The position is saved to the second, even after a restart. Every book keeps its own speed, equalizer and volume. Bookmarks go anywhere.'],
  ['Книга и альбом', 'Book and album', 'Книга играет главы подряд и показывает два прогресса: главы и всей книги. Альбом плавно гасит конец трека, делает паузу и включает следующий. Порядок на выбор: подряд, повтор одного, повтор всех, вперемешку. Лишний трек можно убрать из списка или удалить с диска.', 'A book plays chapters back to back and shows two progress bars. An album fades out the end of a track, pauses and starts the next. Order is yours: in sequence, repeat one, repeat all, shuffle. A track you do not want can leave the list or be deleted from the disk.'],
  ['Каталог', 'Catalog', 'Свободные аудиокниги (LibriVox и другие) и музыка под лицензиями Creative Commons. Ищите по названию и автору, слушайте онлайн бесплатно. Скачанные в Premium книги лежат в вашей папке и остаются у вас навсегда. У каждой книги указаны лицензия и источник.', 'Free audiobooks (LibriVox and others) and music under Creative Commons licences. Search by title and author and listen online for free. Books downloaded with Premium live in your folder and stay with you for good. Every book shows its licence and source.'],
  ['В дороге', 'On the road', 'Плеер в шторке и на экране блокировки, виджет, таймер сна с затуханием, шаг перемотки на ваш выбор. Звонок или уведомление останавливают звук, и воспроизведение возвращается на пять секунд назад.', 'A player in the notification shade and on the lock screen, a widget, a sleep timer that fades out, a skip step of your choice. A call or a notification pauses the sound, and playback comes back five seconds earlier.'],
  ['Звук', 'Sound', 'Эквалайзер на десять полос, усиление до 300 %, выравнивание громкости между файлами и десять визуализаторов. Это Premium.', 'A ten-band equalizer, boost up to 300 %, loudness leveling between files and ten visualizers. This is Premium.'],
  ['Данные', 'Data', 'Библиотека, позиции и закладки хранятся только на телефоне. Нет аккаунтов, аналитики и рекламы. Интернет нужен лишь каталогу.', 'Your library, positions and bookmarks live only on the phone. No accounts, analytics or ads. The internet is used only by the catalog.']
];
const famSpines = [['Мультитул', 'Multitool', 210, '#3b4750'], ['Файловый менеджер', 'File manager', 235, '#5c6b2f'], ['PDF-читалка', 'PDF reader', 200, '#4c2b57'], ['PDF-сканер', 'PDF scanner', 225, '#7a2230']];
const fam = `<div class="shelf"><div class="books"><button type="button" class="spine am" style="height:262px;width:46px" aria-label="AudioShelf"><span>AudioShelf</span></button>${
  famSpines.map((s, i) => `<span class="spine soon${i === 3 ? ' lean' : ''}" style="--c:${s[3]};height:${s[2]}px;width:${40 + i * 3}px"><span>${bis(s[0], s[1])}</span></span>`).join('')}</div><div class="plank"></div></div>`;
const shot = (n, ru, en) => `<figure><img data-shot="${n}" src="shots/${n}-light.webp" alt="" loading="lazy" width="390" height="780"><figcaption>${bis(ru, en)}</figcaption></figure>`;

const CARDCOL = ['#7a2230', '#1f4563', '#5c6b2f', '#c99a2e', '#4c2b57', '#3b4750'];
const ico = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = [
  ico('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  ico('<path d="M4 5a2 2 0 0 1 2-2h13v17H6a2 2 0 0 0-2 2z"/><path d="M4 5v17"/>'),
  ico('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3M8.5 11h5M11 8.5v5"/>'),
  ico('<path d="M3 17l3-10h12l3 10"/><path d="M12 7v2m0 3v2m0 3v1"/>'),
  ico('<path d="M5 20V10m7 10V4m7 16v-7"/><circle cx="5" cy="8" r="2"/><circle cx="12" cy="14" r="2"/><circle cx="19" cy="11" r="2"/>'),
  ico('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>')
];
const landing = `<section id="features"><div class="wrap"><h2>${bis('Что умеет', 'What it does')}</h2>
<p class="sec-sub">${bis('Всё для долгого слушания и ничего лишнего.', 'Everything for long listening and nothing more.')}</p>
<div class="cards">${defs.map((d, i) => `<div class="card" style="--c:${CARDCOL[i % 6]}"><div class="ico">${ICON[i % 6]}</div><h3>${bis(d[0], d[1])}</h3><p>${bis(d[2], d[3])}</p></div>`).join('')}</div></div></section>
<section><div class="wrap"><h2>${bis('Экраны', 'Screens')}</h2><div class="shots">
${shot('shelf', 'Библиотека: книги и музыка, режим «Полка», вкладка «Онлайн».', 'Library: books and music, a Shelf view and an Online tab.')}
${shot('player', 'Плеер: два прогресса у книги, один у альбома.', 'Player: two progress bars for a book, one for an album.')}
${shot('catalog', 'Каталог: поиск, лицензия и источник у каждой записи.', 'Catalog: search, with the licence and source of every item.')}</div></div></section>
<section><div class="wrap"><h2>${bis('Два режима', 'Two modes')}</h2><div class="modes">
<div class="card" style="--c:#7a2230"><span class="tag">${bis('Книга', 'Book')}</span><h3>${bis('Слушайте, как читаете', 'Listen like you read')}</h3><p>${bis('Главы идут встык. Прогресс главы и всей книги, закладки, возобновление с точного места и перемотка с настраиваемым шагом.', 'Chapters run back to back. Chapter and whole-book progress, bookmarks, exact resume and a configurable skip step.')}</p></div>
<div class="card" style="--c:#1f4563"><span class="tag">${bis('Альбом', 'Album')}</span><h3>${bis('Музыка без обрывов', 'Music without hard cuts')}</h3><p>${bis('Плавное затухание и вход следующего трека. Порядок: подряд, повтор одного, повтор альбома или случайно. Ненужный трек можно убрать из списка или удалить с диска.', 'Gentle fades between tracks. Order: in sequence, repeat one, repeat album or shuffle. Drop a track from the list or delete it from disk.')}</p></div></div></div></section>
<section><div class="wrap"><h2>${bis('Бесплатно и Premium', 'Free and Premium')}</h2>
<p class="sec-sub">${bis('Без подписок: платите один раз или не платите вовсе.', 'No subscriptions: pay once or not at all.')}</p><div class="plans">
<div class="card plan" style="--c:#c99a2e"><span class="tag">${bis('Сначала', 'First')}</span><h3>${bis('30 дней, всё открыто', '30 days, everything unlocked')}</h3><p>${bis('Попробуйте все функции сразу после установки.', 'Try every feature right after installing.')}</p></div>
<div class="card plan" style="--c:#5c6b2f"><span class="tag">${bis('Навсегда', 'Forever')}</span><div class="price">${bis('Бесплатно', 'Free')}</div><ul><li>${bis('библиотека и каталог', 'library and catalog')}</li><li>${bis('закладки и таймер сна', 'bookmarks and sleep timer')}</li><li>${bis('режимы «Книга» и «Альбом»', 'Book and Album modes')}</li></ul></div>
<div class="card plan hl" style="--c:#e8b66d"><span class="tag" style="color:#24170b">Premium</span><div class="price">4,99 € / $</div><ul><li>${bis('эквалайзер, усиление, выравнивание громкости', 'equalizer, boost, loudness leveling')}</li><li>${bis('десять визуализаторов', 'ten visualizers')}</li><li>${bis('скачивание книг из каталога', 'downloading catalog books')}</li></ul></div></div>
<p class="fine">${bis('Скачанные книги остаются в вашей папке и в библиотеке и после пробного периода: приложение их не удаляет и не прячет. Автора можно угостить чашкой чая или порадовать котика, это необязательно и ничего не открывает.', 'Downloaded books stay in your folder and in the library after the trial: the app never deletes or hides them. You can buy the author a cup of tea or treat the cat; it is optional and unlocks nothing.')}</p></div></section>
<section><div class="wrap"><div class="band"><div><h2>${bis('Приватность по умолчанию', 'Private by default')}</h2>
<p>${bis('У приложения нет аккаунтов, аналитики и собственных серверов. Библиотека и прослушивание остаются на устройстве. Подробнее: ', 'The app has no accounts, analytics or servers of its own. Your library and listening stay on your device. Details: ')}<a href="privacy.html">${bis('политика конфиденциальности', 'privacy policy')}</a>.</p></div>
<div><a class="btn" href="support.html">${bis('Вопросы и поддержка', 'Questions and support')}</a></div></div></div></section>
<section class="family"><div class="wrap"><h2>${bis('Остальные приложения', 'The other apps')}</h2>
<p class="sec-sub">${bis('DataLaw Design задаёт для всех наших приложений один вид и одно поведение: те же темы, жесты и порядок настроек. AudioShelf уже на полке, остальные в работе.', 'DataLaw Design gives all our apps one look and one behaviour: the same themes, gestures and settings order. AudioShelf is on the shelf already; the rest are in the works.')}</p>${fam}</div></section>
<section><div class="wrap"><div class="band"><div><h2>DataLaw</h2>
<p>${bis('DataLaw — приложение для юридических фирм с локальным ИИ: данные остаются у вас. Оно в разработке. DataLaw Design берёт заказы на интерфейсы и фирменный стиль.', 'DataLaw is an app for law firms with a local AI, so your data stays with you. It is in development. DataLaw Design takes commissions for interfaces and brand identity.')}</p></div>
<div><a class="btn" href="mailto:${esc(cfg.email)}">${bis('Написать нам', 'Contact us')}</a></div></div></div></section>`;
fs.writeFileSync(path.join(out, 'index.html'), page('index.html',
  { ru: 'AudioShelf — аудиокниги и альбомы на одной полке', en: 'AudioShelf — audiobooks and albums on one shelf', desc: 'AudioShelf: audiobook and album player for Android. No ads, no accounts, a free catalog of public-domain books.' }, landing, { hero }));

// ---- legal pages from store/*.md ----
function legal(file, src, titles){
  const b = split(read(src));
  fs.writeFileSync(path.join(out, file), page(file, titles,
    `<article><div class="wrap"><h1>${bis(titles.ru, titles.en)}</h1>${bi(b.ru, b.en)}</div></article>`));
}
legal('privacy.html', 'store/PRIVACY_POLICY.md', { ru: 'Политика конфиденциальности', en: 'Privacy Policy', desc: 'AudioShelf privacy policy' });
legal('terms.html', 'store/TERMS.md', { ru: 'Условия использования', en: 'Terms of Use', desc: 'AudioShelf terms of use' });

// ---- support ----
const faq = [
  ['Где взять бесплатные книги?', 'Where do I find free books?', 'Откройте вкладку «Каталог», найдите книгу и нажмите «Слушать онлайн». Это бесплатно. Записи принадлежат общественному достоянию (LibriVox), лицензия показана у каждой книги.', 'Open the Catalog tab, find a book and tap Listen online. It is free. The recordings are in the public domain (LibriVox) and the licence is shown on every book.'],
  ['Что будет со скачанными книгами, если пробный период закончился?', 'What happens to downloaded books after the free trial?', 'Ничего: они остаются в вашей папке и в библиотеке (среди книг или музыки, со значком) и продолжают играть. Приложение их не удаляет и не прячет. Без Премиума недоступно только новое скачивание.', 'Nothing: they stay in your folder and in the library (among books or music, marked with an icon) and keep playing. The app never deletes or hides them. Without Premium only new downloads are unavailable.'],
  ['Не скачивается книга', 'A book will not download', 'Скачивание нужно Премиуму и права записи в папку. Если приложение просит, добавьте папку в библиотеку заново (папки, добавленные в старых версиях, не дают записи). Нужны интернет и свободное место.', 'Downloading needs Premium and write access to the folder. If asked, add the folder to the library again (folders added by old versions do not allow writing). You also need internet and free space.'],
  ['Как добавить книги?', 'How do I add books?', 'Откройте «Библиотека» и выберите папку с аудиокнигами. Каждая подпапка станет книгой, главы пойдут по порядку.', 'Open Library and pick the folder with your audiobooks. Each subfolder becomes a book and its files become chapters, in order.'],
  ['Куда пропала позиция или книга?', 'My position or book is missing', 'Данные хранятся только на устройстве. При удалении приложения или очистке данных они удаляются. Если вы переместили папку, выберите её заново.', 'Data lives only on your device and is erased when you uninstall or clear the app data. If you moved the folder, pick it again.'],
  ['Как восстановить Премиум?', 'How do I restore Premium?', 'Откройте «Настройки → Премиум и поддержка» и нажмите «Восстановить покупки». Нужен тот же аккаунт Google, с которого платили.', 'Open Settings → Premium and support and tap Restore purchases. Use the same Google account you paid with.'],
  ['Как ввести код активации?', 'How do I enter an activation code?', 'В том же разделе нажмите «У меня есть код» и введите код вида XXXX-XXXX-XXXX.', 'In the same section tap I have a code and enter a code like XXXX-XXXX-XXXX.'],
  ['Как вернуть деньги?', 'How do I get a refund?', 'Возврат оформляется через Google Play (история заказов → «Вернуть деньги»). Правила возврата устанавливает Google.', 'Refunds go through Google Play (order history → Request a refund). Google sets the refund rules.'],
  ['Звук обрывается при выключенном экране', 'Playback stops with the screen off', 'В настройках Android отключите для AudioShelf экономию заряда («Без ограничений»), иначе система может остановить фоновую службу.', 'In Android settings set battery usage for AudioShelf to Unrestricted; otherwise the system may stop the background service.']
];
const supportBody = `<article><div class="wrap"><h1>${bis('Поддержка', 'Support')}</h1>
<p>${bis('Напишите нам: ', 'Write to us: ')}<a href="mailto:${esc(cfg.email)}">${esc(cfg.email)}</a>. ${bis('Укажите модель телефона, версию Android и версию приложения (Настройки → О приложении).', 'Please include your phone model, Android version and the app version (Settings → About).')}</p>
<h2>${bis('Частые вопросы', 'FAQ')}</h2>${
  faq.map(f => `<details><summary>${bis(f[0], f[1])}</summary><p>${bis(f[2], f[3])}</p></details>`).join('')}
<h2>${bis('Удаление данных', 'Data deletion')}</h2><p>${bis('У приложения нет аккаунтов и серверов. Чтобы удалить все данные, удалите приложение или очистите его данные в настройках Android. Скачанные книги лежат в вашей папке: они остаются там, пока вы сами их не удалите. Покупки привязаны к аккаунту Google.', 'The app has no accounts or servers. To delete all data, uninstall the app or clear its data in Android settings. Downloaded books live in your folder and stay there until you delete them yourself. Purchases are tied to your Google account.')}</p></div></article>`;
fs.writeFileSync(path.join(out, 'support.html'), page('support.html', { ru: 'Поддержка', en: 'Support', desc: 'AudioShelf support and FAQ' }, supportBody));

// ---- licences ----
const lic = md(read('LICENSE.md').replace(/^# .*\n+/, '')) + md(read('THIRD_PARTY_NOTICES.md').replace(/^# .*\n+/, ''));
const texts = fs.readdirSync(path.join(root, 'licenses')).sort().map(f =>
  `<h2>${esc(f.replace(/\.txt$/, ''))}</h2><pre>${esc(read('licenses/' + f))}</pre>`).join('');
fs.writeFileSync(path.join(out, 'licenses.html'), page('licenses.html', { ru: 'Лицензии', en: 'Licences', desc: 'AudioShelf licences and third-party notices' },
  `<article><div class="wrap"><h1>${bis('Лицензии', 'Licences')}</h1><p style="color:var(--mute)">${bis('Тексты лицензий на английском языке.', 'Licence texts are in English.')}</p>${lic}${texts}</div></article>`));

console.log('site built:', fs.readdirSync(out).join(', '));
