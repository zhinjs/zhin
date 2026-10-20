import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url));
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const directory = resolve(root, 'test-results/database-real', runId);
await mkdir(directory, { recursive: true });
const filename = join(directory, 'acceptance.sqlite');
const results = [];
for (const phase of ['write', 'restart', 'lock-check']) {
  const result = await new Promise((done, reject) => {
    const child = spawn(process.execPath, [join(root, 'scripts/database-acceptance/sqlite-child.mjs'), phase, filename], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let timedOut = false;
    child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 10_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => { clearTimeout(timer); done({ phase, code, signal, timedOut, stdout, stderr }); });
  });
  results.push(result);
  await writeFile(join(directory, `${phase}.json`), JSON.stringify(result, null, 2));
  assert.equal(result.code, 0, `${phase} did not exit normally: ${result.stderr}`);
  assert.equal(result.signal, null); assert.equal(result.timedOut, false);
  assert.match(result.stdout, /"databaseClosed":true,"ok":true/);
}
await writeFile(join(directory, 'summary.json'), JSON.stringify({ node: process.version, filename, results, evidence: 'real-node-child-processes', remoteDialects: 'unverified' }, null, 2));
console.log(JSON.stringify({ ok: true, directory, filename, phases: results.map(({ phase, code }) => ({ phase, code })) }, null, 2));
