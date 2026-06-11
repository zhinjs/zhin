/**
 * install_skill 内置工具单测（mock fetch）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockCommMessage } from '../helpers/mock-comm-message.js';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  InstallSkillBuiltinTool,
  createInstallSkillTool,
} from '../../src/builtin/install-skill-tool.js';
import { normalizeTool } from '../../src/orchestrator/tool-selection.js';
import type { Message } from '@zhin.js/core';

const VALID_SKILL = `---
name: fromurl
description: installed via test
---

## Body
ok
`;

describe('InstallSkillBuiltinTool', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-install-skill-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('HTTP 非 ok 返回错误', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404, statusText: 'NF' }));
    const inst = new InstallSkillBuiltinTool({ skillsInstallRoot: tmp, fetchImpl });
    const out = String(await inst.run({ url: 'https://example.com/s.md' }));
    expect(out).toContain('HTTP 404');
  });

  it('缺少 frontmatter 报错', async () => {
    const fetchImpl = vi.fn(async () => new Response('no yaml here', { status: 200 }));
    const inst = new InstallSkillBuiltinTool({ skillsInstallRoot: tmp, fetchImpl });
    expect(String(await inst.run({ url: 'https://example.com/x.md' }))).toContain('frontmatter');
  });

  it('成功安装到自定义根目录', async () => {
    const fetchImpl = vi.fn(async () => new Response(VALID_SKILL, { status: 200 }));
    const inst = new InstallSkillBuiltinTool({ skillsInstallRoot: tmp, fetchImpl });
    const out = String(await inst.run({ url: 'https://example.com/skill.md' }));
    expect(out).toContain('fromurl');
    const skillMd = path.join(tmp, 'fromurl', 'SKILL.md');
    expect(fs.existsSync(skillMd)).toBe(true);
    expect(fs.readFileSync(skillMd, 'utf-8')).toContain('fromurl');
  });

  it('createInstallSkillTool execute', async () => {
    const fetchImpl = vi.fn(async () => new Response(VALID_SKILL, { status: 200 }));
    const tool = createInstallSkillTool({ skillsInstallRoot: tmp, fetchImpl });
    const agentTool = normalizeTool(tool, mockCommMessage({ adapter: 't' }));
    const out = String(await agentTool.execute({ url: 'https://example.com/a.md' }));
    expect(out).toContain('已安装');
  });
});
