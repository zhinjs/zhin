import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SkillInstructionReader } from '../../src/skill/skill-instruction-reader.js';

const SKILL_BODY = `---
name: ninja
description: test skill
---

## 执行规则
Do the thing.
`;

describe('SkillInstructionReader', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-load-skill-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reads a discovered Skill into a typed result', async () => {
    const skillRoot = path.join(tmp, 'skills-root');
    const skillDir = path.join(skillRoot, 'ninja');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), SKILL_BODY, 'utf-8');
    const reader = new SkillInstructionReader({
      directories: () => [skillRoot],
      maxChars: 4000,
    });

    await expect(reader.read('ninja')).resolves.toMatchObject({
      status: 'found',
      instructions: expect.stringContaining('Do the thing'),
    });
    await expect(reader.read('missing')).resolves.toEqual({ status: 'missing', name: 'missing' });
    await expect(reader.read('../escape')).rejects.toThrow('canonical name');
  });
});
