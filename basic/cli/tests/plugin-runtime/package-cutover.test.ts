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
    await writeFile(join(root, 'commands/status/index.ts'), legacyCommandDefinition());
    await writeFile(join(root, 'middlewares/audit/index.ts'), legacyMiddlewareDefinition());
    await writeFile(join(root, 'components/card/index.tsx'), componentDefinition());
    const cutover = new PackageCutover();
    const plan = await cutover.plan(root);

    expect(plan.changed).toBe(true);
    expect(plan.mode).toBe('development');
    expect(plan.manifestEntry).toBe('./plugin.ts');
    expect(plan.capabilities).toEqual(['command', 'component', 'middleware']);
    expect(plan.dependencies).toMatchObject({
      existing: '^1.0.0',
      '@zhin.js/runtime': 'latest',
      'zhin.js': 'latest',
      '@zhin.js/command': 'latest',
      '@zhin.js/component': 'latest',
      '@zhin.js/middleware': 'latest',
    });
    expect(plan.dependencies['@zhin.js/plugin-runtime']).toBeUndefined();
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
      "import { definePlugin } from 'zhin.js';",
      '',
      "export default definePlugin({ name: 'fixture-plugin', metadata: { order: 1 } });",
      '',
    ].join('\n'));
    await expect(cutover.plan(root)).resolves.toMatchObject({ changed: false });
  });

  it('emits a publishable JavaScript package golden manifest for a public plugin', async () => {
    const root = await fixture({ private: false, scripts: { dev: 'zhin dev', build: 'zhin build' } });
    await writeFile(join(root, 'commands/status/index.ts'), legacyCommandDefinition());
    const plan = await new PackageCutover().plan(root);

    expect({
      mode: plan.mode,
      manifestEntry: plan.manifestEntry,
      buildConfig: plan.buildConfigFile && join(root, 'tsconfig.zhin.json') === plan.buildConfigFile,
      package: JSON.parse(plan.candidatePackage),
    }).toMatchInlineSnapshot(`
      {
        "buildConfig": true,
        "manifestEntry": "./plugin.js",
        "mode": "publish",
        "package": {
          "dependencies": {
            "@zhin.js/command": "latest",
            "@zhin.js/runtime": "latest",
            "existing": "^1.0.0",
            "zhin.js": "latest",
          },
          "devDependencies": {
            "@zhin.js/cli": "latest",
            "typescript": "latest",
          },
          "files": [
            "plugin.js",
            "plugin.d.ts",
            "commands",
            "components",
            "middlewares",
            "src",
            "schema.json",
            "README.md",
          ],
          "name": "@test/fixture-plugin",
          "private": false,
          "scripts": {
            "build": "pnpm run zhin:build",
            "daemon": "zhin start --mode production --no-watch",
            "dev": "zhin start --foreground --watch source config",
            "prepack": "pnpm run zhin:build",
            "prepublishOnly": "pnpm run zhin:build",
            "start": "zhin start --foreground --mode production --no-watch",
            "zhin:build": "tsc -p tsconfig.zhin.json",
          },
          "type": "module",
          "version": "1.0.0",
          "zhin": {
            "engine": "^1.0.0",
            "entry": "./plugin.js",
            "features": [
              {
                "api": "^1.0.0",
                "package": "@zhin.js/command",
              },
            ],
            "plugins": [],
            "protocol": 1,
            "runtime": "trusted",
            "type": "plugin",
          },
        },
      }
    `);
    expect(plan.buildConfigContent).toContain('"module": "NodeNext"');

    await new PackageCutover().apply(plan);
    await expect(readFile(join(root, 'plugin.ts'), 'utf8')).resolves.toContain('definePlugin');
    await expect(readFile(join(root, 'tsconfig.zhin.json'), 'utf8')).resolves.toContain('commands/**/*.ts');
    await expect(new PackageCutover().plan(root)).resolves.toMatchObject({
      changed: false,
      mode: 'publish',
      manifestEntry: './plugin.js',
    });
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

  it('repairs capability declarations in an existing Plugin manifest', async () => {
    const root = await fixture({
      zhin: {
        protocol: 1,
        type: 'plugin',
        entry: './plugin.ts',
        features: [],
        plugins: [],
      },
    });
    await writeFile(join(root, 'commands/status/index.ts'), legacyCommandDefinition());
    await writeFile(join(root, 'plugin.ts'), [
      "import { definePlugin } from 'zhin.js';",
      '',
      "export default definePlugin({ name: 'fixture-plugin', metadata: { displayName: 'Fixture' } });",
      '',
    ].join('\n'));
    const entryBefore = await readFile(join(root, 'plugin.ts'), 'utf8');

    const cutover = new PackageCutover();
    const plan = await cutover.plan(root);

    expect(plan.changed).toBe(true);
    expect(plan.dependencies).toMatchObject({
      '@zhin.js/command': 'latest',
      'zhin.js': 'latest',
    });
    expect((JSON.parse(plan.candidatePackage) as {
      zhin: { features: Array<{ package: string }> };
    }).zhin.features).toEqual([
      { package: '@zhin.js/command', api: '^1.0.0' },
    ]);

    await cutover.apply(plan);
    await expect(readFile(join(root, 'plugin.ts'), 'utf8')).resolves.toBe(entryBefore);
    await expect(cutover.plan(root)).resolves.toMatchObject({ changed: false });
  });

  it('moves the CLI of an old bot project into dependencies next to zhin.js and adds the gateway', async () => {
    const root = await fixture({
      dependencies: { existing: '^1.0.0', 'zhin.js': '^1.1.0' },
      devDependencies: { '@zhin.js/cli': '^1.1.20', typescript: '^5.0.0', '@types/node': '^22.0.0' },
    });
    const plan = await new PackageCutover().plan(root);
    const candidate = JSON.parse(plan.candidatePackage) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const gatewayVersion = (JSON.parse(await readFile(
      join(import.meta.dirname, '../../../../packages/host/gateway/package.json'),
      'utf8',
    )) as { version: string }).version;

    expect(plan.mode).toBe('development');
    expect(candidate.dependencies).toMatchObject({
      existing: '^1.0.0',
      'zhin.js': '^1.1.0',
      '@zhin.js/cli': '^1.1.20',
      '@zhin.js/gateway': `^${gatewayVersion}`,
    });
    expect(plan.dependencies['@zhin.js/gateway']).toBe(`^${gatewayVersion}`);
    expect(candidate.devDependencies).toEqual({ typescript: '^5.0.0', '@types/node': '^22.0.0' });

    await new PackageCutover().apply(plan);
    await expect(new PackageCutover().plan(root)).resolves.toMatchObject({ changed: false });
  });

  it('keeps declared stack versions, reuses the CLI dist-tag for the gateway and dedupes devDependencies', async () => {
    const tagged = await fixture({
      devDependencies: { '@zhin.js/cli': 'next', 'zhin.js': '^1.1.0' },
    });
    const taggedPlan = JSON.parse((await new PackageCutover().plan(tagged)).candidatePackage) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(taggedPlan.dependencies).toMatchObject({
      'zhin.js': '^1.1.0',
      '@zhin.js/cli': 'next',
      '@zhin.js/gateway': 'next',
    });
    expect(taggedPlan.devDependencies).toEqual({ typescript: 'latest' });

    const declared = await fixture({
      dependencies: { '@zhin.js/cli': 'workspace:*', '@zhin.js/gateway': '^1.0.5' },
      devDependencies: { '@zhin.js/gateway': '^9.9.9', '@zhin.js/cli': '^9.9.9' },
    });
    const declaredPlan = JSON.parse((await new PackageCutover().plan(declared)).candidatePackage) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(declaredPlan.dependencies).toMatchObject({
      'zhin.js': 'latest',
      '@zhin.js/cli': 'workspace:*',
      '@zhin.js/gateway': '^1.0.5',
    });
    expect(declaredPlan.devDependencies).toEqual({ typescript: 'latest' });

    const fresh = await fixture();
    const freshPlan = JSON.parse((await new PackageCutover().plan(fresh)).candidatePackage) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(freshPlan.dependencies).toMatchObject({
      'zhin.js': 'latest',
      '@zhin.js/cli': 'latest',
      '@zhin.js/gateway': 'latest',
    });
    expect(freshPlan.devDependencies['@zhin.js/cli']).toBeUndefined();
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
      private: true,
      type: 'module',
      dependencies: { existing: '^1.0.0' },
      ...extra,
    }, null, 2)}\n`),
    mkdirSource(root, 'commands/status'),
    mkdirSource(root, 'middlewares/audit'),
    mkdirSource(root, 'components/card'),
  ]);
  return root;
}

async function mkdirSource(root: string, name: string): Promise<void> {
  await mkdir(join(root, name), { recursive: true });
}

function legacyCommandDefinition(): string {
  return "import { defineCommand } from 'zhin.js/command';\n";
}

function legacyMiddlewareDefinition(): string {
  return "import { defineMiddleware } from 'zhin.js/middleware';\n";
}

function componentDefinition(): string {
  return "import { defineComponent } from '@zhin.js/component';\n";
}
