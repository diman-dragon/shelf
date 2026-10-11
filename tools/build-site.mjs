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
:root{--bg:#000;--panel:#0c0b0a;--card:#100e0c;--ink:#f5f2ec;--mute:#9c958a;--line:#26211b;--acc:#e8b66d;--on:#24170b;--glow:rgba(232,182,109,.16);--shadow:0 24px 60px rgba(0,0,0,.6)}
:root[data-theme=light]{--bg:#e9dcc2;--panel:#f2e8d3;--card:#f4ebd8;--ink:#2c2015;--mute:#6c5d47;--line:#d3c19d;--acc:#9a5f1e;--on:#fff7e8;--glow:rgba(154,95,30,.18);--shadow:0 24px 60px rgba(80,55,25,.28)}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
body[data-lang=ru] [data-l=en],body[data-lang=en] [data-l=ru]{display:none!important}
a{color:var(--acc)}.wrap{max-width:1040px;margin:0 auto;padding:0 20px}
h1,h2,h3{font-family:Georgia,"Times New Roman",serif;letter-spacing:-.01em}
header.top{position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
header.top .wrap{display:flex;align-items:center;gap:10px;height:60px}
.brand{display:flex;align-items:center;gap:10px;font:700 18px Georgia,serif;color:var(--ink);text-decoration:none}
.brand img{width:32px;height:32px;border-radius:9px}
nav{display:flex;gap:2px;margin-left:auto;flex-wrap:wrap}
nav a{color:var(--mute);text-decoration:none;padding:7px 11px;border-radius:9px;font-size:14px}
nav a:hover,nav a[aria-current]{color:var(--ink);background:var(--panel)}
.ctl{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:9px;min-width:36px;height:34px;padding:0 10px;font:inherit;font-size:13px;cursor:pointer}
.ctl:hover{border-color:var(--acc)}
@media(max-width:760px){nav{display:none}header.top .wrap{justify-content:space-between}.ctls{display:flex;gap:8px}}
.ctls{display:flex;gap:8px;margin-left:8px}@media(max-width:760px){.ctls{margin-left:0}}
.hero{position:relative;overflow:hidden;padding:64px 0 24px;background:radial-gradient(70% 90% at 80% 20%,var(--glow),transparent 70%)}
.hero .wrap{display:grid;gap:36px;grid-template-columns:1.05fr .95fr;align-items:center}
@media(max-width:820px){.hero .wrap{grid-template-columns:1fr}.hero{padding-top:36px}}
.eyebrow{display:inline-block;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--acc);border:1px solid var(--line);background:var(--panel);padding:5px 12px;border-radius:99px;margin-bottom:18px}
.hero h1{font-size:clamp(34px,6vw,58px);line-height:1.08;margin:0 0 18px}
.hero p.lead{font-size:19px;color:var(--mute);margin:0 0 28px;max-width:34ch}
.btn{display:inline-flex;align-items:center;gap:8px;background:var(--acc);color:var(--on);font-weight:700;text-decoration:none;padding:14px 26px;border-radius:14px;box-shadow:0 8px 24px var(--glow)}
.btn.off{opacity:.85;cursor:default;box-shadow:none}
.btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--line);box-shadow:none;margin-left:10px}
.sub{font-size:14px;color:var(--mute);margin-top:14px}
.phones{position:relative;height:520px;display:flex;justify-content:center}
.phone{position:absolute;width:236px;border-radius:30px;border:7px solid #1a1713;background:#000;box-shadow:var(--shadow);overflow:hidden}
:root[data-theme=light] .phone{border-color:#3a2c1a}
.phone img{display:block;width:100%;height:auto}
.phone.a{left:50%;top:0;transform:translateX(-86%) rotate(-5deg)}
.phone.b{left:50%;top:44px;transform:translateX(-6%) rotate(4deg);z-index:2}
@media(max-width:820px){.phones{height:450px}.phone{width:190px}.phone.a{transform:translateX(-94%) rotate(-5deg)}.phone.b{transform:translateX(-4%) rotate(4deg)}.btn.ghost{margin:10px 0 0}}
section{padding:60px 0}section h2{font-size:clamp(26px,4vw,36px);margin:0 0 10px;line-height:1.15}
.sec-sub{color:var(--mute);margin:0 0 30px;max-width:56ch}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(290px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px}
.card .ico{width:42px;height:42px;border-radius:12px;background:var(--panel);border:1px solid var(--line);display:grid;place-items:center;color:var(--acc);margin-bottom:14px}
.card .ico svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.card h3{margin:0 0 6px;font-size:19px}.card p{margin:0;color:var(--mute);font-size:15px}
.shots{display:grid;grid-template-columns:repeat(3,1fr);gap:26px;justify-items:center}
.shots figure{margin:0;text-align:center;max-width:270px}.shots .phone{position:static;width:100%;border-radius:28px}
.shots figcaption{margin-top:14px;color:var(--mute);font-size:14px}
@media(max-width:760px){.shots{grid-template-columns:1fr}}
.modes{display:grid;gap:16px;grid-template-columns:1fr 1fr}@media(max-width:700px){.modes{grid-template-columns:1fr}}
.modes .card h3{font-size:22px}.tag{display:inline-block;font-size:12px;color:var(--acc);border:1px solid var(--line);border-radius:99px;padding:2px 10px;margin:0 6px 10px 0}
.plans{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
.plan .price{font:700 34px Georgia,serif;margin:2px 0 8px}.plan.hl{border-color:var(--acc);box-shadow:0 0 0 1px var(--acc) inset}
.plan ul{margin:10px 0 0;padding-left:20px;color:var(--mute);font-size:15px}
.apps{display:grid;gap:16px;grid-template-columns:repeat(5,1fr)}@media(max-width:900px){.apps{grid-template-columns:repeat(auto-fill,minmax(170px,1fr))}}
.app{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:20px;display:flex;flex-direction:column;gap:6px}
.app .ico{width:46px;height:46px;border-radius:13px;background:var(--panel);border:1px solid var(--line);display:grid;place-items:center;color:var(--acc);margin-bottom:6px}
.app .ico svg{width:24px;height:24px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.app .ico img{width:46px;height:46px;border-radius:13px}.app.live{border-color:var(--acc)}
.app b{font-size:17px}.app span{color:var(--mute);font-size:14px}.app em{font-style:normal;font-size:12px;color:var(--acc);margin-top:auto;padding-top:8px}
.band{border:1px solid var(--line);background:linear-gradient(135deg,var(--panel),var(--card));border-radius:22px;padding:34px;display:grid;gap:18px;grid-template-columns:1.3fr 1fr;align-items:center}
@media(max-width:760px){.band{grid-template-columns:1fr;padding:24px}}
.band h2{margin-bottom:8px}.swatches{display:flex;gap:10px;flex-wrap:wrap}
.sw{width:54px;height:54px;border-radius:14px;border:1px solid var(--line)}
article{padding:40px 0 70px}article .wrap{max-width:820px}article h1{font-size:34px;margin:0 0 8px}
article h2{font-size:22px;margin:30px 0 8px}article h3{font-size:17px}article ul{padding-left:22px}
article code{background:var(--card);border:1px solid var(--line);padding:1px 6px;border-radius:6px;font-size:.9em}
.tbl{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}
th,td{border-bottom:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
pre{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;overflow:auto;font-size:12px;line-height:1.5;white-space:pre-wrap}
details{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 18px;margin:10px 0}
summary{cursor:pointer;font-weight:600}details p{margin:10px 0 0;color:var(--mute)}
footer{border-top:1px solid var(--line);padding:32px 0;color:var(--mute);font-size:14px}
footer .wrap{display:flex;gap:16px;flex-wrap:wrap;justify-content:space-between}footer a{color:var(--mute)}
`;
const JS = `(function(){var d=document.body,r=document.documentElement,l,th;
try{l=localStorage.getItem('lang');th=localStorage.getItem('theme')}catch(e){}
if(l!=='ru'&&l!=='en')l=/^(ru|uk|be|kk)/i.test(navigator.language||'')?'ru':'en';
if(th!=='dark'&&th!=='light')th=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';
function paint(){d.dataset.lang=l;r.lang=l;r.dataset.theme=th;
 var b=document.getElementById('lb');if(b)b.textContent=l==='ru'?'EN':'RU';
 var m=document.getElementById('tb');if(m)m.textContent=th==='dark'?'☾':'☀';
 var t=document.querySelector('title');if(t&&t.dataset[l])t.textContent=t.dataset[l];
 document.querySelectorAll('img[data-shot]').forEach(function(i){i.src='shots/'+i.dataset.shot+'-'+th+(l==='en'?'-en':'')+'.webp'})}
paint();
document.getElementById('lb').onclick=function(){l=l==='ru'?'en':'ru';try{localStorage.setItem('lang',l)}catch(e){}paint()};
document.getElementById('tb').onclick=function(){th=th==='dark'?'light':'dark';try{localStorage.setItem('theme',th)}catch(e){}paint()}})();`;
const ico = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const I = {
  mem: ico('<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/>'),
  book: ico('<path d="M4 5a2 2 0 0 1 2-2h13v17H6a2 2 0 0 0-2 2z"/><path d="M4 5v17"/>'),
  lock: ico('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  road: ico('<path d="M3 17l3-10h12l3 10"/><path d="M12 7v2m0 3v2m0 3v1"/>'),
  eq: ico('<path d="M5 20V10m7 10V4m7 16v-7"/><circle cx="5" cy="8" r="2"/><circle cx="12" cy="14" r="2"/><circle cx="19" cy="11" r="2"/>'),
  lang: ico('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>'),
  catalog: ico('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3M8.5 11h5M11 8.5v5"/>'),
  tool: ico('<path d="M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.4 2.4-2.6-.6-.6-2.6z"/>'),
  folder: ico('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  pdf: ico('<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 14h6M9 17h4"/>'),
  scan: ico('<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M4 12h16"/>')
};
const shot = (n, cls = '') => `<div class="phone ${cls}"><img data-shot="${n}" src="shots/${n}-dark.webp" alt="AudioShelf" loading="lazy" width="390" height="780"></div>`;

function page(file, titles, body, { hero = '' } = {}){
  const nav = ['home', 'privacy', 'terms', 'support', 'licenses'].map(k => {
    const href = k === 'home' ? 'index.html' : k + '.html';
    return `<a href="${href}"${href === file ? ' aria-current="page"' : ''}>${bis(T.ru[k], T.en[k])}</a>`;
  }).join('');
  const year = new Date().getFullYear();
  return `<!doctype html><html lang="ru" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title data-ru="${esc(titles.ru)}" data-en="${esc(titles.en)}">${esc(titles.ru)}</title>
<meta name="description" content="${esc(titles.desc || '')}"><meta name="theme-color" content="#000000">
<meta property="og:title" content="${esc(titles.en)}"><meta property="og:description" content="${esc(titles.desc || '')}"><meta property="og:image" content="feature.png">
<link rel="icon" href="icon.png"><style>${CSS}</style></head><body data-lang="ru">
<header class="top"><div class="wrap"><a class="brand" href="index.html"><img src="icon.png" alt="">AudioShelf</a><nav>${nav}</nav>
<div class="ctls"><button class="ctl" id="tb" type="button" aria-label="Theme">☾</button><button class="ctl" id="lb" type="button" aria-label="Language">EN</button></div></div></header>
${hero}${body}
<footer><div class="wrap"><span>© ${year} DataLaw · DataLaw Design. ${bis(T.ru.rights, T.en.rights)}</span><span><a href="mailto:${esc(cfg.email)}">${esc(cfg.email)}</a> · <a href="${esc(cfg.repoUrl)}" rel="noopener">GitHub</a></span></div></footer>
<script>${JS}</script></body></html>`;
}

fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(root, 'store/graphics/icon-512.png'), path.join(out, 'icon.png'));
fs.copyFileSync(path.join(root, 'store/graphics/feature-graphic-1024x500.png'), path.join(out, 'feature.png'));
fs.cpSync(path.join(root, 'store/graphics/shots'), path.join(out, 'shots'), { recursive: true });
fs.writeFileSync(path.join(out, '.nojekyll'), '');

// ---- landing ----
const features = [
  ['mem', 'Память по каждой книге', 'A memory for every book', 'Позиция запоминается точно, у каждой книги свои скорость, эквалайзер и громкость. Закладки в любом месте.', 'The exact position is remembered, and every book keeps its own speed, equalizer and volume. Bookmarks anywhere.'],
  ['book', 'Книга и альбом', 'Book and album modes', 'Книга: главы идут подряд, видны два прогресса. Альбом: плавные переходы между треками и свой порядок.', 'Book: chapters flow on, with two progress bars. Album: gentle fades between tracks and your own play order.'],
  ['catalog', 'Бесплатный каталог', 'A free catalog', 'Аудиокниги в общественном достоянии (LibriVox): ищите и слушайте онлайн бесплатно, а в Премиуме скачивайте в свою папку навсегда.', 'Public-domain audiobooks (LibriVox): search and listen online for free, and download them to your own folder for good with Premium.'],
  ['road', 'Удобно в дороге', 'Made for the road', 'Плеер в шторке и на экране блокировки, виджет, таймер сна с затуханием, перемотка с настраиваемым шагом.', 'Notification and lock-screen player, a widget, a fading sleep timer and a configurable skip step.'],
  ['eq', 'Живой звук', 'Better sound', 'Эквалайзер, усиление и выравнивание громкости по файлам в фоне, красивые визуализаторы.', 'Equalizer, gain and background loudness normalization, plus visualizers.'],
  ['lock', 'Библиотека на телефоне', 'Your library stays on your phone', 'Без аккаунтов, аналитики и рекламы. Приложение читает только выбранные вами папки; интернет нужен лишь для каталога.', 'No accounts, analytics or ads. The app only reads the folders you pick; the internet is used only for the catalog.']
];
const play = cfg.playUrl
  ? `<a class="btn" href="${esc(cfg.playUrl)}" rel="noopener">${bis('Скачать в Google Play', 'Get it on Google Play')}</a>`
  : `<span class="btn off">${bis('Скоро в Google Play', 'Coming soon to Google Play')}</span>`;
const hero = `<div class="hero"><div class="wrap"><div>
<span class="eyebrow">${bis('Аудиокниги · музыка · Android', 'Audiobooks · music · Android')}</span>
<h1>${bis('Тёплый плеер для аудиокниг и альбомов', 'A warm player for audiobooks and albums')}</h1>
<p class="lead">${bis('Простой и быстрый, без рекламы и аккаунтов. Библиотека хранится на вашем телефоне, а бесплатный каталог книг всегда под рукой.', 'Simple and fast, with no ads and no accounts. Your library stays on your phone, and a free book catalog is always at hand.')}</p>
${play}<a class="btn ghost" href="#features">${bis('Возможности', 'Features')}</a>
<div class="sub">${bis('Android 7.0 и новее · бесплатно, Премиум по желанию · тёмная и светлая темы', 'Android 7.0 and newer · free, Premium optional · dark and light themes')}</div></div>
<div class="phones">${shot('shelf', 'a')}${shot('player', 'b')}</div></div></div>`;
const apps = [
  [`<img src="icon.png" alt="">`, 'AudioShelf', 'Аудиокниги и музыка', 'Audiobooks and music', 'live'],
  [I.tool, 'Мультитул', 'Набор мелких инструментов', 'A kit of small tools', ''],
  [I.folder, 'Файл-менеджер', 'Файлы без лишнего', 'Files without the clutter', ''],
  [I.pdf, 'PDF-читалка', 'Читать и отмечать', 'Read and annotate', ''],
  [I.scan, 'PDF-сканер', 'Бумага в PDF', 'Paper to PDF', '']
];
const landing = `<section id="features"><div class="wrap"><h2>${bis('Что внутри', "What's inside")}</h2>
<p class="sec-sub">${bis('Всё, что нужно для долгого слушания, и ничего лишнего.', 'Everything you need for long listening, and nothing more.')}</p>
<div class="grid">${features.map(f => `<div class="card"><div class="ico">${I[f[0]]}</div><h3>${bis(f[1], f[2])}</h3><p>${bis(f[3], f[4])}</p></div>`).join('')}</div></div></section>
<section><div class="wrap"><h2>${bis('Как это выглядит', 'How it looks')}</h2>
<p class="sec-sub">${bis('Библиотека, плеер и звук. Тема переключается кнопкой вверху страницы.', 'Library, player and sound. Switch the theme with the button at the top.')}</p>
<div class="shots">
<figure>${shot('shelf')}<figcaption>${bis('Библиотека: книги и музыка', 'Library: books and music')}</figcaption></figure>
<figure>${shot('player')}<figcaption>${bis('Плеер с двумя прогрессами', 'Player with two progress bars')}</figcaption></figure>
<figure>${shot('sound')}<figcaption>${bis('Звук книги: пресеты и эквалайзер', 'Book sound: presets and equalizer')}</figcaption></figure></div></div></section>
<section><div class="wrap"><h2>${bis('Два режима', 'Two modes')}</h2><div class="modes">
<div class="card"><span class="tag">${bis('Книга', 'Book')}</span><h3>${bis('Слушайте, как читаете', 'Listen like you read')}</h3><p>${bis('Главы идут встык. Прогресс главы и всей книги, закладки, возобновление с точного места и перемотка с настраиваемым шагом.', 'Chapters run back to back. Chapter and whole-book progress, bookmarks, exact resume and a configurable skip step.')}</p></div>
<div class="card"><span class="tag">${bis('Альбом', 'Album')}</span><h3>${bis('Музыка без обрывов', 'Music without hard cuts')}</h3><p>${bis('Плавное затухание и вход следующего трека. Порядок: подряд, повтор одного, повтор альбома или случайно. Ненужный трек можно убрать из списка или удалить с диска.', 'Gentle fades between tracks. Order: in sequence, repeat one, repeat album or shuffle. Drop a track from the list or delete it from disk.')}</p></div></div></div></section>
<section><div class="wrap"><h2>${bis('Бесплатно и Премиум', 'Free and Premium')}</h2>
<p class="sec-sub">${bis('Без подписок: платите один раз или не платите вовсе.', 'No subscriptions: pay once or not at all.')}</p><div class="plans">
<div class="card plan"><span class="tag">${bis('Сначала', 'First')}</span><h3>${bis('30 дней — всё открыто', '30 days — everything unlocked')}</h3><p>${bis('Попробуйте все функции сразу после установки.', 'Try every feature right after installing.')}</p></div>
<div class="card plan"><span class="tag">${bis('Навсегда', 'Forever')}</span><div class="price">${bis('Бесплатно', 'Free')}</div><p>${bis('Воспроизведение, библиотека, закладки, таймер сна, режимы «Книга» и «Альбом», каталог бесплатных книг с прослушиванием онлайн.', 'Playback, library, bookmarks, sleep timer, Book and Album modes, the free catalog with online listening.')}</p></div>
<div class="card plan hl"><span class="tag">Premium</span><div class="price">4,99 € / $</div><p>${bis('Один раз и навсегда: эквалайзер, усиление, выравнивание громкости, визуализаторы и скачивание книг из каталога.', 'Once and for life: equalizer, gain, loudness normalization, visualizers and downloading catalog books.')}</p></div></div>
<p class="sec-sub" style="margin:18px 0 0">${bis('Можно угостить автора чашкой чая или порадовать котика — это необязательно и ничего не открывает.', 'You can buy the author a cup of tea or treat the cat — optional, and it unlocks nothing.')}</p></div></section>
<section><div class="wrap"><div class="band"><div><h2>${bis('Приватность по умолчанию', 'Private by default')}</h2>
<p class="sec-sub" style="margin:0">${bis('У приложения нет аккаунтов, аналитики и собственных серверов. Библиотека и прослушивание остаются на устройстве; интернет используется только когда вы сами ищете, слушаете или скачиваете книгу из каталога. Подробнее: ', 'The app has no accounts, analytics or servers of its own. Your library and listening stay on your device; the internet is used only when you search, listen to or download a catalog book yourself. Details: ')}<a href="privacy.html">${bis('политика конфиденциальности', 'privacy policy')}</a>.</p></div>
<div><a class="btn" href="support.html">${bis('Вопросы и поддержка', 'Questions and support')}</a></div></div></div></section>
<section><div class="wrap"><h2>${bis('Семейство приложений', 'The app family')}</h2>
<p class="sec-sub">${bis('DataLaw Design задаёт единый вид и поведение всех наших приложений: те же темы, жесты и порядок настроек. AudioShelf уже здесь, остальные в работе.', 'DataLaw Design defines one look and behaviour for all our apps: the same themes, gestures and settings order. AudioShelf is here; the rest are in the works.')}</p>
<div class="apps">${apps.map(a => `<div class="app${a[4] ? ' live' : ''}"><div class="ico">${a[0]}</div><b>${a[1]}</b><span>${bis(a[2], a[3])}</span><em>${a[4] ? bis('Доступно', 'Available') : bis('Скоро', 'Coming soon')}</em></div>`).join('')}</div></div></section>
<section><div class="wrap"><div class="band"><div><h2>DataLaw</h2>
<p class="sec-sub" style="margin:0">${bis('DataLaw — приложение для юридических фирм с локальным ИИ, данные остаются у вас. Сейчас в разработке. DataLaw Design отвечает за дизайн продуктов и берёт заказы на интерфейсы и фирменный стиль.', 'DataLaw is an app for law firms with a local AI, so your data stays with you. It is in development. DataLaw Design looks after product design and takes commissions for interfaces and brand identity.')}</p></div>
<div><a class="btn" href="mailto:${esc(cfg.email)}">${bis('Написать нам', 'Contact us')}</a></div></div></div></section>`;
fs.writeFileSync(path.join(out, 'index.html'), page('index.html',
  { ru: 'AudioShelf — плеер аудиокниг и альбомов', en: 'AudioShelf — audiobook and album player', desc: 'AudioShelf: audiobook and album player for Android. No ads, no accounts, everything stays on your phone.' }, landing, { hero }));
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
  ['Что будет со скачанными книгами, если пробный период закончился?', 'What happens to downloaded books after the free trial?', 'Ничего: они остаются в вашей папке и в библиотеке (вкладка «Скачанные») и продолжают играть. Приложение их не удаляет и не прячет. Без Премиума недоступно только новое скачивание.', 'Nothing: they stay in your folder and in the library (Downloaded tab) and keep playing. The app never deletes or hides them. Without Premium only new downloads are unavailable.'],
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
