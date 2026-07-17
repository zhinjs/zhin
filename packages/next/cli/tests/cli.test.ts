import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectCommands, ProjectScaffolder } from '../src/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('next CLI project tooling', () => {
  it('initializes a flat Plugin monorepo and adds local Plugin/Feature packages', async () => {
    const root = await temp();
    const scaffold = new ProjectScaffolder(root);
    await scaffold.init({ packageName: '@acme/root' });
    await scaffold.createPlugin({ name: 'weather' });
    await scaffold.createFeature({ name: 'report' });

    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      zhin: { engine: string; plugins: unknown[]; features: unknown[] };
    };
    expect(pkg.dependencies['@acme/plugin-weather']).toBe('workspace:*');
    expect(pkg.dependencies['@acme/feature-report']).toBe('workspace:*');
    expect(pkg.zhin.engine).toBe('^1.0.0');
    expect(pkg.zhin.plugins).toEqual([
      { package: '@acme/plugin-weather', instanceKey: 'weather' },
    ]);
    expect(pkg.zhin.features).toEqual([
      { package: '@acme/feature-report', api: '^1.0.0' },
    ]);

    const workspace = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace).toBe('packages:\n  - packages/*\n  - plugins/*\n');
    const tsconfig = JSON.parse(
      await readFile(join(root, 'tsconfig.json'), 'utf8'),
    ) as { include: string[] };
    expect(tsconfig.include).toContain('adapters/**/*.ts');
    const child = JSON.parse(
      await readFile(join(root, 'plugins/weather/package.json'), 'utf8'),
    ) as { zhin: { engine: string } };
    const feature = JSON.parse(
      await readFile(join(root, 'packages/report/package.json'), 'utf8'),
    ) as { zhin: { engine: string; featureApi: string } };
    expect(child.zhin.engine).toBe('^1.0.0');
    expect(feature.zhin).toMatchObject({ engine: '^1.0.0', featureApi: '1.0.0' });
  });

  it('derives deterministic build and safe publish plans from the same graph', async () => {
    const root = await temp();
    const scaffold = new ProjectScaffolder(root);
    await scaffold.init({ packageName: '@acme/root' });
    await scaffold.createPlugin({ name: 'weather' });
    const commands = new ProjectCommands();
    const graph = await commands.inspect(root);

    expect(commands.buildPlan(graph).steps.map((step) => step.packageName)).toEqual([
      '@acme/root',
    ]);
    expect(commands.publishPlan(graph).steps).toEqual([]);
  });
});

async function temp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-next-cli-'));
  temporary.push(root);
  return root;
}
