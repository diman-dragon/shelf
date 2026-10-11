/* premium.js — what the person may use right now. Pure state, no screens (those are in premium-ui.js).
 *   trial    the first 30 days after the first launch: everything is open
 *   owned    "Premium forever": bought in Google Play ('play') or unlocked with a tester's code ('code')
 *   free     the rest: everything except the premium features (sound shaping, boost, loudness leveling, visualizers)
 * The record lives in localStorage. It is not hardened against tampering on purpose: patches and new features matter more. */
import CONFIG from '../config.js';
import { verifyCode, normalize } from './codes.js';

const KEY = 'premium.v1';
const DAY = 86400000;
export const TRIAL_DAYS = Number(CONFIG.premium?.trialDays) || 30;
export const PRODUCTS = CONFIG.premium.products;
/** Everything that asks for Premium. The key is used for the sheet's wording and for tests. */
export const FEATURES = ['sound', 'boost', 'normalize', 'visualizer', 'download'];

let rec = load();
const listeners = new Set();

function load(){
  let r = null;
  try { r = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
  if(!r || !Number.isFinite(r.start)){
    r = { start: Date.now(), seen: Date.now(), owned: '', code: '' };   // the first launch starts the trial
    persist(r);
  }
  return r;
}

function persist(r = rec){ try { localStorage.setItem(KEY, JSON.stringify(r)); } catch {} }

/** "Now", but never earlier than the latest moment seen: setting the clock back does not extend the trial */
function now(){
  const n = Date.now();
  if(n > rec.seen){
    if(n - rec.seen > 3600000){ rec.seen = n; persist(); }
    return n;
  }
  return rec.seen;
}

export function trialDaysLeft(){
  return Math.max(0, Math.ceil((rec.start + TRIAL_DAYS * DAY - now()) / DAY));
}

/** 'owned' | 'trial' | 'free' */
export function status(){
  if(rec.owned) return 'owned';
  return trialDaysLeft() > 0 ? 'trial' : 'free';
}

export const isPremium = () => status() !== 'free';
export const ownedVia = () => rec.owned;

function emit(){ listeners.forEach(fn => { try { fn(status()); } catch {} }); }
export function onChange(fn){ listeners.add(fn); return () => listeners.delete(fn); }

/** via: 'play' (bought in Google Play) or 'code' */
export function setOwned(via, code = ''){
  if(rec.owned === via && rec.code === code) return;
  rec.owned = via; rec.code = code;
  persist(); emit();
}

/** A purchase that Google no longer knows (refund): only a Play unlock is withdrawn, a tester's code stays */
export function clearOwned(via){
  if(rec.owned !== via) return;
  rec.owned = ''; rec.code = '';
  persist(); emit();
}

/** true = accepted and Premium is on now */
export async function redeem(input){
  if(!normalize(input)) return false;
  let ok = false;
  try { ok = await verifyCode(input, CONFIG.premium.codeSalt); } catch {}
  if(ok) setOwned('code', normalize(input));
  return ok;
}

/** Tests only: start over */
export function _reset(patch = {}){
  rec = { start: Date.now(), seen: Date.now(), owned: '', code: '', ...patch };
  persist(); emit();
}
