// Runs every test file in this folder one after another; exits non-zero if any fails.
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
const dir = fileURLToPath(new URL('.', import.meta.url));
let failed = 0;
for (const f of ['smoke.mjs', 'visualizer.mjs', 'db-writes.mjs']) {
  console.log(`\n##### ${f}`);
  const r = spawnSync(process.execPath, ['--no-warnings', dir + f], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} test file(s) FAILED` : '\nAll test files passed');
process.exit(failed ? 1 : 0);
