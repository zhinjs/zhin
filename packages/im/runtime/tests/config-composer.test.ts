import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConfigComposer,
  ConfigPatchPathError,
  ConfigPatchPlanner,
  ConfigSchemaCollisionError,
  ConfigValidationError,
  NodePackageResolver,
  ProjectGraphService,
} from '../src/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('hierarchical Plugin config', () => {
  it('composes child schemas, applies defaults, and exposes owner-only views', async () => {
    const root = await configProject({
      rootSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { endpoint: { type: 'string', default: 'local' } },
      },
      childSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { retries: { type: 'integer', default: 3 } },
      },
      nested: true,
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root);
    const config = await new ConfigComposer().compose(graph, {});

    expect(config.document).toEqual({
      plugin: { endpoint: 'local' },
      plugins: { child: { retries: 3, nested: { enabled: true } } },
    });
    expect(config.views.get(graph.root.id)).toEqual({ endpoint: 'local' });
    expect(config.views.get(graph.root.children[0]!.id)).toEqual({ retries: 3 });
    expect(config.views.get(graph.root.children[0]!.children[0]!.id)).toEqual({
      enabled: true,
    });
  });

  it('rejects parent fields colliding with child instance keys', async () => {
    const root = await configProject({
      rootSchema: {},
      childSchema: {
        type: 'object',
        properties: { nested: { type: 'boolean' } },
      },
      childOwnCollision: true,
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root);

    await expect(new ConfigComposer().compose(graph, {})).rejects.toBeInstanceOf(
      ConfigSchemaCollisionError,
    );
  });

  it('accepts opaque Host keys without projecting them into Plugin views', async () => {
    const root = await configProject({
      rootSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { endpoint: { type: 'string', default: 'local' } },
      },
      childSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { retries: { type: 'integer', default: 3 } },
      },
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root);
    const config = await new ConfigComposer().compose(graph, {
      http: { port: 8086, token: 'dev' },
      database: { dialect: 'sqlite', filename: './data.db' },
      ai: { providers: {} },
      mcp: { enabled: true, path: '/mcp' },
      a2a: { enabled: true },
      speech: { stt: { provider: 'ollama' } },
      htmlRenderer: { width: 540 },
      assistant: { enabled: true },
      collaboration: { enabled: true },
      log_level: 'debug',
    });

    expect(config.document.http).toEqual({ port: 8086, token: 'dev' });
    expect(config.document.database).toEqual({ dialect: 'sqlite', filename: './data.db' });
    expect(config.document.ai).toEqual({ providers: {} });
    expect(config.document.mcp).toEqual({ enabled: true, path: '/mcp' });
    expect(config.document.a2a).toEqual({ enabled: true });
    expect(config.document.speech).toEqual({ stt: { provider: 'ollama' } });
    expect(config.document.htmlRenderer).toEqual({ width: 540 });
    expect(config.document.assistant).toEqual({ enabled: true });
    expect(config.document.collaboration).toEqual({ enabled: true });
    expect(config.document.log_level).toBe('debug');
    expect(config.views.get(graph.root.id)).toEqual({ endpoint: 'local' });
    expect(config.views.get(graph.root.children[0]!.id)).toEqual({ retries: 3 });
  });

  it('returns structured validation issues', async () => {
    const root = await configProject({
      rootSchema: {
        type: 'object',
        properties: { port: { type: 'integer' } },
      },
      childSchema: {},
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root);

    await expect(new ConfigComposer().compose(graph, {
      plugin: { port: 'bad' },
    })).rejects.toBeInstanceOf(ConfigValidationError);
  });

  it('pinpoints the offending additionalProperty key in validation issues', async () => {
    const root = await configProject({
      rootSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { port: { type: 'integer' } },
      },
      childSchema: {},
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root);

    const failure = await new ConfigComposer().compose(graph, {
      plugin: { port: 8080, prto: 8081 },
    }).then(
      () => { throw new Error('expected ConfigValidationError'); },
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ConfigValidationError);
    const issues = (failure as ConfigValidationError).issues;
    expect(issues.some((issue) => issue.includes('additionalProperty: prto'))).toBe(true);
  });

  it('annotates the source config file name when provided', async () => {
    const root = await configProject({
      rootSchema: {
        type: 'object',
        properties: { port: { type: 'integer' } },
      },
      childSchema: {},
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root);

    const failure = await new ConfigComposer().compose(graph, {
      plugin: { port: 'bad' },
    }, 'zhin.config.yml').then(
      () => { throw new Error('expected ConfigValidationError'); },
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ConfigValidationError);
    expect((failure as ConfigValidationError).message).toContain('zhin.config.yml');
  });

  it('plans the shallowest forest whose owner views actually changed', async () => {
    const root = await configProject({
      rootSchema: {},
      childSchema: {
        type: 'object',
        properties: { retries: { type: 'integer', default: 3 } },
      },
      nested: true,
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root);
    const child = graph.root.children[0]!;
    const nested = child.children[0]!;
    const planner = new ConfigPatchPlanner();

    const nestedOnly = await planner.plan(graph, {}, [{
      op: 'set',
      path: ['plugins', 'child', 'nested', 'enabled'],
      value: false,
    }]);
    expect(nestedOnly.roots).toEqual([nested.id]);
    expect(nestedOnly.views.get(nested.id)).toEqual({ enabled: false });

    const collapsed = await planner.plan(graph, nestedOnly.document, [
      { op: 'set', path: ['plugins', 'child', 'retries'], value: 5 },
      { op: 'set', path: ['plugins', 'child', 'nested', 'enabled'], value: true },
    ]);
    expect(collapsed.roots).toEqual([child.id]);
  });

  it('does not create work when defaults make a patch semantically unchanged', async () => {
    const root = await configProject({
      rootSchema: {},
      childSchema: {
        type: 'object',
        properties: { retries: { type: 'integer', default: 3 } },
      },
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root);
    const plan = await new ConfigPatchPlanner().plan(graph, {}, [{
      op: 'set',
      path: ['plugins', 'child', 'retries'],
      value: 3,
    }]);

    expect(plan.roots).toEqual([]);

    const changed = await new ConfigPatchPlanner().plan(graph, {
      plugins: { child: { retries: 9 } },
    }, [{
      op: 'remove',
      path: ['plugins', 'child', 'retries'],
    }]);
    expect(changed.roots).toEqual([graph.root.children[0]!.id]);
    expect(changed.views.get(graph.root.children[0]!.id)).toEqual({ retries: 3 });
  });

  it('rejects invalid values and unsafe traversal paths before planning', async () => {
    const root = await configProject({
      rootSchema: {},
      childSchema: {
        type: 'object',
        properties: { retries: { type: 'integer' } },
      },
    });
    const resolver = await NodePackageResolver.create(root);
    const graph = await new ProjectGraphService(resolver).inspect(root);
    const planner = new ConfigPatchPlanner();

    await expect(planner.plan(graph, {}, [{
      op: 'set',
      path: ['plugins', 'child', 'retries'],
      value: 'bad',
    }])).rejects.toBeInstanceOf(ConfigValidationError);
    await expect(planner.plan(graph, {}, [{
      op: 'set',
      path: ['plugins', '__proto__', 'polluted'],
      value: true,
    }])).rejects.toBeInstanceOf(ConfigPatchPathError);
  });
});

interface ConfigProjectInput {
  rootSchema: unknown;
  childSchema: unknown;
  nested?: boolean;
  childOwnCollision?: boolean;
}

async function configProject(input: ConfigProjectInput): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-runtime-config-'));
  temporary.push(root);
  await json(join(root, 'package.json'), {
    name: '@test/root',
    dependencies: { '@test/child': 'workspace:*' },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      plugins: [{ package: '@test/child', instanceKey: 'child' }],
    },
  });
  await json(join(root, 'schema.json'), input.rootSchema);
  await json(join(root, 'plugins/child/package.json'), {
    name: '@test/child',
    dependencies: input.childOwnCollision || input.nested
      ? { '@test/nested': 'workspace:*' }
      : {},
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      plugins: input.childOwnCollision || input.nested
        ? [{ package: '@test/nested', instanceKey: 'nested' }]
        : [],
    },
  });
  await json(join(root, 'plugins/child/schema.json'), input.childSchema);
  if (input.childOwnCollision || input.nested) {
    await json(join(root, 'plugins/nested/package.json'), {
      name: '@test/nested',
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
    });
    await json(join(root, 'plugins/nested/schema.json'), {
      type: 'object',
      additionalProperties: false,
      properties: { enabled: { type: 'boolean', default: true } },
    });
  }
  return root;
}

async function json(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
