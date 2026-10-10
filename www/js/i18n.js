/* i18n.js — interface language. The Russian text itself is the key: t('Библиотека') returns it as is in Russian
 * and the English text from EN in English. {name} placeholders are filled from the second argument.
 * Language: the saved choice (Settings → Язык / Language), otherwise the phone's language (Russian-speaking → ru, else en). */
import { EN } from './i18n-en.js';

export const LANGS = ['auto', 'ru', 'en'];

function detect(){
  let saved = 'auto';
  try { saved = localStorage.getItem('lang') || 'auto'; } catch {}
  if(saved === 'ru' || saved === 'en') return saved;
  const nav = String((typeof navigator !== 'undefined' && navigator.language) || 'ru').toLowerCase();
  return /^(ru|uk|be|kk)/.test(nav) ? 'ru' : 'en';
}

let lang = detect();
export const getLang = () => lang;
export const getLangSetting = () => { try { return localStorage.getItem('lang') || 'auto'; } catch { return 'auto'; } };
export function setLangSetting(v){
  try { localStorage.setItem('lang', LANGS.includes(v) ? v : 'auto'); } catch {}
  lang = detect();
  applyDocumentLang();
}

export function t(s, p){
  let r = (lang === 'en' && EN[s]) || s;
  if(p) r = r.replace(/\{(\w+)\}/g, (m, k) => (p[k] ?? m));
  return r;
}

/** Russian has three plural forms (1 книга, 2 книги, 5 книг); English two (1 book, 2 books). The forms are dictionary keys. */
export function plural(n, a, b, c){
  if(lang === 'en') return t(Math.abs(n) === 1 ? a : c);
  const x = n % 10, y = n % 100;
  return t(x === 1 && y !== 11 ? a : x >= 2 && x <= 4 && (y < 10 || y >= 20) ? b : c);
}

/** Static texts in index.html carry data-i18n (text) / data-i18n-aria (aria-label) */
export function applyDocumentLang(){
  if(typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
}
