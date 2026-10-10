// Every Russian text used through t() / plural() / data-i18n must have an English text, and no English text may be empty.
import fs from 'fs';
import { fileURLToPath } from 'url';
const WWW = fileURLToPath(new URL('../www', import.meta.url));
const { EN } = await import(WWW + '/js/i18n-en.js');
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log('  FAIL:', m); } else console.log('  ok:', m); };

const files = [...fs.readdirSync(WWW + '/js').filter(f => f.endsWith('.js') && !f.startsWith('i18n')).map(f => WWW + '/js/' + f), WWW + '/app.js', WWW + '/index.html'];
const used = new Set();
const cyr = /[А-Яа-яЁё]/;
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\bt\(\s*(?:[^'()]*\?\s*)?'((?:[^'\\]|\\.)*)'(?:\s*:\s*'((?:[^'\\]|\\.)*)')?/g)) for (const g of [m[1], m[2]]) if (g && cyr.test(g)) used.add(g);
  for (const m of s.matchAll(/plural\([^,]+,\s*'([^']*)',\s*'([^']*)',\s*'([^']*)'/g)) for (const g of [m[1], m[2], m[3]]) used.add(g);
  for (const m of s.matchAll(/data-i18n(?:-aria)?="([^"]*)"/g)) used.add(m[1]);
  for (const m of s.matchAll(/name:'([^']*)'/g)) if (cyr.test(m[1])) used.add(m[1]);
}
for (const k of ['Кольцо', 'Эквалайзер', 'Волны', 'объёмный', 'нейтральный']) used.add(k);
const missing = [...used].filter(k => !EN[k]);
ok(used.size > 150, `${used.size} texts are translated`);
ok(missing.length === 0, 'every text has an English version' + (missing.length ? ': ' + missing.join(' | ') : ''));
const bad = Object.entries(EN).filter(([k, v]) => !v || cyr.test(v) || (k.match(/\{\w+\}/g) || []).join() !== (v.match(/\{\w+\}/g) || []).join());
ok(bad.length === 0, 'English texts are non-empty, have no Russian letters and keep their {placeholders}' + (bad.length ? ': ' + bad.map(b => b[0]).join(' | ') : ''));
if (failures) { console.log('I18N FAILED'); process.exit(1); }
console.log('I18N OK');
