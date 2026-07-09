import type { LoadSkillToolOptions } from '../builtin/load-skill-tool.js';
import { mergeSkillDirsWithResolver, collectPluginSkillSearchRoots } from '../discovery/utils.js';
import { resolveSkillInstructionMaxChars } from '../config/index.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';

/** 构建 readSkillInstructions 所需选项（hostPlugin 须在 configure 时经 emitter 注入） */
export function buildSkillLoadOptsForAgent(host: ZhinAgentPrivate): LoadSkillToolOptions {
  const modelId = host.getTurnProvider().models[0] || host.config.chatModel || 'gpt-4o-mini';
  const skillMaxChars = resolveSkillInstructionMaxChars(host.config, modelId);
  const root = host.emitter.getHostPlugin();
  const skillDirList = root
    ? () => mergeSkillDirsWithResolver(() => collectPluginSkillSearchRoots(root))
    : () => [] as string[];
  const skillFileLookup = (name: string) => host.skillRegistry?.getByName(name)?.filePath;
  return { skillDirList, skillMaxChars, skillFileLookup };
}
