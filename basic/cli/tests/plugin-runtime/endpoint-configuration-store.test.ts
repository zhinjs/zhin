import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConfigDocument } from '@zhin.js/config-file';
import type {
  ConfigDocumentPort,
  ConfigDocumentSnapshot,
  ConfigPatch,
  PreparedConfigDocument,
} from '@zhin.js/plugin-runtime';
import { ProjectEndpointConfigurationStore } from '../../src/plugin-runtime/endpoint-configuration-store.js';

let root: string;
let environment: NodeJS.ProcessEnv;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'endpoint-configuration-store-'));
  environment = {};
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function createStore(
  configFile = path.join(root, 'zhin.config.yml'),
  document: ConfigDocumentPort = createConfigDocument(configFile),
): ProjectEndpointConfigurationStore {
  return new ProjectEndpointConfigurationStore({
    projectRoot: root,
    configFile,
    document,
    environment,
  });
}

function writeConfig(content: string, basename = 'zhin.config.yml'): string {
  const filePath = path.join(root, basename);
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe('ProjectEndpointConfigurationStore', () => {
  it('materializes the default Root config and persists secrets in .env', async () => {
    const store = createStore();

    const result = await store.add({
      adapterKey: 'demo',
      entry: { id: 'my-bot', token: '${DEMO_MY_BOT_TOKEN}' },
      environment: { DEMO_MY_BOT_TOKEN: 'tok-1' },
    });

    expect(result.filePath).toBe(path.join(root, 'zhin.config.yml'));
    await expect(store.list('demo')).resolves.toEqual([
      { id: 'my-bot', token: '${DEMO_MY_BOT_TOKEN}' },
    ]);
    expect(fs.readFileSync(path.join(root, '.env'), 'utf8')).toBe('DEMO_MY_BOT_TOKEN=tok-1\n');
    expect(environment.DEMO_MY_BOT_TOKEN).toBe('tok-1');
  });

  it('preserves YAML comments and updates an existing environment key', async () => {
    const filePath = writeConfig([
      '# root comment',
      'log_level: info',
      'plugins:',
      '  demo:',
      '    # endpoint comment',
      '    endpoints:',
      '      - { id: old-bot, token: old }',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.env'), 'OTHER=keep\nDEMO_NEW_BOT_TOKEN=old\n');
    const store = createStore(filePath);

    await store.add({
      adapterKey: 'demo',
      entry: { id: 'new-bot', token: '${DEMO_NEW_BOT_TOKEN}' },
      environment: { DEMO_NEW_BOT_TOKEN: 'new' },
    });

    const yaml = fs.readFileSync(filePath, 'utf8');
    expect(yaml).toContain('# root comment');
    expect(yaml).toContain('# endpoint comment');
    expect((await store.list('demo')).map((entry) => entry.id)).toEqual(['old-bot', 'new-bot']);
    expect(fs.readFileSync(path.join(root, '.env'), 'utf8')).toBe(
      'OTHER=keep\nDEMO_NEW_BOT_TOKEN=new\n',
    );
  });

  it('uses the same endpoint contract for JSON Root config', async () => {
    const filePath = writeConfig('{\n  "plugins": {}\n}\n', 'zhin.config.json');
    const store = createStore(filePath);

    await store.add({ adapterKey: 'demo', entry: { id: 'json-bot' }, environment: {} });
    await expect(store.list('demo')).resolves.toEqual([{ id: 'json-bot' }]);
    await expect(store.remove('demo', 'json-bot')).resolves.toEqual({
      removed: true,
      filePath,
    });
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({
      plugins: { demo: { endpoints: [] } },
    });
  });

  it('serializes concurrent mutations without losing endpoints', async () => {
    const store = createStore();

    await Promise.all([
      store.add({ adapterKey: 'demo', entry: { id: 'a' }, environment: {} }),
      store.add({ adapterKey: 'demo', entry: { id: 'b' }, environment: {} }),
    ]);

    expect((await store.list('demo')).map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('keeps adapter namespaces independent and removes only the requested id', async () => {
    const filePath = writeConfig(
      'plugins:\n  demo:\n    endpoints:\n      - { id: a }\n      - { id: b }\n',
      'config.yaml',
    );
    const store = createStore(filePath);

    await store.add({ adapterKey: 'other', entry: { id: 'c' }, environment: {} });
    await expect(store.remove('demo', 'a')).resolves.toEqual({ removed: true, filePath });
    await expect(store.remove('demo', 'missing')).resolves.toEqual({ removed: false, filePath });
    expect((await store.list('demo')).map((entry) => entry.id)).toEqual(['b']);
    expect((await store.list('other')).map((entry) => entry.id)).toEqual(['c']);
  });

  it('rejects duplicate ids without mutating project files', async () => {
    const filePath = writeConfig('plugins:\n  demo:\n    endpoints:\n      - { id: dup }\n');
    const before = fs.readFileSync(filePath, 'utf8');
    const store = createStore(filePath);

    await expect(store.add({
      adapterKey: 'demo',
      entry: { id: 'dup' },
      environment: { DEMO_DUP_TOKEN: 'secret' },
    })).rejects.toThrow(/已存在/);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(root, '.env'))).toBe(false);
  });

  it('requires canonical object maps instead of promoting arrays', async () => {
    const filePath = writeConfig('plugins: []\n');
    const store = createStore(filePath);

    await expect(store.list('demo')).rejects.toThrow(/plugins 必须是对象映射/);
    await expect(store.add({
      adapterKey: 'demo',
      entry: { id: 'bot' },
      environment: {},
    })).rejects.toThrow(/plugins 必须是对象映射/);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('plugins: []\n');
  });

  it('restores exact .env bytes when the prepared config cannot commit', async () => {
    const filePath = writeConfig('plugins: {}\n');
    const envPath = path.join(root, '.env');
    const original = 'OTHER=keep\r\nDEMO_BOT_TOKEN=old\r\n';
    fs.writeFileSync(envPath, original);
    const document = new FailingCommitDocument(createConfigDocument(filePath));
    const store = createStore(filePath, document);

    await expect(store.add({
      adapterKey: 'demo',
      entry: { id: 'bot', token: '${DEMO_BOT_TOKEN}' },
      environment: { DEMO_BOT_TOKEN: 'new' },
    })).rejects.toThrow('commit rejected');

    expect(fs.readFileSync(envPath, 'utf8')).toBe(original);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('plugins: {}\n');
    expect(environment.DEMO_BOT_TOKEN).toBeUndefined();
  });
});

class FailingCommitDocument implements ConfigDocumentPort {
  constructor(readonly inner: ConfigDocumentPort) {}

  read(): Promise<ConfigDocumentSnapshot> {
    return this.inner.read();
  }

  async prepare(
    current: ConfigDocumentSnapshot,
    patches: readonly ConfigPatch[],
  ): Promise<PreparedConfigDocument> {
    const prepared = await this.inner.prepare(current, patches);
    return {
      document: prepared.document,
      async commit() { throw new Error('commit rejected'); },
      async rollback() {},
    };
  }
}
