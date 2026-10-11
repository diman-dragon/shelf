/* billing.js — Google Play Billing from the web side. All the work is in the native ShelfBilling plugin (BillingPlugin.java);
 * without it (a browser, a phone without Google Play) every call answers "not available" and the app simply stays on trial / free. */
import { PRODUCTS, setOwned, clearOwned } from './premium.js';

const P = () => window.Capacitor?.Plugins?.ShelfBilling || null;
export const billingAvailable = () => !!P();

let listeners = [];
let hooked = false;
function hook(){
  const p = P();
  if(hooked || !p) return;
  hooked = true;
  p.addListener('purchase', e => {
    if(e?.status === 'purchased' && e.id === PRODUCTS.premium) setOwned('play');
    listeners.forEach(fn => { try { fn(e); } catch {} });
  });
}

/** {id, status: 'purchased' | 'pending' | 'canceled' | 'error', message?} — one event per finished purchase flow */
export function onPurchase(fn){ hook(); listeners.push(fn); return () => { listeners = listeners.filter(x => x !== fn); }; }

/** Prices come from Google Play (in the person's currency). null = Play is not available. */
export async function loadProducts(){
  const p = P();
  if(!p) return null;
  try { const r = await p.getProducts(); return r?.products || []; } catch { return null; }
}

export async function buy(id){
  const p = P();
  if(!p) return { ok: false };
  hook();
  try { await p.buy({ id }); return { ok: true }; } catch(e) { return { ok: false, message: e?.message || '' }; }
}

/** Asks Google what is owned. Called quietly at start and by "Restore". Returns true if the answer was received. */
export async function syncPurchases(){
  const p = P();
  if(!p) return false;
  hook();
  try {
    const r = await p.restore();
    if(!r?.ok) return false;                     // no answer is not "nothing owned": nothing is withdrawn
    if((r.owned || []).includes(PRODUCTS.premium)) setOwned('play');
    else clearOwned('play');
    return true;
  } catch { return false; }
}
