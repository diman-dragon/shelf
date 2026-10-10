// Version consistency: the packages that must move together, the lock file, and the Android SDK levels Google Play asks for.
import fs from 'fs'; import { fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = p => fs.readFileSync(ROOT + p, 'utf8');
const pkg = JSON.parse(read('package.json')), lock = JSON.parse(read('package-lock.json'));
let fail = 0; const ok = (c, m) => { if (!c) fail++; console.log(c ? '  ok:' : '  FAIL:', m); };

const deps = pkg.dependencies || {};
const cap = Object.entries(deps).filter(([k]) => k.startsWith('@capacitor/'));
ok(cap.every(([, v]) => /^\d+\.\d+\.\d+$/.test(v)), 'Capacitor packages are pinned exactly: ' + cap.map(([k, v]) => `${k.split('/')[1]} ${v}`).join(', '));
// android, cli and core are released together and must be the same version (the app plugin has its own number)
const same = ['android', 'cli', 'core'].map(n => deps['@capacitor/' + n]);
ok(new Set(same).size === 1, '@capacitor/android, cli and core are one version: ' + same.join(' / '));
ok(lock.version === pkg.version && lock.packages[''].version === pkg.version, `package-lock.json carries the app version ${pkg.version}`);
for (const [k, v] of Object.entries({ ...deps, ...(pkg.devDependencies || {}) })) {
  const l = lock.packages['node_modules/' + k]?.version;
  ok(l === v || (l && /^[\^~]/.test(v)), `lock matches package.json for ${k} (${v} -> ${l})`);
}
// the tests' own lock
const tpkg = JSON.parse(read('tests/package.json')), tlock = JSON.parse(read('tests/package-lock.json'));
for (const k of Object.keys(tpkg.devDependencies || {})) ok(!!tlock.packages['node_modules/' + k], `tests/package-lock.json has ${k}`);

// Android: SDK levels (Google Play needs a recent target) and Media3 modules on one version
const vars = read('android/variables.gradle'), num = n => +(vars.match(new RegExp(n + '\\s*=\\s*(\\d+)')) || [])[1];
const target = num('targetSdkVersion'), compile = num('compileSdkVersion'), min = num('minSdkVersion');
ok(target >= 35, `targetSdk ${target} meets the Google Play requirement (35+)`);
ok(compile >= target, `compileSdk ${compile} >= targetSdk ${target}`);
ok(min >= 21 && min <= target, `minSdk ${min} is sane`);
const gradle = read('android/app/build.gradle');
const media = [...gradle.matchAll(/androidx\.media3:media3-[\w-]+:\$media3Version/g)];
ok(media.length >= 3 && !/androidx\.media3:media3-[\w-]+:\d/.test(gradle), 'all Media3 modules use the single media3Version');
ok(/versionName pkg\.version/.test(gradle), 'versionName/versionCode come from package.json');
console.log(fail ? `${fail} FAILURE(S)` : 'VERSIONS OK'); process.exit(fail ? 1 : 0);
