import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MigrationReadiness } from '../src/migrate/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('MigrationReadiness', () => {
  it('orders extraction before package cutover', async () => {
    const root = await project();
    await write(join(root, 'src/legacy.ts'), `
import { MessageCommand, usePlugin } from 'zhin.js';
const { addCommand } = usePlugin();
addCommand(new MessageCommand('status').action(() => 'ready'));
`);

    const report = await new MigrationReadiness().inspect(root);
    expect(report.state).toBe('extraction-required');
    expect(report.extraction).toEqual({ automatic: 1, manual: 0, errors: 0 });
    expect(report.cutover.state).toBe('required');
    expect(report.legacyImports).toHaveLength(1);
  });

  it('blocks on manual callback captures', async () => {
    const root = await project();
    await write(join(root, 'src/legacy.ts'), `
import { MessageCommand, usePlugin } from 'zhin.js';
const { addCommand } = usePlugin();
const captured = 'value';
addCommand(new MessageCommand('status').action(() => captured));
`);

    const report = await new MigrationReadiness().inspect(root);
    expect(report.state).toBe('blocked');
    expect(report.extraction.manual).toBe(1);
    expect(report.diagnostics[0]?.message).toContain('captures source bindings');
  });

  it('distinguishes dual-run, compat-only, and ready completed projects', async () => {
    const dualRun = await completedProject("import { MessageCommand } from 'zhin.js';\nvoid MessageCommand;\n");
    expect((await new MigrationReadiness().inspect(dualRun)).state).toBe('dual-run');

    const compat = await completedProject(
      "import { defineLegacyCommand } from '@zhin.js/next-compat';\nvoid defineLegacyCommand;\n",
    );
    expect((await new MigrationReadiness().inspect(compat)).state).toBe('compat');

    const ready = await completedProject('export const ready = true;\n');
    expect((await new MigrationReadiness().inspect(ready)).state).toBe('ready');
  });
});

async function project(extra: Record<string, unknown> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-readiness-'));
  temporary.push(root);
  await writeFile(join(root, 'package.json'), `${JSON.stringify({
    name: '@test/readiness',
    version: '0.0.0',
    type: 'module',
    ...extra,
  }, null, 2)}\n`);
  return root;
}

async function completedProject(source: string): Promise<string> {
  const root = await project({
    dependencies: {
      '@zhin.js/plugin-runtime': '^0.0.0',
      '@zhin.js/next-runtime': '^0.0.0',
    },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.next.ts',
      engine: '^1.0.0',
      runtime: 'trusted',
      features: [],
      plugins: [],
    },
  });
  await writeFile(join(root, 'plugin.next.ts'), [
    "import { definePlugin } from '@zhin.js/plugin-runtime';",
    '',
    "export default definePlugin({ name: 'readiness' });",
    '',
  ].join('\n'));
  await write(join(root, 'src/state.ts'), source);
  return root;
}

async function write(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value);
}
