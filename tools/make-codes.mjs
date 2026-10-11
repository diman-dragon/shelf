// Makes activation codes for testers (Premium forever):   node tools/make-codes.mjs 20
// The salt is the one in www/config.js, so every code made here is accepted by the app.
import CONFIG from '../www/config.js';
import { makeCode, randomPayload } from '../www/js/codes.js';

const n = Math.max(1, Math.min(500, Number(process.argv[2]) || 10));
const seen = new Set();
while (seen.size < n) seen.add(await makeCode(randomPayload(), CONFIG.premium.codeSalt));
console.log([...seen].join('\n'));
