import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse as parseYaml } from 'yaml';
import { ConfigFeature, ConfigLoader, mergeConfigDefaults } from '../src/built/config.js';

const DEFAULT_APP_CONFIG = {
  log_level: 'info' as const,
  endpoints: [] as Array<Record<string, unknown>>,
  database: { dialect: 'sqlite' as const, filename: './data/bot.db' },
  plugin_dirs: ['node_modules', './src/plugins'],
  plugins: [] as string[],
  services: ['process', 'config', 'command'],
};

const MOCK_SECOND_QQ_NAME = 'mock-qq-second';
const MOCK_SECOND_QQ_APPID = '900000003';

const FIXTURE_CONFIG = path.join(import.meta.dirname, 'fixtures/patch-endpoints-zhin.config.yml');

describe('patchKey endpoints with YAML anchors', () => {
  it('reload after patchKey keeps all endpoints including second qq', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-cfg-'));
    fs.copyFileSync(FIXTURE_CONFIG, path.join(tmp, 'zhin.config.yml'));

    const cf = new ConfigFeature();
    cf.load('zhin.config.yml', DEFAULT_APP_CONFIG, undefined, tmp);
    const raw = cf.getRaw<{ endpoints: Array<Record<string, unknown>> }>('zhin.config.yml');
    const existing = raw.endpoints.find((e) => e.context === 'qq');
    expect(existing).toBeTruthy();
    const { name: _n, appid: _a, secret: _s, context: _c, ...template } = existing!;
    const endpoints = [
      ...raw.endpoints,
      {
        context: 'qq',
        name: MOCK_SECOND_QQ_NAME,
        appid: MOCK_SECOND_QQ_APPID,
        secret: 'mock-test-secret',
        ...template,
      },
    ];

    const loader = cf.configs.get('zhin.config.yml')!;
    loader.patchKey('endpoints', endpoints);

    const disk = fs.readFileSync(path.join(tmp, 'zhin.config.yml'), 'utf8');
    expect(disk).toContain(MOCK_SECOND_QQ_NAME);

    const parsed = parseYaml(disk) as { endpoints: Array<{ name: string }> };
    expect(parsed.endpoints.map((e) => e.name)).toContain(MOCK_SECOND_QQ_NAME);

    const merged = mergeConfigDefaults(DEFAULT_APP_CONFIG, parsed);
    expect(merged.endpoints.map((e: { name: string }) => e.name)).toContain(MOCK_SECOND_QQ_NAME);

    loader.load(tmp);
    expect(loader.raw.endpoints.map((e: { name: string }) => e.name)).toContain(MOCK_SECOND_QQ_NAME);
  });

  it('reload without baseDir after patchKey still keeps endpoints when cwd matches project root', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-cfg-'));
    fs.copyFileSync(FIXTURE_CONFIG, path.join(tmp, 'zhin.config.yml'));

    const cf = new ConfigFeature();
    cf.load('zhin.config.yml', DEFAULT_APP_CONFIG, undefined, tmp);
    const raw = cf.getRaw<{ endpoints: Array<Record<string, unknown>> }>('zhin.config.yml');
    const existing = raw.endpoints.find((e) => e.context === 'qq')!;
    const { name: _n, appid: _a, secret: _s, context: _c, ...template } = existing;
    const loader = cf.configs.get('zhin.config.yml')!;
    loader.patchKey('endpoints', [
      ...raw.endpoints,
      { context: 'qq', name: MOCK_SECOND_QQ_NAME, appid: MOCK_SECOND_QQ_APPID, secret: 'mock-sec', ...template },
    ]);

    const prevCwd = process.cwd();
    process.chdir(tmp);
    try {
      loader.load();
    } finally {
      process.chdir(prevCwd);
    }
    expect(loader.raw.endpoints.map((e: { name: string }) => e.name)).toContain(MOCK_SECOND_QQ_NAME);
  });

  it('ConfigLoader.load() without baseDir re-reads resolved config path, not process cwd', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-cfg-'));
    const botDir = path.join(tmp, 'bot');
    const wrongDir = path.join(tmp, 'wrong');
    fs.mkdirSync(botDir);
    fs.mkdirSync(wrongDir);
    fs.copyFileSync(FIXTURE_CONFIG, path.join(botDir, 'zhin.config.yml'));
    fs.writeFileSync(path.join(wrongDir, 'zhin.config.yml'), 'endpoints: []\nlog_level: info\n');

    const loader = ConfigLoader.load('zhin.config.yml', DEFAULT_APP_CONFIG, undefined, botDir);
    const raw = loader.raw as { endpoints: Array<Record<string, unknown>> };
    const existing = raw.endpoints.find((e) => e.context === 'qq')!;
    const { name: _n, appid: _a, secret: _s, context: _c, ...template } = existing;
    loader.patchKey('endpoints', [
      ...raw.endpoints,
      { context: 'qq', name: MOCK_SECOND_QQ_NAME, appid: MOCK_SECOND_QQ_APPID, secret: 'mock-sec', ...structuredClone(template) },
    ]);

    const botFile = path.join(botDir, 'zhin.config.yml');
    expect(fs.readFileSync(botFile, 'utf8')).toContain(MOCK_SECOND_QQ_NAME);

    const prevCwd = process.cwd();
    process.chdir(wrongDir);
    try {
      loader.load();
    } finally {
      process.chdir(prevCwd);
    }

    expect(loader.raw.endpoints.map((e: { name: string }) => e.name)).toContain(MOCK_SECOND_QQ_NAME);
  });
});
