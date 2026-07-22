import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addQqEndpointToConfig,
  listQqEndpointEntries,
  removeQqEndpointFromConfig,
} from '../src/qq-endpoint-config.js';

let root: string;
let configPath: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-endpoint-config-'));
  configPath = path.join(root, 'zhin.config.yml');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeConfig(content: string): void {
  fs.writeFileSync(configPath, content);
}

describe('addQqEndpointToConfig', () => {
  it('配置文件不存在时新建并写入 plugins.qq.endpoints', () => {
    const filePath = addQqEndpointToConfig(
      { name: 'bot1', appid: '${QQ_BOT1_APPID}', secret: '${QQ_BOT1_SECRET}' },
      root,
    );

    expect(filePath).toBe(configPath);
    expect(listQqEndpointEntries(root)).toEqual([
      { name: 'bot1', appid: '${QQ_BOT1_APPID}', secret: '${QQ_BOT1_SECRET}' },
    ]);
  });

  it('保留已有注释与其它配置，仅追加 endpoints 项', () => {
    writeConfig(
      [
        '# 顶层注释',
        'log_level: info',
        'plugins:',
        '  qq:',
        '    # qq 注释',
        '    sandbox: false',
        '    endpoints:',
        '      - name: old-bot',
        '        appid: "${QQ_OLD_BOT_APPID}"',
        '        secret: "${QQ_OLD_BOT_SECRET}"',
        '',
      ].join('\n'),
    );

    addQqEndpointToConfig(
      { name: 'new-bot', appid: '${QQ_NEW_BOT_APPID}', secret: '${QQ_NEW_BOT_SECRET}' },
      root,
    );

    const text = fs.readFileSync(configPath, 'utf-8');
    expect(text).toContain('# 顶层注释');
    expect(text).toContain('# qq 注释');
    expect(listQqEndpointEntries(root).map((e) => e.name)).toEqual(['old-bot', 'new-bot']);
  });

  it('name 重复时报错且不写文件', () => {
    writeConfig('plugins:\n  qq:\n    endpoints:\n      - { name: dup, appid: a, secret: s }\n');
    const before = fs.readFileSync(configPath, 'utf-8');

    expect(() =>
      addQqEndpointToConfig({ name: 'dup', appid: 'x', secret: 'y' }, root),
    ).toThrow(/已存在/);
    expect(fs.readFileSync(configPath, 'utf-8')).toBe(before);
  });

  it('plugins 为空数组（legacy 形态）时替换为 map', () => {
    writeConfig('plugins: []\n');

    addQqEndpointToConfig({ name: 'bot1', appid: 'a', secret: 's' }, root);

    expect(listQqEndpointEntries(root).map((e) => e.name)).toEqual(['bot1']);
  });

  it('plugins 为非空数组时拒绝写入', () => {
    writeConfig('plugins:\n  - "@zhin.js/adapter-sandbox"\n');

    expect(() =>
      addQqEndpointToConfig({ name: 'bot1', appid: 'a', secret: 's' }, root),
    ).toThrow(/数组形态/);
  });
});

describe('removeQqEndpointFromConfig', () => {
  it('按 name 移除，存在返回 removed: true', () => {
    writeConfig(
      [
        'plugins:',
        '  qq:',
        '    endpoints:',
        '      - { name: a, appid: "1", secret: "2" }',
        '      - { name: b, appid: "3", secret: "4" }',
        '',
      ].join('\n'),
    );

    const result = removeQqEndpointFromConfig('a', root);

    expect(result.removed).toBe(true);
    expect(listQqEndpointEntries(root).map((e) => e.name)).toEqual(['b']);
  });

  it('不存在时 removed: false 且文件不变', () => {
    writeConfig('plugins:\n  qq:\n    endpoints:\n      - { name: a, appid: "1", secret: "2" }\n');
    const before = fs.readFileSync(configPath, 'utf-8');

    const result = removeQqEndpointFromConfig('missing', root);

    expect(result.removed).toBe(false);
    expect(fs.readFileSync(configPath, 'utf-8')).toBe(before);
  });
});

describe('listQqEndpointEntries', () => {
  it('无 plugins.qq.endpoints 时返回空数组', () => {
    writeConfig('log_level: info\n');
    expect(listQqEndpointEntries(root)).toEqual([]);
  });
});
