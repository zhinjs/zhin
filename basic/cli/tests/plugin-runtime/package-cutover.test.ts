import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PackageCutover } from '../../src/plugin-runtime/migrate/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('package cutover', () => {
  it('derives providers and commits the entry and manifest as one retryable transition', async () => {
    const root = await fixture();
    await writeFile(join(root, 'commands/status.ts'), legacyCommandDefinition());
    await writeFile(join(root, 'middlewares/audit.ts'), legacyMiddlewareDefinition());
    await writeFile(join(root, 'components/card.tsx'), componentDefinition());
    const cutover = new PackageCutover();
    const plan = await cutover.plan(root);

    expect(plan.changed).toBe(true);
    expect(plan.capabilities).toEqual(['command', 'component', 'middleware']);
    expect(plan.dependencies).toMatchObject({
      existing: '^1.0.0',
      '@zhin.js/plugin-runtime': '^0.0.0',
      '@zhin.js/runtime': '^1.0.0',
      'zhin.js': '^4.1.2',
      '@zhin.js/command': '^0.0.0',
      '@zhin.js/component': '^0.0.0',
      '@zhin.js/middleware': '^0.0.0',
    });
    await expect(readFile(plan.entryFile, 'utf8')).rejects.toThrow();

    await cutover.apply(plan);
    const manifest = JSON.parse(await readFile(plan.packageFile, 'utf8')) as {
      zhin: { entry: string; features: Array<{ package: string }> };
    };
    expect(manifest.zhin.entry).toBe('./plugin.ts');
    expect(manifest.zhin.features.map((item) => item.package)).toEqual([
      '@zhin.js/command',
      '@zhin.js/component',
      '@zhin.js/middleware',
    ]);
    await expect(readFile(plan.entryFile, 'utf8')).resolves
      .toContain("definePlugin({ name: 'fixture-plugin' })");

    const repeated = await cutover.plan(root);
    expect(repeated.changed).toBe(false);
    await expect(cutover.apply(repeated)).resolves.toBeUndefined();

    await writeFile(plan.entryFile, [
      "import { definePlugin } from '@zhin.js/plugin-runtime';",
      '',
      "export default definePlugin({ name: 'fixture-plugin', metadata: { order: 1 } });",
      '',
    ].join('\n'));
    await expect(cutover.plan(root)).resolves.toMatchObject({ changed: false });
  });

  it('rejects package changes after planning and rolls back its new entry', async () => {
    const root = await fixture();
    const cutover = new PackageCutover();
    const plan = await cutover.plan(root);
    await writeFile(plan.packageFile, `${plan.originalPackage.trim()}\n `);

    await expect(cutover.apply(plan)).rejects.toThrow('changed after cutover planning');
    await expect(readFile(plan.entryFile, 'utf8')).rejects.toThrow();
  });

  it('rejects conflicting prepared entries and existing manifests', async () => {
    const root = await fixture();
    await writeFile(join(root, 'plugin.ts'), 'different');
    await expect(new PackageCutover().plan(root)).rejects.toThrow('different content');

    const manifested = await fixture({
      zhin: { protocol: 1, type: 'plugin', entry: './index.ts' },
    });
    await expect(new PackageCutover().plan(manifested)).rejects.toThrow('migrate it manually');
  });

  it('does not accept an incomplete manifest as an idempotent cutover', async () => {
    const root = await fixture({
      zhin: {
        protocol: 1,
        type: 'plugin',
        entry: './plugin.ts',
        features: [],
        plugins: [],
      },
    });
    await writeFile(join(root, 'commands/status.ts'), legacyCommandDefinition());
    await writeFile(join(root, 'plugin.ts'), [
      "import { definePlugin } from '@zhin.js/plugin-runtime';",
      '',
      "export default definePlugin({ name: 'fixture-plugin' });",
      '',
    ].join('\n'));

    await expect(new PackageCutover().plan(root)).rejects.toThrow(
      'does not match discovered capability directories',
    );
  });

  it('rejects a forged plan outside the project transaction files', async () => {
    const root = await fixture();
    const cutover = new PackageCutover();
    const plan = await cutover.plan(root);
    await expect(cutover.apply({
      ...plan,
      entryFile: join(root, 'protected.ts'),
    })).rejects.toThrow('Invalid package cutover paths');
  });
});

async function fixture(extra: Record<string, unknown> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-cutover-'));
  temporary.push(root);
  await Promise.all([
    writeFile(join(root, 'package.json'), `${JSON.stringify({
      name: '@test/fixture-plugin',
      version: '1.0.0',
      type: 'module',
      dependencies: { existing: '^1.0.0' },
      ...extra,
    }, null, 2)}\n`),
    mkdirSource(root, 'commands'),
    mkdirSource(root, 'middlewares'),
    mkdirSource(root, 'components'),
  ]);
  return root;
}

async function mkdirSource(root: string, name: string): Promise<void> {
  await mkdir(join(root, name), { recursive: true });
}

function legacyCommandDefinition(): string {
  return "import { defineCommand } from '@zhin.js/command';\n";
}

function legacyMiddlewareDefinition(): string {
  return "import { defineMiddleware } from '@zhin.js/middleware';\n";
}

function componentDefinition(): string {
  return "import { defineComponent } from '@zhin.js/component';\n";
}
