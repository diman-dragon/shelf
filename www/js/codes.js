/* codes.js — activation codes for early testers. Pure functions, no DOM, no storage: shared by the app, tools/make-codes.mjs and the tests.
 * A code is 12 letters/digits written ASCT-XXXX-XXXX: 8 random characters + 4 characters of check (SHA-256 of salt + payload).
 * It is checked right on the phone, no server. Anyone who digs the salt out of the app can make codes: that is accepted on purpose. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I: codes are read aloud and typed by hand

async function check(payload, salt){
  const data = new TextEncoder().encode(salt + ':' + payload);
  const h = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data));
  let out = '';
  for(let i = 0; i < 4; i++) out += ALPHABET[h[i] % ALPHABET.length];
  return out;
}

/** payload = 8 characters from ALPHABET → 'XXXX-XXXX-XXXX' */
export async function makeCode(payload, salt){
  const c = payload + await check(payload, salt);
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;
}

export function randomPayload(){
  const r = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return Array.from(r, b => ALPHABET[b % ALPHABET.length]).join('');
}

/** Typed with spaces / dashes / lower case → 12 characters, or '' when it cannot be a code */
export function normalize(input){
  const c = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 12 && [...c].every(ch => ALPHABET.includes(ch)) ? c : '';
}

export async function verifyCode(input, salt){
  const c = normalize(input);
  if(!c) return false;
  return (await check(c.slice(0, 8), salt)) === c.slice(8);
}
