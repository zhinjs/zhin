/**
 * #1250 `packages-list-misleading`: `zhin packages list` groups the project's dependencies
 * instead of printing「无已安装 zhin-package」next to 40 installed plugins.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listProjectPackages, renderProjectPackages } from '../../src/utils/project-packages.js';

let root: string;
const install = (name: string, manifest: Record<string, unknown> = {}) => {
  const dir = path.join(root, 'node_modules', ...name.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...manifest }));
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-packages-list-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    dependencies: { 'zhin.js': '^1.4.0', '@zhin.js/adapter-icqq': '^1.0.0', 'zhin.js-plugin-rss': '^1.0.0', '@zhin.js/tool': '^1.0.0', zod: '^3.0.0', missing: '^1.0.0' },
    devDependencies: { typescript: '^5.0.0' },
  }));
  install('zhin.js', { zhin: { type: 'plugin' } });
  install('@zhin.js/adapter-icqq', { zhin: { type: 'plugin', metadata: { category: 'adapter' } } });
  install('zhin.js-plugin-rss', { zhin: { type: 'plugin', metadata: { category: 'utility' } } });
  install('@zhin.js/tool', { zhin: { type: 'feature' } });
  install('zod');
  install('typescript');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('listProjectPackages', () => {
  it('puts @zhin.js/core with zhin.js in the framework, not the plugins, although both are zhin.type plugin (#1250 b113)', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    manifest.dependencies['@zhin.js/core'] = '^1.0.0';
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
    install('@zhin.js/core', { zhin: { type: 'plugin', features: [{ package: '@zhin.js/adapter', api: '^2.1.0' }] } });
    const packages = listProjectPackages(root);
    expect(packages.find(item => item.name === '@zhin.js/core')?.group).toBe('framework');
    const lines = renderProjectPackages(packages, []);
    expect(lines).toContain('插件（1）');
    expect(lines).toContain('Zhin 框架与功能包（3）');
  });

  it('groups by package.json#zhin: adapters, plugins, framework, other dependencies, missing', () => {
    const groups = Object.fromEntries(listProjectPackages(root).map(item => [item.name, item.group]));
    expect(groups).toEqual({
      '@zhin.js/adapter-icqq': 'adapter',
      'zhin.js-plugin-rss': 'plugin',
      'zhin.js': 'framework',
      '@zhin.js/tool': 'framework',
      zod: 'dependency',
      typescript: 'dependency',
      missing: 'missing',
    });
  });

  it('prints each group with its count, and the skill packs', () => {
    const lines = renderProjectPackages(listProjectPackages(root), []);
    expect(lines).toContain('适配器（1）');
    expect(lines).toContain('插件（1）');
    expect(lines).toContain('Zhin 框架与功能包（2）');
    expect(lines).toContain('其他依赖（2）');
    expect(lines).toContain('已声明但未安装（1）');
    expect(lines.some(line => /typescript\s+1\.0\.0（\^5\.0\.0，dev）/u.test(line))).toBe(true);
    expect(lines).toContain('zhin-package 技能包（0）');
    expect(lines.at(-1)).toBe('有依赖未安装：运行 pnpm install。');
  });
});
