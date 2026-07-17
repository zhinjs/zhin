import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { definePlugin, rootPluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import agentFeature, {
  AgentIndex,
  agentFeatureId,
} from '@zhin.js/next-feature-agent';
import mcpFeature, {
  McpIndex,
  defineMcp,
  mcpFeatureId,
} from '@zhin.js/next-feature-mcp';
import skillFeature, {
  SkillIndex,
  skillFeatureId,
} from '@zhin.js/next-feature-skill';
import toolFeature, {
  ToolIndex,
  defineAgentTool,
  toolFeatureId,
} from '@zhin.js/next-feature-tool';
import { RootRuntime, type ModuleRuntime } from '../src/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('Agent Feature slot HMR', () => {
  it('reloads TS and Markdown slots without reloading providers or Plugin setup', async () => {
    const project = await createProject();
    const modules = new FakeModules();
    const events: string[] = [];
    const pluginSource = join(project, 'plugin.ts');
    const providers = {
      tool: join(project, 'packages/tool/index.ts'),
      skill: join(project, 'packages/skill/index.ts'),
      agent: join(project, 'packages/agent/index.ts'),
      mcp: join(project, 'packages/mcp/index.ts'),
    };
    const toolSource = join(project, 'tools/lookup.ts');
    const mcpSource = join(project, 'mcp/memory.ts');
    const agentSource = join(project, 'agents/planner.agent.md');
    let setups = 0;
    modules.set(pluginSource, {
      default: definePlugin({ name: 'root', setup() { setups += 1; } }),
    });
    modules.set(providers.tool, { default: toolFeature });
    modules.set(providers.skill, { default: skillFeature });
    modules.set(providers.agent, { default: agentFeature });
    modules.set(providers.mcp, { default: mcpFeature });
    modules.set(toolSource, { default: lookupTool('v1') });
    modules.set(mcpSource, { default: memoryMcp(events) });
    const runtime = new RootRuntime({
      projectRoot: project,
      modules,
      environment: { name: 'test', mode: 'test', platform: 'node' },
    });
    const first = await runtime.start();

    await expect(executeTool(first)).resolves.toBe('v1:value:1');
    expect(readSkill(first)).toBe('Research v1');
    expect(readAgent(first)).toBe('Planner v1');
    await expect(callMcp(first)).resolves.toEqual({ value: 'x' });
    expect(setups).toBe(1);

    const hmr = runtime.createHmrCoordinator({
      onRestartRequired: () => undefined,
      onError: (error) => { throw error; },
    });
    modules.set(toolSource, { default: lookupTool('v2') });
    await hmr.enqueue(toolSource);
    const second = runtime.snapshot;

    await expect(executeTool(second)).resolves.toBe('v2:value:2');
    expect(readAgent(second)).toBe('Planner v1');
    expect(modules.loadCount(toolSource)).toBe(2);
    expect(modules.loadCount(mcpSource)).toBe(1);
    expect(setups).toBe(1);

    await writeFile(agentSource, '# Planner v2\n\nUse the new plan.\n');
    await hmr.enqueue(agentSource);
    const third = runtime.snapshot;

    expect(readAgent(third)).toBe('Planner v2');
    await expect(executeTool(third)).resolves.toBe('v2:value:3');
    for (const provider of Object.values(providers)) {
      expect(modules.loadCount(provider)).toBe(1);
    }
    expect(setups).toBe(1);

    await runtime.stop();
    expect(events.filter((event) => event === 'start')).toHaveLength(3);
    expect(events.filter((event) => event === 'stop')).toHaveLength(3);
  });
});

function lookupTool(version: string) {
  return defineAgentTool<{ value: string }>({
    description: 'Lookup',
    execute: (input, context) => `${version}:${input.value}:${context.generation}`,
  });
}

function memoryMcp(events: string[]) {
  return defineMcp({
    create: () => ({
      start() { events.push('start'); },
      stop() { events.push('stop'); },
      listTools: () => [{ name: 'search' }],
      callTool: (_name, input) => input,
    }),
  });
}

function projection<T>(
  snapshot: RuntimeSnapshot,
  id: Parameters<RuntimeSnapshot['projections']['get']>[0],
  constructor: { readonly prototype: T },
): T {
  const value = snapshot.projections.get(id);
  if (!value || typeof value !== 'object'
    || !Object.prototype.isPrototypeOf.call(constructor.prototype, value)) {
    throw new Error(`Missing projection: ${id}`);
  }
  return value as T;
}

function executeTool(snapshot: RuntimeSnapshot): Promise<unknown> {
  return projection(snapshot, toolFeatureId, ToolIndex)
    .execute(rootPluginId(), 'lookup', { value: 'value' });
}

function readSkill(snapshot: RuntimeSnapshot): string | undefined {
  return projection(snapshot, skillFeatureId, SkillIndex)
    .get(rootPluginId(), 'research')?.description;
}

function readAgent(snapshot: RuntimeSnapshot): string | undefined {
  return projection(snapshot, agentFeatureId, AgentIndex)
    .get(rootPluginId(), 'planner')?.description;
}

function callMcp(snapshot: RuntimeSnapshot): Promise<unknown> {
  return projection(snapshot, mcpFeatureId, McpIndex)
    .callTool(rootPluginId(), 'memory', 'search', { value: 'x' });
}

class FakeModules implements ModuleRuntime {
  readonly #modules = new Map<string, unknown>();
  readonly #loads = new Map<string, number>();
  set(source: string, value: unknown): void { this.#modules.set(source, value); }
  async load<T>(source: string): Promise<T> {
    if (!this.#modules.has(source)) throw new Error(`Missing fake module: ${source}`);
    this.#loads.set(source, (this.#loads.get(source) ?? 0) + 1);
    return this.#modules.get(source) as T;
  }
  loadCount(source: string): number { return this.#loads.get(source) ?? 0; }
  affectedSources(source: string): readonly string[] { return [source]; }
  invalidate(): void {}
  async close(): Promise<void> {}
}

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-next-agent-features-'));
  temporary.push(root);
  const features = ['tool', 'skill', 'agent', 'mcp'];
  await writeJson(join(root, 'package.json'), {
    name: '@test/root',
    dependencies: Object.fromEntries(features.map((name) => [`@test/${name}`, 'workspace:*'])),
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      features: features.map((name) => ({ package: `@test/${name}`, api: '^1.0.0' })),
    },
  });
  for (const name of features) await featurePackage(root, name);
  for (const file of [
    'plugin.ts',
    ...features.map((name) => `packages/${name}/index.ts`),
    'tools/lookup.ts',
    'mcp/memory.ts',
  ]) await touch(join(root, file));
  await touch(join(root, 'skills/research/SKILL.md'), '# Research v1\n\nResearch carefully.\n');
  await touch(join(root, 'agents/planner.agent.md'), '# Planner v1\n\nPlan carefully.\n');
  return root;
}

async function featurePackage(root: string, name: string): Promise<void> {
  await writeJson(join(root, `packages/${name}/package.json`), {
    name: `@test/${name}`,
    zhin: {
      protocol: 1,
      type: 'feature',
      entry: './index.ts',
      featureApi: '1.0.0',
    },
  });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function touch(path: string, content = ''): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
