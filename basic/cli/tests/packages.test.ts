import { describe, expect, it } from 'vitest';
import {
  adapterConfigHintForPackage,
  classifyPackage,
  filterSearchResults,
  formatPackageBadge,
  resolveInstallRoute,
} from '../src/utils/plugin-registry.js';

describe('classifyPackage / formatPackageBadge', () => {
  it('官方适配器标注 [official] [adapter]', () => {
    const c = classifyPackage({ name: '@zhin.js/adapter-telegram' });
    expect(c).toEqual({ official: true, kind: 'adapter' });
    expect(formatPackageBadge(c)).toBe('[official] [adapter]');
  });

  it('命中 scaffold-wizard ADAPTERS 清单的非标准命名也识别为 adapter', () => {
    // ADAPTERS 清单中的 package 字段与命名约定一致，这里验证 findAdapterByPackage 通路
    const c = classifyPackage({ name: '@zhin.js/adapter-sandbox' });
    expect(c.kind).toBe('adapter');
  });

  it('官方插件标注 [official] [plugin]', () => {
    const c = classifyPackage({ name: '@zhin.js/plugin-repeat' });
    expect(c).toEqual({ official: true, kind: 'plugin' });
  });

  it('社区插件（zhin.js-plugin-*）标注 [community] [plugin]', () => {
    const c = classifyPackage({ name: 'zhin.js-plugin-rss' });
    expect(c).toEqual({ official: false, kind: 'plugin' });
    expect(formatPackageBadge(c)).toBe('[community] [plugin]');
  });

  it('带 zhin-package keyword 的包标注 skill-pack', () => {
    const c = classifyPackage({ name: 'some-skills', keywords: ['zhin-package'] });
    expect(c).toEqual({ official: false, kind: 'skill-pack' });
  });

  it('普通包只标注 scope', () => {
    const c = classifyPackage({ name: 'lodash' });
    expect(c).toEqual({ official: false, kind: null });
    expect(formatPackageBadge(c)).toBe('[community]');
  });
});

describe('filterSearchResults', () => {
  const results = [
    { name: '@zhin.js/adapter-telegram', version: '1.0.0', keywords: ['zhin', 'adapter'], downloads: '300' },
    { name: 'zhin.js-plugin-rss', version: '0.1.0', keywords: ['zhin', 'plugin'], downloads: '500' },
    { name: 'unrelated-lib', version: '2.0.0', keywords: ['http'], downloads: '9999' },
    { name: '@zhin.js/core', version: '4.0.0', keywords: ['zhin'], downloads: '100' },
  ];

  it('过滤掉与 zhin 无关的包并按下载量排序', () => {
    const filtered = filterSearchResults(results, {});
    expect(filtered.map((p) => p.name)).toEqual([
      'zhin.js-plugin-rss',
      '@zhin.js/adapter-telegram',
      '@zhin.js/core',
    ]);
  });

  it('按关键词过滤', () => {
    const filtered = filterSearchResults(results, { keyword: 'telegram' });
    expect(filtered.map((p) => p.name)).toEqual(['@zhin.js/adapter-telegram']);
  });

  it('按分类过滤', () => {
    const filtered = filterSearchResults(results, { category: 'adapter' });
    expect(filtered.map((p) => p.name)).toEqual(['@zhin.js/adapter-telegram']);
  });

  it('limit 截断结果', () => {
    const filtered = filterSearchResults(results, { limit: 2 });
    expect(filtered).toHaveLength(2);
    expect(filtered[0].name).toBe('zhin.js-plugin-rss');
  });
});

describe('resolveInstallRoute（a/b/c 分流）', () => {
  it('npm: 前缀走 ADR 0010 技能包路径', () => {
    const r = resolveInstallRoute('npm:@scope/skill-pack@1.0.0');
    expect(r.route).toBe('skill-pack');
    expect(r.package).toBe('npm:@scope/skill-pack@1.0.0');
  });

  it('git: 前缀走 ADR 0010 技能包路径', () => {
    const r = resolveInstallRoute('git:https://github.com/user/skills.git');
    expect(r.route).toBe('skill-pack');
  });

  it('已知适配器命中 scaffold-wizard ADAPTERS（route=adapter）', () => {
    const r = resolveInstallRoute('@zhin.js/adapter-telegram');
    expect(r.route).toBe('adapter');
    expect(r.package).toBe('@zhin.js/adapter-telegram');
    expect(r.adapter?.value).toBe('telegram');
  });

  it('带版本号的适配器 spec 也能命中', () => {
    const r = resolveInstallRoute('@zhin.js/adapter-qq@latest');
    expect(r.route).toBe('adapter');
    expect(r.package).toBe('@zhin.js/adapter-qq');
  });

  it('其他 npm 包走 npm 路由（zhin 字段安装后再判定）', () => {
    const r = resolveInstallRoute('zhin.js-plugin-rss@^1.0.0');
    expect(r.route).toBe('npm');
    expect(r.package).toBe('zhin.js-plugin-rss');
  });
});

describe('adapterConfigHintForPackage', () => {
  it('已知适配器返回 zhin setup / endpoints 配置提示', () => {
    const hint = adapterConfigHintForPackage('@zhin.js/adapter-telegram');
    expect(hint).toContain('zhin setup');
    expect(hint).toContain('telegram.endpoints');
  });

  it('未知包返回 null', () => {
    expect(adapterConfigHintForPackage('lodash')).toBeNull();
  });
});
