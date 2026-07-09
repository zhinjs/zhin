/**
 * Skill System — SkillRegistry 统一出口（契约见 contracts.ts）。
 */

export type {
  Skill,
  SkillSearchResult,
  SkillSearchOptions,
  SkillSystemConfig,
  TurnContext,
} from './contracts.js';

export {
  SkillSystem,
  createSkillSystem,
  defaultSkillSystem,
} from './skill-system.js';

export { SkillRegistry } from '../orchestrator/skill-registry.js';
export type { Skill as OrchestratorSkill, SkillMetadata } from '../orchestrator/types.js';
