/**
 * createBuiltinTools（IM 内置）聚合冒烟 — 原 tools-builtin 中唯一仍相关的断言
 */
import { describe, it, expect } from 'vitest';
import { createBuiltinTools } from '../../src/builtin-tools.js';
import { Plugin } from '@zhin.js/core';

const plugin = new Plugin();

describe('createBuiltinTools', () => {
  it('聚合包含记忆、技能与 ask_user 工具', () => {
    const tools = createBuiltinTools({ plugin });
    const names = tools.map(t => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'read_memory',
        'write_memory',
        'activate_skill',
        'install_skill',
        'ask_user',
      ]),
    );
  });
});
