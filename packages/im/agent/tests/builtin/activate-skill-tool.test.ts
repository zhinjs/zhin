/**
 * activate_skill 内置工具单测
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ActivateSkillBuiltinTool,
  createActivateSkillTool,
} from '../../src/builtin/activate-skill-tool.js';
import { normalizeTool } from '../../src/orchestrator/tool-selection.js';
import type { ToolContext } from '@zhin.js/core';

const SKILL_BODY = `---
name: ninja
description: test skill
---

## 执行规则
Do the thing.
`;

describe('ActivateSkillBuiltinTool', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-act-skill-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('skillDirList 扫描目录下技能', async () => {
    const skillRoot = path.join(tmp, 'skills-root');
    const skillDir = path.join(skillRoot, 'ninja');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), SKILL_BODY, 'utf-8');
    const inst = new ActivateSkillBuiltinTool({
      skillDirList: () => [skillRoot],
      skillMaxChars: 4000,
    });
    const out = String(await inst.run({ name: 'ninja' }));
    expect(out).toContain("Skill 'ninja' activated");
    expect(out).toContain('执行规则');
  });

  it('skillFileLookup 优先于目录扫描', async () => {
    const alt = path.join(tmp, 'other', 'SKILL.md');
    fs.mkdirSync(path.dirname(alt), { recursive: true });
    fs.writeFileSync(alt, SKILL_BODY, 'utf-8');
    const inst = new ActivateSkillBuiltinTool({
      skillFileLookup: () => alt,
      skillDirList: () => [],
      skillMaxChars: 4000,
    });
    const out = String(await inst.run({ name: 'ninja' }));
    expect(out).toContain("Skill 'ninja' activated");
  });

  it('未找到技能', async () => {
    const inst = new ActivateSkillBuiltinTool({
      skillDirList: () => [tmp],
      skillMaxChars: 4000,
    });
    expect(String(await inst.run({ name: 'missing' }))).toContain('not found');
  });

  it('createActivateSkillTool + normalizeTool', async () => {
    const skillRoot = path.join(tmp, 'r');
    fs.mkdirSync(path.join(skillRoot, 'ninja'), { recursive: true });
    fs.writeFileSync(path.join(skillRoot, 'ninja', 'SKILL.md'), SKILL_BODY, 'utf-8');
    const tool = createActivateSkillTool({
      skillDirList: () => [skillRoot],
      skillMaxChars: 4000,
    });
    const agentTool = normalizeTool(tool, { platform: 't' } as ToolContext);
    const out = String(await agentTool.execute({ name: 'ninja' }));
    expect(out).toContain('activated');
  });
});
