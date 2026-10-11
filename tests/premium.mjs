// Premium: 30-day trial, codes, purchases, and what is locked without it (no DOM needed except localStorage).
import { JSDOM } from 'jsdom';
import { fileURLToPath, pathToFileURL } from 'url';
const WWW = fileURLToPath(new URL('../www', import.meta.url));
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://localhost/' });
for (const k of ['window', 'document', 'localStorage', 'navigator']) Object.defineProperty(globalThis, k, { value: k === 'window' ? dom.window : dom.window[k], configurable: true, writable: true });
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log('  FAIL:', m); } else console.log('  ok:', m); };
const imp = f => import(pathToFileURL(WWW + f).href);

const P = await imp('/js/premium.js');
const { makeCode, randomPayload, verifyCode, normalize } = await imp('/js/codes.js');
const CONFIG = (await imp('/config.js')).default;
const DAY = 86400000;

console.log('== trial');
ok(P.status() === 'trial' && P.isPremium(), 'the first launch starts the trial: everything is open');
ok(P.trialDaysLeft() === 30, 'it is 30 days (' + P.trialDaysLeft() + ')');
P._reset({ start: Date.now() - 29.5 * DAY });
ok(P.status() === 'trial' && P.trialDaysLeft() === 1, 'day 30: one day left');
P._reset({ start: Date.now() - 31 * DAY });
ok(P.status() === 'free' && !P.isPremium(), 'after 30 days: free');

console.log('== setting the clock back does not extend the trial');
P._reset({ start: Date.now() - 40 * DAY, seen: Date.now() + 5 * DAY });
ok(P.status() === 'free', 'still free with a clock set back');

console.log('== purchase');
P._reset({ start: Date.now() - 40 * DAY });
let changes = 0; P.onChange(() => changes++);
P.setOwned('play');
ok(P.status() === 'owned' && P.isPremium() && changes === 1, 'a Play purchase unlocks Premium and tells the listeners');
P.clearOwned('code'); ok(P.status() === 'owned', 'withdrawing a code does not touch a Play purchase');
P.clearOwned('play'); ok(P.status() === 'free', 'a refund takes the Play unlock away');

console.log('== activation codes');
const salt = CONFIG.premium.codeSalt;
const code = await makeCode(randomPayload(), salt);
ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), 'code looks like XXXX-XXXX-XXXX: ' + code);
ok(await verifyCode(code, salt), 'a made code verifies');
ok(await verifyCode(code.toLowerCase().replace(/-/g, ' '), salt), 'typed in lower case with spaces it still verifies');
ok(!(await verifyCode(code.slice(0, -1) + (code.endsWith('A') ? 'B' : 'A'), salt)), 'one wrong character does not');
ok(!(await verifyCode(code, 'another salt')), 'a code from another salt does not');
ok(normalize('abc') === '' && normalize('') === '', 'junk is not a code');
ok(!(await P.redeem('AAAA-AAAA-AAAA')), 'a made-up code is refused');
ok(P.status() === 'free', 'and nothing changes');
ok(await P.redeem(code) && P.status() === 'owned' && P.ownedVia() === 'code', 'a good code unlocks Premium forever');
P.clearOwned('play'); ok(P.status() === 'owned', 'a refund of a Play purchase leaves a tester untouched');

console.log('== billing wrapper without Google Play');
const B = await imp('/js/billing.js');
ok(!B.billingAvailable() && (await B.loadProducts()) === null && (await B.syncPurchases()) === false, 'no plugin: "not available", nothing breaks');
P._reset({ start: Date.now() - 40 * DAY });
globalThis.window.Capacitor = { Plugins: { ShelfBilling: {
  listeners: {}, addListener(e, f) { this.listeners[e] = f; },
  getProducts: async () => ({ products: [{ id: 'premium_lifetime', price: '4,99 €', title: 'Premium' }] }),
  restore: async () => ({ ok: true, owned: ['premium_lifetime'] }),
  buy: async () => ({})
} } };
ok((await B.loadProducts())[0].price === '4,99 €', 'prices come from the plugin');
ok(await B.syncPurchases() && P.status() === 'owned', 'a purchase found at start unlocks Premium');
globalThis.window.Capacitor.Plugins.ShelfBilling.restore = async () => ({ ok: true, owned: [] });
ok(await B.syncPurchases() && P.status() === 'free', 'a purchase Google no longer knows (refund) is withdrawn');
globalThis.window.Capacitor.Plugins.ShelfBilling.restore = async () => ({ ok: false });
P.setOwned('play');
await B.syncPurchases(); ok(P.status() === 'owned', 'no answer from Google is not "nothing owned"');
const seen = []; B.onPurchase(e => seen.push(e));
P.clearOwned('play');
globalThis.window.Capacitor.Plugins.ShelfBilling.listeners.purchase({ id: 'premium_lifetime', status: 'purchased' });
ok(P.status() === 'owned' && seen.length === 1, 'a finished purchase event unlocks Premium');
globalThis.window.Capacitor.Plugins.ShelfBilling.listeners.purchase({ id: 'tip_tea', status: 'purchased' });
ok(seen.length === 2, 'a tip event reaches the screen (and unlocks nothing)');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nPREMIUM OK');
process.exit(failures ? 1 : 0);
