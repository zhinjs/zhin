/**
 * load_skill — 按名称加载技能指令（取代 activate_skill）
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Tool, Message, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { checkSkillDeps, extractSkillInstructions } from '../discovery/skills.js';
import { errMsg } from '../discovery/utils.js';
import { BuiltinBaseTool } from './builtin-base-tool.js';

export interface LoadSkillToolOptions {
  skillFileLookup?: (name: string) => string | undefined;
  skillDirList: () => string[];
  skillMaxChars: number;
}

export const LOAD_SKILL_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Skill name' },
  },
  required: ['name'],
};

export async function readSkillInstructions(
  name: string,
  opts: LoadSkillToolOptions,
): Promise<string> {
  const registeredPath = opts.skillFileLookup?.(name);
  if (registeredPath && fs.existsSync(registeredPath)) {
    const fullContent = await fs.promises.readFile(registeredPath, 'utf-8');
    const depWarning = await checkSkillDeps(fullContent);
    const instructions = extractSkillInstructions(name, fullContent, opts.skillMaxChars);
    return depWarning ? `${depWarning}\n\n${instructions}` : instructions;
  }
  for (const dir of opts.skillDirList()) {
    const skillPath = path.join(dir, name, 'SKILL.md');
    if (fs.existsSync(skillPath)) {
      const fullContent = await fs.promises.readFile(skillPath, 'utf-8');
      const depWarning = await checkSkillDeps(fullContent);
      const instructions = extractSkillInstructions(name, fullContent, opts.skillMaxChars);
      return depWarning ? `${depWarning}\n\n${instructions}` : instructions;
    }
  }
  return `Skill '${name}' not found. Check skills/ directory.`;
}

export class LoadSkillBuiltinTool extends BuiltinBaseTool {
  readonly name = 'load_skill';
  readonly description =
    'Load full skill instructions by name. Call after discover finds a relevant skill; unlocks tools linked to the skill.';
  readonly parameters = LOAD_SKILL_PARAMETERS;
  readonly kind = 'skill';

  constructor(private readonly opts: LoadSkillToolOptions) {
    super();
    this.tags.push('skill', 'load');
    this.keywords.push('技能', '加载', 'skill', 'load');
  }

  async run(args: Record<string, unknown>, _commMessage?: Message): Promise<ToolResult> {
    try {
      const name = String(args.name);
      return await readSkillInstructions(name, this.opts);
    } catch (e: unknown) {
      return `Error: ${errMsg(e)}`;
    }
  }
}

export function createLoadSkillTool(opts: LoadSkillToolOptions): Tool {
  return new LoadSkillBuiltinTool(opts).toTool();
}
