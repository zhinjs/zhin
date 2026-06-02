/**
 * collectPluginSkillSearchRoots — 递归子插件树
 */
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { collectPluginSkillSearchRoots } from '../../src/discovery/utils.js';

function makePlugin(filePath: string, children: unknown[] = []): { filePath: string; children: unknown[] } {
  return { filePath, children };
}

describe('collectPluginSkillSearchRoots', () => {
  it('应包含嵌套子插件包下的 skills 目录', () => {
    const icqqEntry = path.join('repo', 'plugins', 'adapters', 'icqq', 'src', 'index.ts');
    const icqq = makePlugin(icqqEntry);
    const wrapper = makePlugin(path.join('repo', 'plugins', 'bundle', 'src', 'index.ts'), [icqq]);
    const root = makePlugin(path.join('repo', 'packages', 'zhin', 'src', 'setup.ts'), [wrapper]);

    const dirs = collectPluginSkillSearchRoots(root as any);
    const icqqSkills = path.join('repo', 'plugins', 'adapters', 'icqq', 'skills');
    expect(dirs).toContain(icqqSkills);
  });
});
