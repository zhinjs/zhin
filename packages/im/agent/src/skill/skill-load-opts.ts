import type { LoadSkillToolOptions } from '../builtin/load-skill-tool.js';
import { mergeSkillDirsWithResolver } from '../discovery/utils.js';
import { resolveSkillInstructionMaxChars } from '../config/index.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';

/** 构建 readSkillInstructions 所需选项。 */
export function buildSkillLoadOptsForAgent(host: ZhinAgentPrivate): LoadSkillToolOptions {
  const modelId = host.getTurnProvider().models[0] || host.config.chatModel || 'gpt-4o-mini';
  const skillMaxChars = resolveSkillInstructionMaxChars(host.config, modelId);
  const skillDirList = () => mergeSkillDirsWithResolver();
  const skillFileLookup = (name: string) => host.skillRegistry?.getByName(name)?.filePath;
  return { skillDirList, skillMaxChars, skillFileLookup };
}
