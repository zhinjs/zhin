import { mergeSkillDirsWithResolver } from '../discovery/utils.js';
import { resolveSkillInstructionMaxChars } from '../config/index.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import { SkillInstructionReader, type SkillInstructionSource } from './skill-instruction-reader.js';

/** Bind Skill discovery rules and model-specific limits for one Agent runtime. */
export function buildSkillInstructionReaderForAgent(host: ZhinAgentPrivate): SkillInstructionSource {
  const modelId = host.getTurnExecution().model.id;
  return new SkillInstructionReader({
    maxChars: resolveSkillInstructionMaxChars(host.config, modelId),
    directories: () => mergeSkillDirsWithResolver(),
    registeredFile: (name) => host.skillRegistry?.getByName(name)?.filePath,
  });
}
