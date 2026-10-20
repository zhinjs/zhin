/**
 * Skills progressive disclosure — Eve-aligned discover → load_skill (ADR 0039 P1).
 */

/** Builtin meta tools for on-demand skill loading. */
export const SKILL_DISCLOSURE_TOOLS = ['discover', 'load_skill'] as const;

/** Recommended agent turn sequence for deferred skills. */
export const SKILL_DISCLOSURE_STEPS = [
  'discover(kind=skill, query=...)',
  'load_skill(name)',
  'call tools unlocked by the skill',
] as const;

export const SKILL_DISCLOSURE_PROMPT_HINT =
  'Skills are not fully injected upfront. Use discover(kind=skill) to search, '
  + 'then load_skill(name) before following skill-specific procedures.';
