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
  ru: { home: 'Главная', privacy: 'Конфиденциальность', terms: 'Условия', support: 'Поддержка', licenses: 'Лицензии', rights: 'Все права защищены.' },
  en: { home: 'Home', privacy: 'Privacy', terms: 'Terms', support: 'Support', licenses: 'Licences', rights: 'All rights reserved.' }
};
const bi = (ru, en) => `<div lang="ru" data-l="ru">${ru}</div><div lang="en" data-l="en">${en}</div>`;
const bis = (ru, en) => `<span data-l="ru">${ru}</span><span data-l="en">${en}</span>`;

const CSS = `
:root{--bg:#e9dcc2;--card:#f4ebd8;--ink:#2c2015;--mute:#6c5d47;--line:#d3c19d;--acc:#8f5718;--navy:#12203a;--navy2:#1d3358}
@media (prefers-color-scheme:dark){:root{--bg:#000;--card:#0c0b0a;--ink:#f5f2ec;--mute:#9c958a;--line:#26211b;--acc:#e8b66d}}
:root[data-theme=light]{--bg:#e9dcc2;--card:#f4ebd8;--ink:#2c2015;--mute:#6c5d47;--line:#d3c19d;--acc:#8f5718}
:root[data-theme=dark]{--bg:#000;--card:#0c0b0a;--ink:#f5f2ec;--mute:#9c958a;--line:#26211b;--acc:#e8b66d}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
body[data-lang=ru] [data-l=en],body[data-lang=en] [data-l=ru]{display:none!important}
a{color:var(--acc)}.wrap{max-width:960px;margin:0 auto;padding:0 16px}
header.top{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
header.top .wrap{display:flex;align-items:center;gap:14px;height:56px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;color:var(--ink);text-decoration:none}
.brand img{width:30px;height:30px;border-radius:8px}
nav{display:flex;gap:4px;margin-left:auto;flex-wrap:wrap}
nav a{color:var(--mute);text-decoration:none;padding:6px 10px;border-radius:8px;font-size:14px}
nav a:hover,nav a[aria-current]{color:var(--ink);background:var(--card)}
.lang{border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:8px;padding:5px 10px;font:inherit;font-size:13px;cursor:pointer}
@media(max-width:640px){nav{display:none}}
.hero{background:linear-gradient(160deg,var(--navy),var(--navy2));color:#fff;padding:56px 0 48px}
.hero .wrap{display:grid;gap:28px;grid-template-columns:1.1fr .9fr;align-items:center}
@media(max-width:760px){.hero .wrap{grid-template-columns:1fr}}
.hero h1{font-size:clamp(30px,5vw,46px);line-height:1.15;margin:0 0 14px}
.hero p{font-size:18px;opacity:.9;margin:0 0 22px}
.hero img.fg{width:100%;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.45)}
.btn{display:inline-block;background:#f0a83a;color:#1b1204;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:12px}
.btn.off{opacity:.75;cursor:default}
.sub{font-size:14px;opacity:.75;margin-top:12px}
section{padding:44px 0}section h2{font-size:26px;margin:0 0 18px}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(250px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px}
.card h3{margin:0 0 6px;font-size:17px}.card p{margin:0;color:var(--mute);font-size:15px}
.plans{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.plan b{display:block;font-size:20px;margin-bottom:6px}
article{padding:36px 0 64px}article h1{font-size:32px;margin:0 0 6px}
article h2{font-size:21px;margin:30px 0 8px}article h3{font-size:17px}article ul{padding-left:22px}
article code{background:var(--card);border:1px solid var(--line);padding:1px 6px;border-radius:6px;font-size:.9em}
.tbl{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}
th,td{border-bottom:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
pre{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;overflow:auto;font-size:12px;line-height:1.5;white-space:pre-wrap}
details{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin:10px 0}
summary{cursor:pointer;font-weight:600}details p{margin:10px 0 0;color:var(--mute)}
footer{border-top:1px solid var(--line);padding:28px 0;color:var(--mute);font-size:14px}
footer .wrap{display:flex;gap:16px;flex-wrap:wrap;justify-content:space-between}
footer a{color:var(--mute)}
`;
const JS = `(function(){var d=document.body,l;try{l=localStorage.getItem('lang')}catch(e){}
if(l!=='ru'&&l!=='en')l=/^(ru|uk|be|kk)/i.test(navigator.language||'')?'ru':'en';
function set(v){d.dataset.lang=v;document.documentElement.lang=v;var b=document.getElementById('lb');if(b)b.textContent=v==='ru'?'EN':'RU';
var t=document.querySelector('title');if(t&&t.dataset[v])t.textContent=t.dataset[v]}
set(l);document.getElementById('lb').addEventListener('click',function(){l=l==='ru'?'en':'ru';try{localStorage.setItem('lang',l)}catch(e){}set(l)})})();`;

function page(file, titles, body, { hero = '' } = {}){
  const nav = ['home', 'privacy', 'terms', 'support', 'licenses'].map(k => {
    const href = k === 'home' ? 'index.html' : k + '.html';
    return `<a href="${href}"${href === file ? ' aria-current="page"' : ''}>${bis(T.ru[k], T.en[k])}</a>`;
  }).join('');
  const year = new Date().getFullYear();
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title data-ru="${esc(titles.ru)}" data-en="${esc(titles.en)}">${esc(titles.ru)}</title>
<meta name="description" content="${esc(titles.desc || '')}"><meta name="theme-color" content="#12203a">
<link rel="icon" href="icon.png"><style>${CSS}</style></head><body data-lang="ru">
<header class="top"><div class="wrap"><a class="brand" href="index.html"><img src="icon.png" alt="">AudioShelf</a><nav>${nav}</nav><button class="lang" id="lb" type="button" aria-label="Language">EN</button></div></header>
${hero}${body}
<footer><div class="wrap"><span>© ${year} DataLaw. ${bis(T.ru.rights, T.en.rights)}</span><span><a href="mailto:${esc(cfg.email)}">${esc(cfg.email)}</a></span></div></footer>
<script>${JS}</script></body></html>`;
}

fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(root, 'store/graphics/icon-512.png'), path.join(out, 'icon.png'));
fs.copyFileSync(path.join(root, 'store/graphics/feature-graphic-1024x500.png'), path.join(out, 'feature.png'));
fs.writeFileSync(path.join(out, '.nojekyll'), '');

// ---- landing ----
const features = [
  ['Память по каждой книге', 'A memory for every book', 'Позиция запоминается точно, у каждой книги свои скорость, эквалайзер и громкость. Закладки в любом месте.', 'The exact position is remembered, and every book keeps its own speed, equalizer and volume. Bookmarks anywhere.'],
  ['Книга и альбом', 'Book and album modes', 'Книга: главы идут подряд, видны два прогресса. Альбом: плавное затухание и начало следующего трека.', 'Book: chapters flow on, with two progress bars. Album: gentle fades between tracks.'],
  ['Всё на телефоне', 'Everything on your phone', 'Без аккаунтов, аналитики и рекламы. Приложение читает только выбранные вами папки и ничего не отправляет.', 'No accounts, analytics or ads. The app only reads the folders you pick and sends nothing anywhere.'],
  ['Удобно в дороге', 'Made for the road', 'Плеер в шторке и на экране блокировки, виджет, таймер сна с затуханием, перемотка с настраиваемым шагом.', 'Notification and lock-screen player, a widget, a fading sleep timer and a configurable skip step.'],
  ['Живой звук', 'Better sound', 'Эквалайзер, усиление и выравнивание громкости по файлам в фоне, красивые визуализаторы.', 'Equalizer, gain and background loudness normalization, plus visualizers.'],
  ['Русский и English', 'English and Russian', 'Интерфейс на двух языках: выбирается автоматически или в настройках.', 'The interface comes in two languages, picked automatically or in Settings.']
];
const play = cfg.playUrl
  ? `<a class="btn" href="${esc(cfg.playUrl)}" rel="noopener">${bis('Скачать в Google Play', 'Get it on Google Play')}</a>`
  : `<span class="btn off">${bis('Скоро в Google Play', 'Coming soon to Google Play')}</span>`;
const hero = `<div class="hero"><div class="wrap"><div>
<h1>${bis('Плеер для аудиокниг и альбомов', 'A player for audiobooks and albums')}</h1>
<p>${bis('Простой, быстрый, без интернета и рекламы. Всё хранится на вашем телефоне.', 'Simple and fast, with no internet and no ads. Everything stays on your phone.')}</p>
${play}<div class="sub">${bis('Android 7.0 и новее', 'Android 7.0 and newer')}</div></div>
<img class="fg" src="feature.png" alt="AudioShelf"></div></div>`;
const landing = `<section><div class="wrap"><h2>${bis('Что внутри', "What's inside")}</h2><div class="grid">${
  features.map(f => `<div class="card"><h3>${bis(f[0], f[1])}</h3><p>${bis(f[2], f[3])}</p></div>`).join('')}</div></div></section>
<section><div class="wrap"><h2>${bis('Бесплатно и Премиум', 'Free and Premium')}</h2><div class="plans">
<div class="card plan"><b>${bis('30 дней — всё открыто', '30 days — everything unlocked')}</b><p>${bis('Попробуйте все функции сразу после установки.', 'Try every feature right after installing.')}</p></div>
<div class="card plan"><b>${bis('Бесплатно', 'Free')}</b><p>${bis('Воспроизведение, библиотека, закладки, таймер сна, режимы «Книга» и «Альбом».', 'Playback, library, bookmarks, sleep timer, Book and Album modes.')}</p></div>
<div class="card plan"><b>${bis('Премиум навсегда', 'Premium for life')}</b><p>${bis('Эквалайзер, усиление, выравнивание громкости и визуализаторы. Разовая покупка, без подписки.', 'Equalizer, gain, loudness normalization and visualizers. One-time purchase, no subscription.')}</p></div>
</div><p style="color:var(--mute)">${bis('Можно угостить автора чаем или порадовать котика — это необязательно и ничего не открывает.', 'You can buy the author a cup of tea or treat the cat — optional, and it unlocks nothing.')}</p></div></section>
<section><div class="wrap"><h2>${bis('Приватность', 'Privacy')}</h2>
<p>${bis('У приложения нет аккаунтов, аналитики и собственных серверов. Библиотека и прослушивание остаются на устройстве. Подробнее: ', 'The app has no accounts, analytics or servers of its own. Your library and listening stay on your device. Details: ')}<a href="privacy.html">${bis('политика конфиденциальности', 'privacy policy')}</a>.</p></div></section>`;
fs.writeFileSync(path.join(out, 'index.html'), page('index.html',
  { ru: 'AudioShelf — плеер аудиокниг', en: 'AudioShelf — audiobook player', desc: 'AudioShelf: audiobook and album player for Android. No ads, no accounts, everything stays on your phone.' }, landing, { hero }));

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
<h2>${bis('Удаление данных', 'Data deletion')}</h2><p>${bis('У приложения нет аккаунтов и серверов. Чтобы удалить все данные, удалите приложение или очистите его данные в настройках Android. Покупки привязаны к аккаунту Google.', 'The app has no accounts or servers. To delete all data, uninstall the app or clear its data in Android settings. Purchases are tied to your Google account.')}</p></div></article>`;
fs.writeFileSync(path.join(out, 'support.html'), page('support.html', { ru: 'Поддержка', en: 'Support', desc: 'AudioShelf support and FAQ' }, supportBody));

// ---- licences ----
const lic = md(read('LICENSE.md').replace(/^# .*\n+/, '')) + md(read('THIRD_PARTY_NOTICES.md').replace(/^# .*\n+/, ''));
const texts = fs.readdirSync(path.join(root, 'licenses')).sort().map(f =>
  `<h2>${esc(f.replace(/\.txt$/, ''))}</h2><pre>${esc(read('licenses/' + f))}</pre>`).join('');
fs.writeFileSync(path.join(out, 'licenses.html'), page('licenses.html', { ru: 'Лицензии', en: 'Licences', desc: 'AudioShelf licences and third-party notices' },
  `<article><div class="wrap"><h1>${bis('Лицензии', 'Licences')}</h1><p style="color:var(--mute)">${bis('Тексты лицензий на английском языке.', 'Licence texts are in English.')}</p>${lic}${texts}</div></article>`));

console.log('site built:', fs.readdirSync(out).join(', '));
