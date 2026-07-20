import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FilePublishJournalStore,
  ProjectCommands,
  ProjectScaffolder,
  type CommandStep,
  type ProcessRunner,
  type PublishJournal,
  type PublishJournalStore,
} from '../../src/plugin-runtime/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('Plugin Runtime CLI project tooling', () => {
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
    expect(tsconfig.include).toContain('tools/*.ts');
    expect(tsconfig.include).toContain('mcp/*.ts');
    expect(tsconfig.include).toContain('pages/*.ts');
    expect(tsconfig.include).toContain('pages/*.tsx');
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

  it('publishes behind a staging tag and resumes a crash without repeating remote work', async () => {
    const root = await publicProject();
    const commands = new ProjectCommands();
    const graph = await commands.inspect(root);
    const plan = commands.publishPlan(graph, { execute: true, tag: 'canary' });
    const store = new MemoryJournalStore();
    const runner = new FaultRunner(plan.steps.filter((step) => step.phase === 'publish')[1]!.id);

    expect(plan.steps.map((step) => step.phase)).toEqual([
      'publish', 'publish', 'promote', 'promote', 'cleanup', 'cleanup',
    ]);
    expect(plan.steps.slice(0, 2).every((step) => step.args.includes(plan.stagingTag!))).toBe(true);
    await expect(commands.executePublish(plan, runner, store)).rejects.toThrow('simulated crash');
    expect(runner.calls.map((step) => step.phase)).toEqual(['publish', 'publish']);
    expect(store.value?.state).toBe('failed');

    const completed = await commands.executePublish(plan, runner, store, { resume: true });
    expect(completed.state).toBe('complete');
    expect(runner.probes).toContain(plan.steps[1]!.id);
    expect(runner.calls.filter((step) => step.id === plan.steps[1]!.id)).toHaveLength(1);
    expect(runner.calls.map((step) => step.phase)).toEqual([
      'publish', 'publish', 'promote', 'promote', 'cleanup', 'cleanup',
    ]);
  });

  it('refuses unsafe journal reuse and persists journals atomically', async () => {
    const root = await publicProject();
    const commands = new ProjectCommands();
    const graph = await commands.inspect(root);
    const first = commands.publishPlan(graph, { execute: true, tag: 'canary' });
    const second = commands.publishPlan(graph, { execute: true, tag: 'beta' });
    const memory = new MemoryJournalStore();
    const runner = new FaultRunner(first.steps[0]!.id);
    await expect(commands.executePublish(first, runner, memory)).rejects.toThrow('simulated crash');
    await expect(commands.executePublish(second, runner, memory, { resume: true }))
      .rejects.toThrow('another plan');
    await expect(commands.executePublish(first, runner, memory))
      .rejects.toThrow('rerun with --resume');
    await expect(commands.executePublish(first, { run: async () => undefined }, memory, { resume: true }))
      .rejects.toThrow('Cannot safely recover');

    const file = new FilePublishJournalStore(join(root, '.zhin/publish-journal.json'));
    await file.write(memory.value!);
    await expect(file.read()).resolves.toEqual(memory.value);
    expect(() => commands.publishPlan(graph, { execute: true, tag: '1.2.3' }))
      .toThrow('Invalid npm dist-tag');
  });
});

class MemoryJournalStore implements PublishJournalStore {
  value?: PublishJournal;
  async read(): Promise<PublishJournal | undefined> { return this.value; }
  async write(journal: PublishJournal): Promise<void> {
    this.value = structuredClone(journal);
  }
}

class FaultRunner implements ProcessRunner {
  readonly calls: CommandStep[] = [];
  readonly probes: string[] = [];
  readonly #remote = new Set<string>();
  #failed = false;

  constructor(private readonly failAfter: string) {}

  async run(step: CommandStep): Promise<void> {
    this.calls.push(step);
    this.#remote.add(step.id);
    if (step.id === this.failAfter && !this.#failed) {
      this.#failed = true;
      throw new Error('simulated crash after remote success');
    }
  }

  async probe(step: CommandStep): Promise<'complete' | 'incomplete'> {
    this.probes.push(step.id);
    return this.#remote.has(step.id) ? 'complete' : 'incomplete';
  }
}

async function publicProject(): Promise<string> {
  const root = await temp();
  const scaffold = new ProjectScaffolder(root);
  await scaffold.init({ packageName: '@acme/root' });
  await scaffold.createPlugin({ name: 'weather' });
  await makePublic(join(root, 'package.json'), '1.0.0');
  await makePublic(join(root, 'plugins/weather/package.json'), '1.1.0');
  return root;
}

async function makePublic(path: string, version: string): Promise<void> {
  const value = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  value.private = false;
  value.version = version;
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function temp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-cli-'));
  temporary.push(root);
  return root;
}
