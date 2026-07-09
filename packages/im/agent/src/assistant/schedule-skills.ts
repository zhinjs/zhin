import { readSkillInstructions } from '../builtin/load-skill-tool.js';
import { buildSkillLoadOptsForAgent } from '../zhin-agent/skill-load-opts.js';
import { setTurnActiveSkills } from '../zhin-agent/turn-context.js';
import type { ZhinAgentPrivate } from '../zhin-agent/zhin-agent-private.js';

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
    const skillLoadOpts = buildSkillLoadOptsForAgent(host);
    for (const skillName of snapshot.loadedSkills) {
      const skill = host.skillRegistry.getByName(skillName);
      if (!skill) continue;
      const instructions = await readSkillInstructions(skill.name, skillLoadOpts);
      if (instructions.startsWith(`Skill '${skill.name}' not found`)) continue;
      parts.push(instructions);
    }
  }

  setTurnActiveSkills(parts.join('\n\n'));
}
