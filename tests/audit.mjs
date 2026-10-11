// Release audit: licenses, files, manifest, secrets, leftovers. Fails the build when something is off.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const has = f => fs.existsSync(path.join(ROOT, f));
const walk = (d, out = []) => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { if (['node_modules', '.git', 'build'].includes(e.name)) continue; const p = d + '/' + e.name; e.isDirectory() ? walk(p, out) : out.push(p); } return out; };
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log('  FAIL:', m); } else console.log('  ok:', m); };
const files = walk('.').map(f => f.replace(/^\.\//, ''));

console.log('== licenses');
const notices = rd('THIRD_PARTY_NOTICES.md');
for (const name of ['Capacitor', 'Media3', 'AndroidX', 'idb-keyval', 'Play Billing']) ok(notices.includes(name), `THIRD_PARTY_NOTICES mentions ${name}`);
ok(has('LICENSE.md') && /DataLaw/.test(rd('LICENSE.md')), 'the app has its own LICENSE.md (DataLaw)');
const uiJs = rd('www/js/ui.js');
for (const name of ['Capacitor', 'idb-keyval', 'Play']) ok(uiJs.includes(name), `the in-app licenses screen mentions ${name}`);
const idb = rd('www/lib/idb-keyval.js');
ok(/Apache|Jake Archibald|idb-keyval/i.test(idb.slice(0, 600)) || has('www/lib/LICENSE-idb-keyval.txt'), 'idb-keyval carries its license note');

console.log('== manifest');
const mf = rd('android/app/src/main/AndroidManifest.xml');
ok(/usesCleartextTraffic="false"/.test(mf), 'no cleartext traffic');
const perms = [...mf.matchAll(/uses-permission android:name="([^"]+)"/g)].map(m => m[1].replace('android.permission.', ''));
const allowed = new Set(['FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'FOREGROUND_SERVICE_DATA_SYNC', 'POST_NOTIFICATIONS', 'WAKE_LOCK', 'INTERNET']);
ok(perms.every(p => allowed.has(p)), 'only the declared permissions: ' + perms.join(', '));
const exported = [...mf.matchAll(/<(activity|service|receiver)[^>]*android:name="([^"]+)"[^>]*android:exported="true"/g)].map(m => m[2]);
ok(exported.sort().join() === '.MainActivity,.PlayerService', 'only the activity and the media service are exported: ' + exported.join(', '));
ok(/foregroundServiceType="mediaPlayback"/.test(mf) && /foregroundServiceType="dataSync"/.test(mf), 'foreground service types are declared');

console.log('== secrets and keys');
const keys = files.filter(f => /\.(jks|keystore|p12|pem)$/.test(f));
ok(keys.length === 1 && keys[0] === 'android/ci-debug.keystore', 'the only key in the project is the debug one: ' + keys.join(', '));
ok(!has('android/keystore.properties'), 'no keystore.properties');
const text = files.filter(f => /\.(js|mjs|java|gradle|xml|yml|json|md|properties)$/.test(f) && !f.includes('package-lock') && !f.startsWith('tests/audit'));
const leaks = text.filter(f => /(BEGIN (RSA |EC )?PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|AIza[0-9A-Za-z_-]{30,})/.test(rd(f)));
ok(leaks.length === 0, 'no private keys / tokens in text files' + (leaks.length ? ': ' + leaks.join(', ') : ''));

console.log('== leftovers');
const code = files.filter(f => /^(www\/(js|app\.js)|android\/app\/src\/main\/java)/.test(f));
const todo = code.filter(f => /\b(TODO|FIXME|XXX|HACK)\b/.test(rd(f)));
ok(todo.length === 0, 'no TODO / FIXME in the code' + (todo.length ? ': ' + todo.join(', ') : ''));
const logs = code.filter(f => f.startsWith('www') && /console\.(log|debug)\(/.test(rd(f)));
ok(logs.length === 0, 'no console.log in the web code' + (logs.length ? ': ' + logs.join(', ') : ''));
const jsFiles = files.filter(f => /^www\/js\/.+\.js$/.test(f));
const allJs = jsFiles.concat('www/app.js').map(rd).join('\n');
const orphan = jsFiles.filter(f => !allJs.includes('/' + path.basename(f)) && !allJs.includes("'./" + path.basename(f)));
ok(orphan.length === 0, 'every web module is used' + (orphan.length ? ': ' + orphan.join(', ') : ''));
const big = files.filter(f => fs.statSync(path.join(ROOT, f)).size > 1.5e6 && !f.endsWith('.jar'));
ok(big.length === 0, 'no file over 1.5 MB' + (big.length ? ': ' + big.join(', ') : ''));

console.log('== store');
const png = f => { const b = fs.readFileSync(path.join(ROOT, f)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
ok(png('store/graphics/icon-512.png').join('x') === '512x512', 'store icon is 512x512');
ok(png('store/graphics/feature-graphic-1024x500.png').join('x') === '1024x500', 'feature graphic is 1024x500');
for (const f of ['store/PRIVACY_POLICY.md', 'store/LISTING_RU.md', 'store/LISTING_EN.md', 'store/PLAY_CONSOLE_ANSWERS.md', 'store/RELEASE_CHECKLIST.md']) ok(has(f), f + ' exists');
const pol = rd('store/PRIVACY_POLICY.md');
ok(/Google Play/.test(pol) && /реклам/i.test(pol) && /advertis/i.test(pol), 'the policy covers payments through Google Play and advertising (RU + EN)');
ok(!/не выполняет сетевых запросов/.test(pol), 'the policy no longer claims "no network requests"');

console.log('== billing');
const vars = rd('android/variables.gradle');
ok(Number((vars.match(/billingVersion\s*=\s*'(\d+)\./) || [])[1]) >= 8, 'Play Billing Library 8 or newer (required by Google Play)');
ok(/products/.test(rd('www/config.js')) && /premium_lifetime/.test(rd('www/config.js')) && /premium_lifetime/.test(rd('android/app/src/main/java/com/shelf/player/BillingPlugin.java')), 'product ids match in the web config and in the plugin');
for (const id of ['tip_tea', 'tip_cat_treat', 'tip_cat_food']) ok(rd('android/app/src/main/java/com/shelf/player/BillingPlugin.java').includes(id) && rd('www/config.js').includes(id), `tip product ${id} is in both places`);

if (failures) { console.log('\nAUDIT FAILED'); process.exit(1); }
console.log('\nAUDIT OK');
