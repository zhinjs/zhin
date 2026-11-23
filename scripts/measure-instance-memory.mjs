#!/usr/bin/env node
/**
 * Measures what a supervised Zhin instance keeps loaded (#1250, ADR 0068 P0): loaded module count,
 * notable packages (TypeScript compiler, @zhin.js/cli command tree, scaffold wizard, inquirer,
 * puppeteer-core), heap after a full GC and RSS; optionally where the RSS goes.
 *
 * It starts the project's instance the way the gateway does — `zhin runtime start` with the
 * instance-child environment — but with `--standalone` so no gateway, platform account or IPC
 * channel is needed, waits for it to settle, samples it and stops it.
 *
 * By default the project is copied to a temporary directory first (its own files, without
 * node_modules — linked instead —, `.zhin/`, `data/`, `tests/` and `.env*`), so the instance does
 * not read the project's `.env`, does not share `.zhin/` or the SQLite database with a dev instance
 * running in the project, and leaves no state there. The copied `zhin.config.yml` is still read:
 * adapters and services configured in it may still connect; use --config to replace it.
 *
 *   node scripts/measure-instance-memory.mjs [--project examples/minimal-bot | --with-pages]
 *        [--config file.yml] [--in-place] [--settle 8] [--source] [--json] [--verbose] [--keep]
 *        [--breakdown] [--top 15] [--heap-snapshot out.heapsnapshot]
 *        [--after-turn] [--turns 3] [--idle 10] [--host-tmpdir]
 *
 * --with-pages  sample a generated project (in the OS temp dir, resolving packages through
 *            examples/test-bot/node_modules) whose root plugin has Console pages — a pure
 *            Blueprint `.ts` page and a `.tsx` page — so the Console page builder runs at startup.
 * --config   use this file as the copied project's `zhin.config.yml` (e.g. examples/test-bot/
 *            zhin.config.example.yml) instead of the project's own.
 * --in-place  run in the project directory itself instead of a copy, as `zhin start` would: the
 *            instance reads the project's `.env` and leaves its `.zhin/` state there. Not with
 *            --config / --after-turn / --with-pages.
 * --source   run the workspace from TypeScript sources (tsx + `development` condition); the
 *            default runs the built `lib/` output (run `pnpm build` first).
 * --keep     keep the temporary directory (generated project, built Console modules, reports).
 * --settle   seconds to wait after start before sampling (default 8; covers the 2 s idle release
 *            of the Console metadata worker).
 * --breakdown  also report the RSS composition: process.memoryUsage(), V8 heap spaces, code
 *            statistics, /proc status / smaps_rollup / smaps grouped by mapping (Linux), child
 *            processes (esbuild, workers) and loaded modules by origin / package / convention dir.
 * --heap-snapshot <path>  write a heap snapshot after the GC and print the top classes by self size
 *            (with --after-turn a second one: the path with its `.heapsnapshot` suffix replaced by
 *            `.after-turn.heapsnapshot`, so `out.heapsnapshot` → `out.after-turn.heapsnapshot`).
 *            A snapshot is about 0.7–1.5 times the heap used after GC; delete it when done. The
 *            script reads it back into one Buffer (not streamed), so it cannot analyse a snapshot
 *            of 2 GiB or more. Writing one leaves the process with more RSS, so compare RSS from
 *            runs without it. An interrupted run deletes a snapshot that was not finished.
 * --top      how many packages / snapshot classes to list (default 15 packages, 30 classes).
 * --after-turn  write the terminal adapter of examples/minimal-bot, patched to send an endpointId,
 *            to the copy's `adapters/terminal/index.ts` (replacing the project's own), point an
 *            `ai.plan.yml` at a local fake OpenAI-compatible server, send
 *            --turns messages on stdin, wait --idle seconds and sample again (before and after GC).
 * --host-tmpdir  let the instance use the host's temp dir. By default it gets an empty TMPDIR in the
 *            work dir, because tsx (registered once a project has a `.tsx` file) reads the whole
 *            listing of its disk cache `<tmpdir>/tsx-<uid>` into the heap — on a developer machine
 *            that can be hundreds of thousands of entries and tens of MB, which a fresh production
 *            host does not have.
 * The temporary directory is removed on every exit path (unless --keep); Ctrl+C exits with 130,
 * SIGTERM with 143.
 * Compare before/after by running it on two checkouts.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  afterTurnSnapshotPath, aggregateHeapSnapshot, assertHeapSnapshotReadable, attributeRss, groupModules, isSourceModule, mb,
  parseHeapSnapshot, parseMeasureArgs, RSS_ATTRIBUTION_NOTE, sourceStringBytes,
} from './lib/instance-memory.mjs';

const repo = resolve(import.meta.dirname, '..');
let options;
try {
  options = parseMeasureArgs(process.argv.slice(2));
} catch (error) {
  console.error(`${error.message}\nusage: see the header of scripts/measure-instance-memory.mjs`);
  process.exit(2);
}
const settleMs = options.settleSeconds * 1000;
const { source } = options;

// Everything that can fail without side effects is checked before the work dir exists.
const cliEntry = source ? join(repo, 'basic/cli/src/cli.ts') : join(repo, 'basic/cli/lib/cli.js');
if (!existsSync(cliEntry)) {
  console.error(`missing ${cliEntry}; run pnpm build (or pass --source)`);
  process.exit(2);
}
const sourceProject = resolve(repo, options.project);
if (!options.withPages && !existsSync(join(sourceProject, 'package.json'))) {
  console.error(`--project ${options.project}: no package.json in ${sourceProject}`);
  process.exit(2);
}
const configFile = options.config ? resolve(options.config) : undefined;
if (configFile && !existsSync(configFile)) {
  console.error(`--config ${options.config}: no such file`);
  process.exit(2);
}
const heapSnapshot = options.heapSnapshot ? resolve(options.heapSnapshot) : undefined;

const work = mkdtempSync(join(tmpdir(), 'zhin-instance-memory-'));
const reportDir = join(work, 'reports');
/** @type {import('node:child_process').ChildProcess | undefined} */
let child;
let fake;
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (options.keep) process.stderr.write(`kept ${work}\n`);
  else rmSync(work, { recursive: true, force: true });
}
// Every exit path — a normal end, process.exit(), an uncaught error while copying the project or
// summarizing — stops the instance and removes the work dir.
process.on('exit', () => {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  cleanup();
});
// Ctrl+C or an outer timeout: stop the instance, drop unfinished snapshots; the exit hook removes the work dir.
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    child?.kill('SIGKILL');
    fake?.server.close();
    removeUnfinishedSnapshots();
    process.exit(code);
  });
}

/**
 * A phase's JSON is written only after its snapshot is complete (instance-memory-probe.mjs), so a
 * snapshot without its JSON was cut off by the interrupt (or is a stale file this run would have overwritten).
 */
function removeUnfinishedSnapshots() {
  if (!heapSnapshot) return;
  const phases = [['baseline', heapSnapshot], ...(options.afterTurn ? [['after-turn', afterTurnSnapshotPath(heapSnapshot)]] : [])];
  for (const [phase, path] of phases) {
    if (!existsSync(join(reportDir, `${phase}.json`))) rmSync(path, { force: true });
  }
}

let project;
try {
  mkdirSync(reportDir);
  project = options.withPages
    ? createPagesProject(join(work, 'project'))
    : options.inPlace ? sourceProject : copyProject(sourceProject, join(work, 'project'));
} catch (error) {
  console.error(`could not prepare the project: ${error.message}`);
  process.exit(1);
}

function createPagesProject(dir) {
  const write = (path, text) => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  mkdirSync(dir, { recursive: true });
  symlinkSync(join(repo, 'examples/test-bot/node_modules'), join(dir, 'node_modules'), 'dir');
  write('package.json', JSON.stringify({
    name: 'zhin-memory-fixture',
    private: true,
    type: 'module',
    dependencies: { 'zhin.js': 'workspace:*', '@zhin.js/page': 'workspace:*' },
    zhin: {
      protocol: 1,
      type: 'plugin',
      engine: '^1.0.0',
      runtime: 'trusted',
      features: [{ package: '@zhin.js/page', api: '^1.0.0' }],
    },
  }, null, 2));
  write('zhin.config.yml', 'configVersion: 2\nplugins: {}\n');
  write('pages/status/index.ts', [
    "import { definePage, createAdapterConsolePage } from '@zhin.js/page';",
    "export const meta = definePage({ title: 'Status', icon: 'Activity', order: 1 });",
    "export default createAdapterConsolePage('sandbox');",
  ].join('\n'));
  write('pages/about/index.tsx', [
    "import { definePage } from '@zhin.js/page';",
    "export const meta = definePage({ title: 'About', order: 2 });",
    'export default function About() { return <main>About</main>; }',
  ].join('\n'));
  return dir;
}

/**
 * Copies the project's own files (not node_modules, state, tests or `.env*`) and links its
 * node_modules. `zhin.config.yml` is copied unless --config replaces it.
 */
function copyProject(from, dir) {
  const skip = new Set(['node_modules', '.zhin', 'data', 'tests', ...(configFile ? ['zhin.config.yml'] : [])]);
  mkdirSync(dir, { recursive: true });
  for (const entry of readdirSync(from)) {
    if (skip.has(entry) || entry === '.env' || entry.startsWith('.env.')) continue;
    cpSync(join(from, entry), join(dir, entry), { recursive: true });
    if (/^tsconfig.*\.json$/u.test(entry)) {
      // Keep a relative `extends` (../../tsconfig.base.json) pointing at the original location.
      const text = readFileSync(join(from, entry), 'utf8').replace(/("extends"\s*:\s*")(\.\.?\/[^"]+)"/u,
        (_, head, target) => `${head}${resolve(from, target).replaceAll('\\', '/')}"`);
      writeFileSync(join(dir, entry), text);
    }
  }
  symlinkSync(join(from, 'node_modules'), join(dir, 'node_modules'), 'dir');
  if (configFile) writeFileSync(join(dir, 'zhin.config.yml'), readFileSync(configFile, 'utf8'));
  if (options.afterTurn) prepareTurnProject(dir);
  return dir;
}

/**
 * Writes the minimal-bot terminal adapter to the copy's `adapters/terminal/index.ts` — added if the
 * project has none, replacing the project's own otherwise — patched to send an endpointId: the
 * example adapter sends none, and the Agent ingress requires one for a turn.
 */
function prepareTurnProject(dir) {
  const terminal = join(dir, 'adapters/terminal/index.ts');
  mkdirSync(dirname(terminal), { recursive: true });
  const example = join(repo, 'examples/minimal-bot/adapters/terminal/index.ts');
  const original = readFileSync(example, 'utf8');
  const needle = "sender: { id: 'local-user' } })";
  if (!original.includes(needle)) {
    throw new Error(`${example} no longer contains \`${needle}\`; update prepareTurnProject() to add the endpointId`);
  }
  writeFileSync(terminal, original.replace(needle, "sender: { id: 'local-user' }, endpointId: 'terminal' })"));
  const configPath = join(dir, 'zhin.config.yml');
  let config = existsSync(configPath) ? readFileSync(configPath, 'utf8') : 'configVersion: 2\nplugins: {}\n';
  // The terminal adapter reads stdin by default (`plugin.terminal.interactive` defaults to true).
  if (!/^ai:/mu.test(config)) config += '\nai:\n  enabled: true\n  trigger:\n    respondToPrivate: true\n';
  writeFileSync(configPath, config);
}

function writeAiPlan(dir, port) {
  writeFileSync(join(dir, 'ai.plan.yml'), [
    'version: 1',
    'services:',
    '  fake:',
    '    driver: ollama',
    '    options:',
    `      baseUrl: http://127.0.0.1:${port}/v1`,
    '    models:',
    '      fake-model:',
    '        id: fake-model',
    '        kinds: [language]',
    '        protocol: openai-chat',
    '        input: [text]',
    '        streaming: true',
    '        toolCalling: true',
    'accounts:',
    '  bot:',
    '    service: fake',
    '    auth:',
    '      method: none',
    'profiles:',
    '  daily:',
    '    account: bot',
    '    model: fake-model',
    'purposes:',
    '  chat:',
    '    profile: daily',
    '',
  ].join('\n'));
}

/** A local OpenAI-compatible endpoint that answers every chat completion with a short reply. */
function startFakeModel() {
  const stats = { requests: 0, completions: 0, promptBytes: 0 };
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      stats.requests += 1;
      if (!request.url.includes('chat/completions')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ object: 'list', data: [{ id: 'fake-model', object: 'model' }] }));
        return;
      }
      stats.completions += 1;
      stats.promptBytes += body.length;
      if (options.keep) writeFileSync(join(reportDir, `request-${stats.completions}.json`), body);
      let parsed = {};
      try { parsed = JSON.parse(body); } catch { /* keep defaults */ }
      const base = { id: `chatcmpl-${stats.completions}`, created: Math.floor(Date.now() / 1000), model: 'fake-model' };
      const usage = { prompt_tokens: Math.ceil(body.length / 4), completion_tokens: 60, total_tokens: Math.ceil(body.length / 4) + 60 };
      // First call of a turn asks for one tool (discover) so the tool loop runs too; the call after
      // the tool result answers in the structured reply format the IM harness requests.
      const last = parsed.messages?.at(-1);
      const toolNames = (parsed.tools ?? []).map((tool) => tool.function?.name);
      const toolCall = last?.role !== 'tool' && toolNames.includes('discover')
        ? { id: `call_${stats.completions}`, type: 'function', function: { name: 'discover', arguments: JSON.stringify({ query: 'echo', kind: 'tool' }) } }
        : undefined;
      const text = `这是测量脚本的假模型回复 #${stats.completions}。`.repeat(8);
      const content = toolCall ? '' : parsed.response_format
        ? JSON.stringify({ messages: [{ segments: [{ type: 'text', data: { text } }] }] })
        : text;
      const finish = toolCall ? 'tool_calls' : 'stop';
      if (parsed.stream) {
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        const send = (payload) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
        const delta = toolCall ? { role: 'assistant', tool_calls: [{ index: 0, ...toolCall }] } : { role: 'assistant', content };
        send({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] });
        send({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: finish }], usage });
        response.end('data: [DONE]\n\n');
        return;
      }
      const message = toolCall ? { role: 'assistant', content: null, tool_calls: [toolCall] } : { role: 'assistant', content };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ...base, object: 'chat.completion', choices: [{ index: 0, message, finish_reason: finish }], usage }));
    });
  });
  return new Promise((resolveServer) => server.listen(0, '127.0.0.1', () => resolveServer({ server, port: server.address().port, stats })));
}

fake = options.afterTurn ? await startFakeModel() : undefined;
if (fake) writeAiPlan(project, fake.port);

const nodeArgs = ['--expose-gc'];
if (source) {
  const tsx = createRequire(join(repo, 'package.json')).resolve('tsx/esm');
  nodeArgs.push('--conditions', 'development', '--import', pathToFileURL(tsx).href);
}
nodeArgs.push('--import', pathToFileURL(join(repo, 'scripts/lib/instance-memory-probe.mjs')).href, cliEntry, 'runtime', 'start', '--standalone', '--no-watch');

const childTmp = join(work, 'tmp');
mkdirSync(childTmp);
const probe = { reportDir, settleMs, breakdown: options.breakdown, afterTurn: options.afterTurn, ...(heapSnapshot ? { heapSnapshot } : {}) };
let output = '';
child = spawn(process.execPath, nodeArgs, {
  cwd: project,
  env: {
    ...process.env, ZHIN_RUNTIME_CHILD: '1', NODE_ENV: 'production', HTTP_PORT: process.env.HTTP_PORT ?? '0',
    ZHIN_MEMORY_PROBE: JSON.stringify(probe),
    ...(options.hostTmpdir ? {} : { TMPDIR: childTmp, TMP: childTmp, TEMP: childTmp }),
  },
  stdio: [options.afterTurn ? 'pipe' : 'ignore', options.verbose ? 'inherit' : 'pipe', options.verbose ? 'inherit' : 'ignore'],
});
child.stdout?.on('data', (chunk) => { output = (output + chunk).slice(-20_000); });
child.stdin?.on('error', () => { /* the instance exited while a turn was being sent */ });
const turnBudgetMs = options.afterTurn ? options.turns * 60_000 + options.idleSeconds * 1000 : 0;
const hardStop = setTimeout(() => child.kill('SIGKILL'), settleMs + 60_000 + turnBudgetMs);

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
const turnLog = [];
if (options.afterTurn) void driveTurns();

async function driveTurns() {
  while (!existsSync(join(reportDir, 'baseline.json'))) {
    if (child.exitCode !== null) return;
    await delay(200);
  }
  for (let turn = 1; turn <= options.turns; turn += 1) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const before = fake.stats.completions;
    const startedAt = Date.now();
    child.stdin.write(`请简单介绍一下你自己（测量回合 ${turn}）\n`);
    while (fake.stats.completions === before && Date.now() - startedAt < 45_000) await delay(100);
    // The turn is over once no further completion arrives for 3 s (tool loop, outbound chain, bookkeeping).
    let seen = fake.stats.completions;
    let quietSince = Date.now();
    while (Date.now() - quietSince < 3000 && Date.now() - startedAt < 55_000) {
      await delay(200);
      if (fake.stats.completions !== seen) { seen = fake.stats.completions; quietSince = Date.now(); }
    }
    turnLog.push({ turn, completions: fake.stats.completions - before, ms: Date.now() - startedAt });
  }
  await delay(options.idleSeconds * 1000);
  writeFileSync(join(reportDir, 'after-turn.go'), '');
}

child.on('exit', (code, signal) => {
  clearTimeout(hardStop);
  fake?.server.close();
  try {
    finish(code, signal);
  } catch (error) {
    console.error(`could not summarize the samples: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  } finally {
    cleanup();
  }
});

function finish(code, signal) {
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(join(reportDir, 'baseline.json'), 'utf8'));
  } catch {
    console.error(`instance exited (code ${code}, signal ${signal}) before it was sampled; rerun with --verbose\n${output.slice(-4000)}`);
    process.exit(1);
  }
  let afterTurn;
  if (options.afterTurn) {
    try {
      afterTurn = JSON.parse(readFileSync(join(reportDir, 'after-turn.json'), 'utf8'));
    } catch {
      console.error(`instance exited (code ${code}, signal ${signal}) before the after-turn sample`);
    }
  }
  const report = summarize(baseline);
  try {
    report.consoleClientModules = readdirSync(join(project, '.zhin/client')).filter((name) => name.endsWith('.js')).length;
  } catch {
    report.consoleClientModules = 0;
  }
  if (afterTurn) {
    report.afterTurn = {
      turns: turnLog,
      fakeModel: { completions: fake.stats.completions, requests: fake.stats.requests, promptKB: Math.round(fake.stats.promptBytes / 1024) },
      ...summarize(afterTurn, baseline),
    };
    if (!fake.stats.completions) report.afterTurn.warning = 'the fake model received no chat completion; the AI turn did not run (rerun with --verbose)';
    // writeHeapSnapshot() itself needs native memory the process keeps afterwards.
    else if (heapSnapshot) report.afterTurn.warning = 'RSS after the turns includes the memory of writing the first heap snapshot; compare RSS without --heap-snapshot';
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${formatText(report)}\n`);
}

function summarize(sample, previous) {
  const urls = sample.modules;
  const count = (pattern) => urls.filter((url) => pattern.test(url)).length;
  const report = {
    phase: sample.phase,
    modules: urls.length,
    packages: {
      typescript: count(/\/typescript\/lib\//u),
      'zhin-cli': count(/\/basic\/cli\/|\/@zhin\.js\/cli\//u),
      'zhin-cli-commands': count(/\/basic\/cli\/(?:src|lib)\/commands\/|\/@zhin\.js\/cli\/lib\/commands\//u),
      'scaffold-wizard': count(/scaffold-wizard\//u),
      inquirer: count(/\/(?:@inquirer|inquirer)\//u),
      'puppeteer-core': count(/\/puppeteer-core\//u),
    },
    heapUsedMB: mb(sample.memory.heapUsed),
    rssMB: mb(sample.memory.rss),
    externalMB: mb(sample.memory.external),
    totalHeapSizeMB: mb(sample.heap.total_heap_size),
    heapTotalBeforeGcMB: mb(sample.beforeGc.heapTotal),
    rssBeforeGcMB: mb(sample.beforeGc.memory.rss),
  };
  if (previous) {
    report.delta = {
      modules: urls.length - previous.modules.length,
      heapUsedMB: mb(sample.memory.heapUsed - previous.memory.heapUsed),
      heapTotalMB: mb(sample.memory.heapTotal - previous.memory.heapTotal),
      rssMB: mb(sample.memory.rss - previous.memory.rss),
      newModules: urls.filter((url) => !previous.modules.includes(url)).slice(0, 40).map((url) => shortPath(url)),
    };
  }
  if (options.breakdown) report.breakdown = breakdown(sample);
  if (sample.heapSnapshot) report.heapSnapshot = summarizeSnapshot(sample.heapSnapshot);
  return report;
}

function summarizeSnapshot(path) {
  const size = statSync(path).size;
  try {
    assertHeapSnapshotReadable(size, path);
  } catch (error) {
    return { path, sizeMB: mb(size), error: error.message };
  }
  const started = Date.now();
  // The whole file in one Buffer (at most 2 GiB), scanned in place — not a streaming parse.
  const aggregate = aggregateHeapSnapshot(parseHeapSnapshot(readFileSync(path)), Math.max(options.top, 30));
  return {
    path,
    sizeMB: mb(size),
    parseMs: Date.now() - started,
    nodes: aggregate.nodes,
    totalSelfSizeMB: mb(aggregate.totalSelfSize),
    largeStrings: { ...aggregate.largeStrings, mb: mb(aggregate.largeStrings.bytes) },
    top: aggregate.top.map((item) => ({ name: item.name, count: item.count, selfSizeMB: mb(item.selfSize), share: round(item.share) })),
    details: Object.fromEntries(Object.entries(aggregate.details).map(([name, items]) => [name,
      items.map((item) => ({ name: item.name, count: item.count, selfSizeMB: mb(item.selfSize) }))])),
    retainedBy: Object.fromEntries(Object.entries(aggregate.retainedBy ?? {}).map(([name, items]) => [name,
      items.map((item) => ({ name: item.name, count: item.count, selfSizeMB: mb(item.selfSize) }))])),
  };
}

function breakdown(sample) {
  const packageCache = new Map();
  const packageOf = (file) => {
    let dir = dirname(file);
    const visited = [];
    while (dir !== dirname(dir)) {
      if (packageCache.has(dir)) break;
      visited.push(dir);
      const manifest = join(dir, 'package.json');
      if (existsSync(manifest)) {
        try {
          const { name } = JSON.parse(readFileSync(manifest, 'utf8'));
          if (name) { packageCache.set(dir, { name, root: dir }); break; }
        } catch { /* keep walking */ }
      }
      dir = dirname(dir);
    }
    const found = packageCache.get(dir);
    for (const item of visited) packageCache.set(item, found);
    return found;
  };
  const files = sample.modules.map((url) => {
    const path = fileURLToPath(url.replace(/\?.*$/u, ''));
    // Only JS / TS module source is kept as a V8 source string; `.json` and `.node` are not counted.
    if (!isSourceModule(path)) return { path, size: 0, source: false };
    try {
      const text = readFileSync(path, 'utf8');
      const strings = sourceStringBytes(text);
      return { path, size: statSync(path).size, heapBytes: strings.bytes, twoByte: strings.twoByte, escapedBytes: strings.escaped };
    } catch {
      return { path, size: 0 }; // virtual or removed
    }
  });
  const realProject = realpathSync(project);
  const modules = groupModules(files, { project: realProject, packageOf }, options.top);
  const toMB = (object) => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, typeof value === 'number' ? mb(value) : value]));
  const result = {
    memoryUsageMB: toMB(sample.memory),
    heapStatisticsMB: toMB(pick(sample.heap, ['total_heap_size', 'total_physical_size', 'used_heap_size', 'heap_size_limit',
      'malloced_memory', 'peak_malloced_memory', 'external_memory', 'total_global_handles_size'])),
    nativeContexts: sample.heap.number_of_native_contexts,
    detachedContexts: sample.heap.number_of_detached_contexts,
    heapSpacesMB: (sample.spaces ?? []).map((space) => ({ space: space.space_name, size: mb(space.space_size), used: mb(space.space_used_size), physical: mb(space.physical_space_size) })),
    codeMB: toMB(sample.code ?? {}),
    rssAttribution: attributeRss(sample).rows.map((row) => ({ item: row.item, mb: mb(row.bytes), share: round(row.share) })),
    rssAttributionNote: RSS_ATTRIBUTION_NOTE,
    modules: {
      total: modules.total,
      nonSourceFiles: files.filter((file) => file.source === false).length,
      sourceMB: mb(modules.bytes),
      sourceStringsMB: mb(modules.heapBytes),
      sourceStringsIfAsciiEscapedMB: mb(modules.escapedBytes),
      twoByteFiles: modules.twoByteFiles,
      origins: Object.fromEntries(Object.entries(modules.origins).map(([key, value]) => [key, { ...value, bytes: undefined, sourceMB: mb(value.bytes) }])),
      conventions: Object.fromEntries(Object.entries(modules.conventions).map(([key, value]) => [key, { files: value.files, sourceKB: Math.round(value.bytes / 1024) }])),
      topPackages: Object.fromEntries(Object.entries(modules.topPackages).map(([key, list]) => [key,
        list.map((item) => ({ package: item.package, files: item.files, sourceKB: Math.round(item.bytes / 1024), stringsKB: Math.round(item.heapBytes / 1024) }))])),
    },
  };
  if (sample.status) {
    result.procStatusMB = toMB(pick(sample.status, ['VmRSS', 'VmHWM', 'RssAnon', 'RssFile', 'RssShmem', 'VmData', 'VmSwap']));
    result.threads = sample.status.Threads;
    result.smapsRollupMB = toMB(pick(sample.smapsRollup, ['Rss', 'Pss', 'Private_Dirty', 'Private_Clean', 'Shared_Clean', 'Shared_Dirty', 'Anonymous', 'Swap']));
    result.mappings = sample.mappings.slice(0, 8).map((item) => ({ mapping: item.mapping, count: item.count, rssMB: mb(item.rss), privateDirtyMB: mb(item.privateDirty) }));
    result.childProcesses = sample.children.map((item) => ({ pid: item.pid, command: item.command || item.name, rssMB: mb(item.rss) }));
  }
  return result;
}

function pick(object, keys) {
  return Object.fromEntries(keys.filter((key) => object?.[key] !== undefined).map((key) => [key, object[key]]));
}
const round = (value) => Math.round(value * 1000) / 1000;
function shortPath(url) {
  const path = url.replace(/^file:\/\//u, '').replace(/\?.*$/u, '');
  return path.startsWith(repo) ? path.slice(repo.length + 1) : path;
}

function formatText(report) {
  const lines = [
    `project: ${options.withPages ? 'generated pages project' : `${sourceProject} (${options.inPlace ? 'in place' : 'copied to a temp dir'})`} (${source ? 'sources' : 'lib'})`,
    ...formatSample(report),
  ];
  if (report.afterTurn) {
    const after = report.afterTurn;
    lines.push('', `after ${after.turns.length} AI turn(s) (fake model: ${after.fakeModel.completions} completions, ${after.fakeModel.promptKB} KB prompts)${after.warning ? ` — ${after.warning}` : ''}`);
    lines.push(`  before GC: heapTotal ${after.heapTotalBeforeGcMB} MB, rss ${after.rssBeforeGcMB} MB`);
    lines.push(`  delta vs. baseline after GC: modules +${after.delta.modules}, heapUsed ${after.delta.heapUsedMB} MB, heapTotal ${after.delta.heapTotalMB} MB, rss ${after.delta.rssMB} MB`);
    lines.push(...formatSample(after).map((line) => `  ${line}`));
  }
  return lines.join('\n');
}

function formatSample(report) {
  const lines = [
    `modules loaded: ${report.modules} (Console client modules built: ${report.consoleClientModules ?? '-'})`,
    ...Object.entries(report.packages).map(([name, n]) => `  ${name}: ${n} files`),
    `heap used after GC: ${report.heapUsedMB} MB (total heap ${report.totalHeapSizeMB} MB; heapTotal before GC ${report.heapTotalBeforeGcMB} MB)`,
    `rss: ${report.rssMB} MB, external: ${report.externalMB} MB`,
  ];
  const b = report.breakdown;
  if (b) {
    const table = (rows, columns) => rows.map((row) => `  ${columns.map((column) => String(row[column] ?? '')).join('  |  ')}`);
    lines.push('', 'RSS attribution (approximate):', ...table(b.rssAttribution.map((row) => ({ ...row, share: `${(row.share * 100).toFixed(1)}%` })), ['item', 'mb', 'share']));
    lines.push(`  note: ${b.rssAttributionNote}`);
    lines.push('', `process.memoryUsage (MB): ${JSON.stringify(b.memoryUsageMB)}`);
    lines.push(`V8 heap statistics (MB): ${JSON.stringify(b.heapStatisticsMB)}; native contexts ${b.nativeContexts}, detached ${b.detachedContexts}`);
    lines.push(`V8 code statistics (MB): ${JSON.stringify(b.codeMB)}`);
    lines.push('V8 heap spaces (size / used / physical MB):', ...b.heapSpacesMB.filter((space) => space.size > 0).map((space) => `  ${space.space}: ${space.size} / ${space.used} / ${space.physical}`));
    if (b.procStatusMB) {
      lines.push(`/proc status (MB): ${JSON.stringify(b.procStatusMB)}; threads ${b.threads}`);
      lines.push(`/proc smaps_rollup (MB): ${JSON.stringify(b.smapsRollupMB)}`);
      lines.push('mappings by RSS:', ...table(b.mappings, ['mapping', 'count', 'rssMB', 'privateDirtyMB']));
      lines.push(`child processes: ${b.childProcesses.length ? '' : 'none'}`, ...table(b.childProcesses, ['pid', 'command', 'rssMB']));
    }
    lines.push('', `modules: ${b.modules.total} files (${b.modules.nonSourceFiles} .json / .node / other not counted as source), ${b.modules.sourceMB} MB source on disk, about ${b.modules.sourceStringsMB} MB as V8 source strings (${b.modules.twoByteFiles} files are two-byte: non-Latin-1 text; ${b.modules.sourceStringsIfAsciiEscapedMB} MB if that text were \\u-escaped)`);
    for (const [origin, value] of Object.entries(b.modules.origins)) lines.push(`  ${origin}: ${value.files} files in ${value.packages} packages, ${value.sourceMB} MB`);
    lines.push(`  convention directories: ${Object.entries(b.modules.conventions).map(([name, value]) => `${name} ${value.files}`).join(', ') || 'none'}`);
    for (const [origin, list] of Object.entries(b.modules.topPackages)) {
      if (!list.length) continue;
      lines.push(`  top ${origin} packages:`, ...list.map((item) => `    ${item.package}: ${item.files} files, ${item.sourceKB} KB (${item.stringsKB} KB as strings)`));
    }
  }
  const s = report.heapSnapshot;
  if (s?.error) lines.push('', `heap snapshot ${s.path} (${s.sizeMB} MB) not analysed: ${s.error}`);
  else if (s) {
    lines.push('', `heap snapshot ${s.path} (${s.sizeMB} MB, ${s.nodes} nodes, self size ${s.totalSelfSizeMB} MB; strings of 16 KB or more: ${s.largeStrings.count} = ${s.largeStrings.mb} MB)`);
    lines.push(...s.top.map((item) => `  ${item.name}: ${item.selfSizeMB} MB (${(item.share * 100).toFixed(1)}%, ${item.count})`));
    for (const [name, items] of Object.entries(s.details)) {
      lines.push(`  inside ${name}:`, ...items.map((item) => `    ${item.name}: ${item.selfSizeMB} MB (${item.count})`));
    }
    for (const [name, items] of Object.entries(s.retainedBy)) {
      lines.push(`  ${name} by first retainer:`, ...items.map((item) => `    ${item.name}: ${item.selfSizeMB} MB (${item.count})`));
    }
  }
  return lines;
}
