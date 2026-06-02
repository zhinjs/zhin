/**
 * activate_skill — 按名称加载技能指令
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Tool, ToolContext, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { checkSkillDeps, extractSkillInstructions } from '../discovery/skills.js';
import { errMsg } from '../discovery/utils.js';
import { BuiltinBaseTool } from './builtin-base-tool.js';

export interface ActivateSkillToolOptions {
  /** 按名称查找已注册技能的 SKILL.md 绝对路径 */
  skillFileLookup?: (name: string) => string | undefined;
  /** 技能根目录列表（每个根下为 `<skillName>/SKILL.md`） */
  skillDirList: () => string[];
  skillMaxChars: number;
}

export const ACTIVATE_SKILL_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: '技能名称' },
  },
  required: ['name'],
};

export class ActivateSkillBuiltinTool extends BuiltinBaseTool {
  readonly name = 'activate_skill';
  readonly description =
    '按名称激活技能，加载其完整指令。当判断某个技能与用户请求相关时使用';
  readonly parameters = ACTIVATE_SKILL_PARAMETERS;
  readonly kind = 'skill';

  constructor(private readonly opts: ActivateSkillToolOptions) {
    super();
    this.tags.push('skill', 'activate');
    this.keywords.push('技能', '激活', '启用', '使用', 'skill', 'activate', 'use');
  }

  async run(args: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    try {
      const name = String(args.name);
      const registeredPath = this.opts.skillFileLookup?.(name);
      if (registeredPath && fs.existsSync(registeredPath)) {
        const fullContent = await fs.promises.readFile(registeredPath, 'utf-8');
        const depWarning = await checkSkillDeps(fullContent);
        const instructions = extractSkillInstructions(name, fullContent, this.opts.skillMaxChars);
        return depWarning ? `${depWarning}\n\n${instructions}` : instructions;
      }
      for (const dir of this.opts.skillDirList()) {
        const skillPath = path.join(dir, name, 'SKILL.md');
        if (fs.existsSync(skillPath)) {
          const fullContent = await fs.promises.readFile(skillPath, 'utf-8');
          const depWarning = await checkSkillDeps(fullContent);
          const instructions = extractSkillInstructions(name, fullContent, this.opts.skillMaxChars);
          return depWarning ? `${depWarning}\n\n${instructions}` : instructions;
        }
      }
      return `Skill '${name}' not found. Check skills/ directory.`;
    } catch (e: unknown) {
      return `Error: ${errMsg(e)}`;
    }
  }
}

export function createActivateSkillTool(opts: ActivateSkillToolOptions): Tool {
  return new ActivateSkillBuiltinTool(opts).toTool();
}
