import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { YamlEndpointConfigurationStore } from '../../src/plugin-runtime/endpoint-configuration-store.js';

let root: string;
let environment: NodeJS.ProcessEnv;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'endpoint-configuration-store-'));
  environment = {};
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function createStore(configFile?: string): YamlEndpointConfigurationStore {
  return new YamlEndpointConfigurationStore({ projectRoot: root, configFile, environment });
}

function writeConfig(content: string, basename = 'zhin.config.yml'): string {
  const filePath = path.join(root, basename);
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe('YamlEndpointConfigurationStore', () => {
  it('creates the canonical endpoint map and persists secrets in .env', () => {
    const store = createStore();

    const result = store.add({
      adapterKey: 'demo',
      entry: { id: 'my-bot', token: '${DEMO_MY_BOT_TOKEN}' },
      environment: { DEMO_MY_BOT_TOKEN: 'tok-1' },
    });

    expect(result.filePath).toBe(path.join(root, 'zhin.config.yml'));
    expect(store.list('demo')).toEqual([
      { id: 'my-bot', token: '${DEMO_MY_BOT_TOKEN}' },
    ]);
    expect(fs.readFileSync(path.join(root, '.env'), 'utf8')).toBe('DEMO_MY_BOT_TOKEN=tok-1\n');
    expect(environment.DEMO_MY_BOT_TOKEN).toBe('tok-1');
  });

  it('preserves YAML comments and updates an existing environment key', () => {
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

    store.add({
      adapterKey: 'demo',
      entry: { id: 'new-bot', token: '${DEMO_NEW_BOT_TOKEN}' },
      environment: { DEMO_NEW_BOT_TOKEN: 'new' },
    });

    const yaml = fs.readFileSync(filePath, 'utf8');
    expect(yaml).toContain('# root comment');
    expect(yaml).toContain('# endpoint comment');
    expect(store.list('demo').map((entry) => entry.id)).toEqual(['old-bot', 'new-bot']);
    expect(fs.readFileSync(path.join(root, '.env'), 'utf8')).toBe(
      'OTHER=keep\nDEMO_NEW_BOT_TOKEN=new\n',
    );
  });

  it('keeps adapter namespaces independent and removes only the requested id', () => {
    const filePath = writeConfig(
      'plugins:\n  demo:\n    endpoints:\n      - { id: a }\n      - { id: b }\n',
      'config.yaml',
    );
    const store = createStore(filePath);

    store.add({ adapterKey: 'other', entry: { id: 'c' }, environment: {} });
    expect(store.remove('demo', 'a')).toEqual({ removed: true, filePath });
    expect(store.remove('demo', 'missing')).toEqual({ removed: false, filePath });
    expect(store.list('demo').map((entry) => entry.id)).toEqual(['b']);
    expect(store.list('other').map((entry) => entry.id)).toEqual(['c']);
  });

  it('rejects duplicate ids without mutating project files', () => {
    const filePath = writeConfig('plugins:\n  demo:\n    endpoints:\n      - { id: dup }\n');
    const before = fs.readFileSync(filePath, 'utf8');
    const store = createStore(filePath);

    expect(() => store.add({
      adapterKey: 'demo',
      entry: { id: 'dup' },
      environment: { DEMO_DUP_TOKEN: 'secret' },
    })).toThrow(/已存在/);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(root, '.env'))).toBe(false);
  });

  it('requires the canonical plugins object instead of promoting arrays', () => {
    const filePath = writeConfig('plugins: []\n');
    const store = createStore(filePath);

    expect(() => store.list('demo')).toThrow(/plugins 必须是对象映射/);
    expect(() => store.add({
      adapterKey: 'demo',
      entry: { id: 'bot' },
      environment: {},
    })).toThrow(/plugins 必须是对象映射/);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('plugins: []\n');
  });

  it('rejects a non-object configuration root', () => {
    const filePath = writeConfig('- invalid\n');
    const store = createStore(filePath);

    expect(() => store.list('demo')).toThrow(/配置根节点必须是对象映射/);
  });

  it('refuses to write the active JSON config file', () => {
    const filePath = writeConfig('{"plugins":{}}\n', 'zhin.config.json');
    const store = createStore(filePath);

    expect(() => store.list('demo')).toThrow(/暂不支持写入 \.json 配置文件/);
  });
});
