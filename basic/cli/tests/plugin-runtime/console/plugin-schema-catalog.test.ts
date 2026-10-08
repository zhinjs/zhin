import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PluginSchemaCatalog } from '../../../src/plugin-runtime/console/plugin-schema-catalog.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-plugin-schema-catalog-'));
  roots.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'schema-project',
    zhin: {
      plugins: [
        { package: '@zhin.js/adapter-icqq', instanceKey: 'qq-main' },
        { package: '@zhin.js/adapter-sandbox', instanceKey: 'sandbox' },
      ],
    },
  }));
  await mkdir(join(root, 'node_modules', '@zhin.js', 'adapter-icqq'), { recursive: true });
  await writeFile(
    join(root, 'node_modules', '@zhin.js', 'adapter-icqq', 'schema.json'),
    JSON.stringify({
      type: 'object',
      properties: { account: { type: 'string' } },
      required: ['account'],
    }),
  );
  return root;
}

describe('PluginSchemaCatalog', () => {
  it('resolves an instance key through the project plugin manifest', async () => {
    const catalog = new PluginSchemaCatalog(await createProject());
    await expect(catalog.read('qq-main')).resolves.toMatchObject({
      type: 'object',
      object: { account: { type: 'string', key: 'account', required: true } },
    });
  });

  it('reads a batch against one project catalog and omits missing plugin schemas', async () => {
    const catalog = new PluginSchemaCatalog(await createProject());
    await expect(catalog.readAll(['qq-main', 'sandbox'])).resolves.toEqual({
      'qq-main': {
        type: 'object',
        object: { account: { type: 'string', key: 'account', required: true } },
      },
    });
  });
  it('projects actual Host fields and Chinese descriptions instead of an empty placeholder', async () => {
    const catalog = new PluginSchemaCatalog(await createProject());
    await expect(catalog.read('http')).resolves.toMatchObject({
      type: 'object',
      object: { readiness: { type: 'object', object: {
        database: { type: 'boolean', default: true, description: '要求 Database Host 已初始化（不执行实时数据库查询）。' },
        endpoints: { type: 'list', inner: { type: 'object', object: {
          owner: { type: 'string', required: true }, name: { type: 'string', required: true },
        } } },
      } } },
    });
  });

  it('uses the project root schema for plugin and reports a missing schema honestly', async () => {
    const root = await createProject();
    const catalog = new PluginSchemaCatalog(root);
    await expect(catalog.read('plugin')).resolves.toBeNull();
    await writeFile(join(root, 'schema.json'), JSON.stringify({
      type: 'object', properties: { threshold: { type: 'integer', minimum: 1 } },
    }));
    await expect(catalog.read('plugin')).resolves.toMatchObject({
      object: { threshold: { type: 'number', min: 1 } },
    });
  });

});
