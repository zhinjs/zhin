/**
 * Convert A2A Message parts to a delegation prompt for ZhinAgent.
 */
import type { Message } from '@a2a-js/sdk';

export { partsToPromptText } from './a2a-parts.js';

export function extractSkillId(message: Message): string | undefined {
  const meta = message.metadata;
  const skill = meta?.skillId ?? meta?.skill_id;
  return typeof skill === 'string' && skill.trim() ? skill.trim() : undefined;
}
