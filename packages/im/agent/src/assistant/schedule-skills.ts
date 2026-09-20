import { buildSkillInstructionReaderForAgent } from '../skill/skill-instruction-reader-factory.js';
import { setTurnActiveSkills } from '../internal/turn-context.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';

export async function rehydrateTurnActiveSkills(
  host: ZhinAgentPrivate,
  sessionId: string,
  alwaysSkillsBaseline: string,
): Promise<void> {
  const snapshot = await host.contextRepository.getDeferredToolSnapshot(sessionId);
  const parts: string[] = [];
  if (alwaysSkillsBaseline.trim()) {
    parts.push(alwaysSkillsBaseline.trim());
  }

  if (snapshot.loadedSkills.length && host.skillRegistry) {
    const skillInstructions = buildSkillInstructionReaderForAgent(host);
    for (const skillName of snapshot.loadedSkills) {
      const skill = host.skillRegistry.getByName(skillName);
      if (!skill) continue;
      const result = await skillInstructions.read(skill.name);
      if (result.status === 'found') parts.push(result.instructions);
    }
  }

  setTurnActiveSkills(parts.join('\n\n'));
}
