import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MigrationReadiness,
  migrationStatusExitCode,
} from '../../src/plugin-runtime/migrate/index.js';

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
    const compatReport = await new MigrationReadiness().inspect(compat);
    expect(compatReport.state).toBe('compat');
    expect(migrationStatusExitCode(compatReport)).toBe(1);

    const ready = await completedProject('export const ready = true;\n');
    const readyReport = await new MigrationReadiness().inspect(ready);
    expect(readyReport.state).toBe('ready');
    expect(migrationStatusExitCode(readyReport)).toBe(0);
  });

  it('repository gate ignores legacy fixtures but rejects legacy calls in native plugin functions', async () => {
    const root = await nativeProject();
    await write(join(root, 'tests/legacy.test.ts'), 'void usePlugin();\n');
    await write(join(root, 'legacy-fixture.ts'), [
      '// zhin-migration-gate: legacy-fixture',
      'export const fixture = () => getPlugin();',
      '',
    ].join('\n'));
    expect(runMigrationGate(root).status).toBe(0);

    await write(join(root, 'commands/status.ts'), [
      'export default {',
      '  async execute() {',
      '    return getPlugin();',
      '  },',
      '};',
      '',
    ].join('\n'));
    const result = runMigrationGate(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('commands/status.ts:3:12 legacy getPlugin() call in function scope');
  });

  it('repository gate requires a JavaScript manifest entry for published plugins', async () => {
    const root = await project({
      zhin: {
        protocol: 1,
        type: 'plugin',
        entry: './plugin.ts',
      },
    });
    await write(join(root, 'plugin.ts'), "export default { name: 'published' };\n");

    const result = runMigrationGate(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('published Plugin Runtime package must use a JavaScript entry');
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
    private: true,
    dependencies: {
      '@zhin.js/plugin-runtime': 'latest',
      '@zhin.js/runtime': 'latest',
      'zhin.js': 'latest',
    },
    devDependencies: {
      '@zhin.js/cli': 'latest',
      typescript: 'latest',
    },
    scripts: {
      dev: 'zhin runtime start',
      start: 'zhin runtime start',
      daemon: 'zhin runtime start --daemon',
      build: 'tsc --noEmit',
    },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      engine: '^1.0.0',
      runtime: 'trusted',
      features: [],
      plugins: [],
    },
  });
  await writeFile(join(root, 'plugin.ts'), [
    "import { definePlugin } from '@zhin.js/plugin-runtime';",
    '',
    "export default definePlugin({ name: 'readiness' });",
    '',
  ].join('\n'));
  await write(join(root, 'src/state.ts'), source);
  return root;
}

async function nativeProject(): Promise<string> {
  const root = await project({
    private: true,
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
    },
  });
  await write(join(root, 'plugin.ts'), "export default { name: 'native' };\n");
  return root;
}

function runMigrationGate(root: string): { readonly status: number | null; readonly stderr: string } {
  const script = fileURLToPath(new URL('../../../../scripts/check-plugin-runtime-migration-readiness.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--root', root], {
    cwd: root,
    encoding: 'utf8',
  });
  return { status: result.status, stderr: result.stderr };
}

async function write(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value);
}
