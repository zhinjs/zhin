/**
 * Preloaded into the measured instance by `scripts/measure-instance-memory.mjs` (`--import`).
 * Configuration comes from the `ZHIN_MEMORY_PROBE` environment variable (JSON). Records every
 * loaded `file:` module, samples after a full GC once the instance has settled and writes the
 * sample to `<reportDir>/baseline.json`; with `afterTurn` it then waits for the file
 * `<reportDir>/after-turn.go` and samples again into `after-turn.json`. Then it stops the instance.
 * With `heapSnapshot` set, each phase also writes a snapshot after the GC: the baseline to that
 * path, the after-turn one to `afterTurnSnapshotPath(path)` (`out.heapsnapshot` →
 * `out.after-turn.heapsnapshot`). A snapshot is about 0.7–1.5 times the heap used after GC. The
 * phase's JSON is written only after its snapshot is complete, so a missing JSON marks a partial file.
 */
import { registerHooks } from 'node:module';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import v8 from 'node:v8';
import { afterTurnSnapshotPath, parseProcKeyValues, readProcessTree, summarizeSmaps } from './instance-memory.mjs';

const config = JSON.parse(process.env.ZHIN_MEMORY_PROBE ?? '{}');
delete process.env.ZHIN_MEMORY_PROBE;
const loaded = new Set();
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:')) loaded.add(url);
    return nextLoad(url, context);
  },
});

const readText = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};
const proc = { list: () => { try { return readdirSync('/proc'); } catch { return []; } }, read: readText };

async function fullGc() {
  for (let i = 0; i < 6; i += 1) {
    globalThis.gc?.();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function sample(raw) {
  const result = {
    memory: process.memoryUsage(),
    heap: v8.getHeapStatistics(),
    ...(raw ? {} : { modules: [...loaded] }),
  };
  if (config.breakdown) {
    result.spaces = v8.getHeapSpaceStatistics();
    result.code = v8.getHeapCodeStatistics();
    if (process.platform === 'linux') {
      result.status = parseProcKeyValues(readText('/proc/self/status') ?? '');
      result.smapsRollup = parseProcKeyValues(readText('/proc/self/smaps_rollup') ?? '');
      result.mappings = summarizeSmaps(readText('/proc/self/smaps') ?? '', process.execPath);
      result.children = readProcessTree(process.pid, proc);
    }
  }
  return result;
}

async function phase(name, snapshotPath) {
  const beforeGc = sample(true);
  await fullGc();
  const report = { phase: name, beforeGc: { memory: beforeGc.memory, heapTotal: beforeGc.memory.heapTotal }, ...sample(false) };
  if (snapshotPath) {
    report.heapSnapshot = v8.writeHeapSnapshot(snapshotPath);
  }
  writeFileSync(join(config.reportDir, `${name}.json`), JSON.stringify(report));
}

const timer = setTimeout(async () => {
  await phase('baseline', config.heapSnapshot);
  if (!config.afterTurn) {
    process.kill(process.pid, 'SIGTERM');
    return;
  }
  const poll = setInterval(async () => {
    if (!existsSync(join(config.reportDir, 'after-turn.go'))) return;
    clearInterval(poll);
    await phase('after-turn', config.heapSnapshot ? afterTurnSnapshotPath(config.heapSnapshot) : undefined);
    process.kill(process.pid, 'SIGTERM');
  }, 200);
}, config.settleMs ?? 8000);
timer.unref();
