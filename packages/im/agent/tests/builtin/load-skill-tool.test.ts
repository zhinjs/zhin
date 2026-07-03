/**
 * load_skill 内置工具单测
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readSkillInstructions } from '../../src/builtin/load-skill-tool.js';
import { LoadSkillBuiltinToolMeta } from '../../src/builtin/deferred-tool-meta.js';

const SKILL_BODY = `---
name: ninja
description: test skill
---

## 执行规则
Do the thing.
`;

describe('load_skill', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-load-skill-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('readSkillInstructions 扫描目录下技能', async () => {
    const skillRoot = path.join(tmp, 'skills-root');
    const skillDir = path.join(skillRoot, 'ninja');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), SKILL_BODY, 'utf-8');
    const text = await readSkillInstructions('ninja', {
      skillDirList: () => [skillRoot],
      skillMaxChars: 4000,
    });
    expect(text).toContain('Do the thing');
  });

  it('LoadSkillBuiltinToolMeta 未绑定 runtime 时返回错误', async () => {
    const tool = new LoadSkillBuiltinToolMeta({
      skillDirList: () => [],
      skillMaxChars: 4000,
    });
    const result = await tool.run({ name: 'missing' });
    expect(result).toBe('deferred runtime not available');
  });
});
