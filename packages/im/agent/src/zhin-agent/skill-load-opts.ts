import { getHostRootPlugin } from '@zhin.js/core';
import type { LoadSkillToolOptions } from '../builtin/load-skill-tool.js';
import { mergeSkillDirsWithResolver, collectPluginSkillSearchRoots } from '../discovery/utils.js';
import { resolveSkillInstructionMaxChars } from './config.js';
import type { ZhinAgentPrivate } from './zhin-agent-private.js';

/** 构建 readSkillInstructions 所需选项（与 agent-loop-turn 一致） */
export function buildSkillLoadOptsForAgent(host: ZhinAgentPrivate): LoadSkillToolOptions {
  const modelId = host.getTurnProvider().models[0] || host.config.chatModel || 'gpt-4o-mini';
  const skillMaxChars = resolveSkillInstructionMaxChars(host.config, modelId);
  let skillDirList = () => [] as string[];
  let skillFileLookup: ((name: string) => string | undefined) | undefined;
  try {
    const root = getHostRootPlugin();
    if (root) {
      skillDirList = () => mergeSkillDirsWithResolver(() => collectPluginSkillSearchRoots(root));
    }
    skillFileLookup = (name: string) => host.skillRegistry?.getByName(name)?.filePath;
  } catch {
    skillFileLookup = (name: string) => host.skillRegistry?.getByName(name)?.filePath;
  }
  return { skillDirList, skillMaxChars, skillFileLookup };
}
