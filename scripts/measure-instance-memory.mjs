#!/usr/bin/env node
/**
 * Measures what a supervised Zhin instance keeps loaded (#1250): loaded module count, notable
 * packages (TypeScript compiler, @zhin.js/cli command tree, scaffold wizard, inquirer,
 * puppeteer-core), heap after a full GC and RSS.
 *
 * It starts the project's instance the way the gateway does — `zhin runtime start` with the
 * instance-child environment — but with `--standalone` so no gateway, platform account or IPC
 * channel is needed, waits for it to settle, samples it and stops it.
 *
 *   node scripts/measure-instance-memory.mjs [--project examples/minimal-bot | --with-pages]
 *        [--settle 8] [--source] [--json] [--verbose]
 *
 * --with-pages  sample a generated project (in the OS temp dir, resolving packages through
 *            examples/test-bot/node_modules) whose root plugin has Console pages — a pure
 *            Blueprint `.ts` page and a `.tsx` page — so the Console page builder runs at startup.
 * --source   run the workspace from TypeScript sources (tsx + `development` condition); the
 *            default runs the built `lib/` output (run `pnpm build` first).
 * --keep     keep the temporary directory (generated project, built Console modules).
 * --settle   seconds to wait after start before sampling (default 8; covers the 2 s idle release
 *            of the Console metadata worker).
 * Compare before/after by running it on two checkouts.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const repo = resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const settleMs = Number(option('--settle', '8')) * 1000;
const source = flag('--source');

const work = mkdtempSync(join(tmpdir(), 'zhin-instance-memory-'));
const project = flag('--with-pages') ? createPagesProject(join(work, 'project')) : resolve(repo, option('--project', 'examples/minimal-bot'));

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
const reportFile = join(work, 'report.json');
const probeFile = join(work, 'probe.mjs');
writeFileSync(probeFile, `
import { registerHooks } from 'node:module';
import { writeFileSync } from 'node:fs';
import { getHeapStatistics } from 'node:v8';
const loaded = new Set();
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:')) loaded.add(url);
    return nextLoad(url, context);
  },
});
const timer = setTimeout(async () => {
  for (let i = 0; i < 6; i += 1) { globalThis.gc?.(); await new Promise((r) => setImmediate(r)); }
  const memory = process.memoryUsage();
  const urls = [...loaded];
  const count = (pattern) => urls.filter((url) => pattern.test(url)).length;
  writeFileSync(${JSON.stringify(reportFile)}, JSON.stringify({
    modules: urls.length,
    packages: {
      typescript: count(/\\/typescript\\/lib\\//u),
      'zhin-cli': count(/\\/basic\\/cli\\/|\\/@zhin\\.js\\/cli\\//u),
      'zhin-cli-commands': count(/\\/basic\\/cli\\/(?:src|lib)\\/commands\\/|\\/@zhin\\.js\\/cli\\/lib\\/commands\\//u),
      'scaffold-wizard': count(/scaffold-wizard\\//u),
      inquirer: count(/\\/(?:@inquirer|inquirer)\\//u),
      'puppeteer-core': count(/\\/puppeteer-core\\//u),
    },
    heapUsedMB: +(memory.heapUsed / 1048576).toFixed(1),
    rssMB: +(memory.rss / 1048576).toFixed(1),
    externalMB: +(memory.external / 1048576).toFixed(1),
    totalHeapSizeMB: +(getHeapStatistics().total_heap_size / 1048576).toFixed(1),
  }));
  process.kill(process.pid, 'SIGTERM');
}, ${settleMs});
timer.unref();
`);

const cliEntry = source ? join(repo, 'basic/cli/src/cli.ts') : join(repo, 'basic/cli/lib/cli.js');
if (!existsSync(cliEntry)) {
  console.error(`missing ${cliEntry}; run pnpm build (or pass --source)`);
  process.exit(2);
}
const nodeArgs = ['--expose-gc'];
if (source) {
  const tsx = createRequire(join(repo, 'package.json')).resolve('tsx/esm');
  nodeArgs.push('--conditions', 'development', '--import', pathToFileURL(tsx).href);
}
nodeArgs.push('--import', pathToFileURL(probeFile).href, cliEntry, 'runtime', 'start', '--standalone', '--no-watch');

const child = spawn(process.execPath, nodeArgs, {
  cwd: project,
  env: { ...process.env, ZHIN_RUNTIME_CHILD: '1', NODE_ENV: 'production', HTTP_PORT: process.env.HTTP_PORT ?? '0' },
  stdio: ['ignore', flag('--verbose') ? 'inherit' : 'ignore', flag('--verbose') ? 'inherit' : 'ignore'],
});
const hardStop = setTimeout(() => child.kill('SIGKILL'), settleMs + 30_000);
child.on('exit', (code, signal) => {
  clearTimeout(hardStop);
  let report;
  try {
    report = JSON.parse(readFileSync(reportFile, 'utf8'));
  } catch {
    console.error(`instance exited (code ${code}, signal ${signal}) before it was sampled; rerun with --verbose`);
    rmSync(work, { recursive: true, force: true });
    process.exit(1);
  }
  try {
    report.consoleClientModules = readdirSync(join(project, '.zhin/client')).filter((name) => name.endsWith('.js')).length;
  } catch {
    report.consoleClientModules = 0;
  }
  if (flag('--keep')) process.stderr.write(`kept ${work}\n`);
  else rmSync(work, { recursive: true, force: true });
  if (flag('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write([
    `project: ${project} (${source ? 'sources' : 'lib'})`,
    `modules loaded: ${report.modules} (Console client modules built: ${report.consoleClientModules})`,
    ...Object.entries(report.packages).map(([name, n]) => `  ${name}: ${n} files`),
    `heap used after GC: ${report.heapUsedMB} MB (total heap ${report.totalHeapSizeMB} MB)`,
    `rss: ${report.rssMB} MB, external: ${report.externalMB} MB`,
  ].join('\n') + '\n');
});
