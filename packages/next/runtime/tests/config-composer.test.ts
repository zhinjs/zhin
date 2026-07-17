import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConfigComposer,
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
});

interface ConfigProjectInput {
  rootSchema: unknown;
  childSchema: unknown;
  nested?: boolean;
  childOwnCollision?: boolean;
}

async function configProject(input: ConfigProjectInput): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-next-config-'));
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
