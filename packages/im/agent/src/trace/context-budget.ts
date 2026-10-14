/**
 * Context budget report (#729, M2.1): how many prompt tokens each part of a
 * turn's first model request costs, so context work is driven by data.
 *
 * Numbers are estimates (CJK ≈ 1 token per character, other text ≈ 4
 * characters per token), computed from what the harness actually sends. The
 * provider's real `prompt_tokens` stays in the trace's model calls for
 * comparison. Only sizes are kept; prompt text never enters the report.
 */
import { estimateAgentMessagesTokens, type AgentMessage, type AgentTool } from '@zhin.js/ai';
import { estimatePromptTokens } from '../prompt/estimate-tokens.js';
import { AGENT_CATALOG_HEADING, DEFERRED_TOOL_INDEX_HEADING, SKILL_CATALOG_HEADING } from '../skill/capability-catalog.js';

/** Prompt segments, in the order the report lists them. */
export const CONTEXT_BUDGET_SEGMENTS = [
  'system',
  'tool_schemas',
  'tool_index',
  'skill_catalog',
  'agent_catalog',
  'active_skills',
  'memory',
  'bootstrap',
  'history',
  'user',
] as const;

export type ContextBudgetSegment = (typeof CONTEXT_BUDGET_SEGMENTS)[number];

/** Segments that are paid on every request regardless of the conversation. */
export const FIXED_CONTEXT_SEGMENTS: ReadonlySet<ContextBudgetSegment> = new Set([
  'system',
  'tool_schemas',
  'tool_index',
  'skill_catalog',
  'agent_catalog',
  'memory',
  'bootstrap',
]);

export { estimatePromptTokens };

export interface ContextBudgetSection {
  readonly id: string;
  readonly tokens: number;
}

/** Snake_case: persisted inside the TurnTrace JSON. */
export interface ContextBudgetReport {
  readonly total_tokens: number;
  /** Sum of the segments in FIXED_CONTEXT_SEGMENTS. */
  readonly fixed_tokens: number;
  readonly segments: Readonly<Record<ContextBudgetSegment, number>>;
  /** System prompt sections, largest first. */
  readonly sections: readonly ContextBudgetSection[];
  readonly tools: Readonly<{ loaded: number; deferred: number }>;
}

export interface ContextBudgetInput {
  /** The final system prompt sent to the model. */
  readonly systemPrompt: string;
  /** Per-section text sizes from the prompt assembly (ids such as `§8_skills`). */
  readonly sections?: readonly Readonly<{ id: string; approxChars: number; approxTokens?: number }>[];
  /** Bootstrap text that went into the system prompt; capability catalogs are attributed out of it. */
  readonly bootstrapContext?: string;
  /** Loaded skill instructions; the turn envelope carries them inside the user message. */
  readonly activeSkillsContext?: string;
  /** Tools whose full schema is sent on the request. */
  readonly loadedTools: readonly AgentTool[];
  /** Number of catalog tools reachable only via discover / load_tool. */
  readonly deferredToolCount: number;
  readonly historyMessages: readonly AgentMessage[];
  readonly userMessages: readonly AgentMessage[];
}

const SECTION_SEGMENT: Readonly<Record<string, ContextBudgetSegment>> = {
  '§8_skills': 'skill_catalog',
  '§5e_memory_instructions': 'memory',
  '§11_bootstrap': 'bootstrap',
};

function toolSchemaTokens(tools: readonly AgentTool[]): number {
  return tools.reduce((sum, tool) => sum + estimatePromptTokens(JSON.stringify({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  })), 0);
}

/** Text of the block that starts at `heading` and runs to the next `## ` heading. */
function headedBlock(text: string, heading: string): string {
  const start = text.indexOf(heading);
  if (start < 0) return '';
  const next = text.indexOf('\n## ', start + heading.length);
  return text.slice(start, next < 0 ? text.length : next);
}

function sectionTokens(section: Readonly<{ approxChars: number; approxTokens?: number }>): number {
  return section.approxTokens ?? Math.ceil(section.approxChars / 4);
}

export function buildContextBudgetReport(input: ContextBudgetInput): ContextBudgetReport {
  const systemTokens = estimatePromptTokens(input.systemPrompt);
  const sections = (input.sections ?? [])
    .map((section) => Object.freeze({ id: section.id, tokens: sectionTokens(section) }))
    .sort((left, right) => right.tokens - left.tokens);

  const segments: Record<ContextBudgetSegment, number> = Object.fromEntries(
    CONTEXT_BUDGET_SEGMENTS.map((segment) => [segment, 0]),
  ) as Record<ContextBudgetSegment, number>;

  for (const section of sections) {
    const segment = SECTION_SEGMENT[section.id];
    if (segment) segments[segment] += section.tokens;
  }

  // The plugin runtime renders skill/agent catalogs into the bootstrap block.
  const bootstrap = input.bootstrapContext ?? '';
  if (bootstrap && segments.bootstrap > 0) {
    const skillCatalog = estimatePromptTokens(headedBlock(bootstrap, SKILL_CATALOG_HEADING));
    const agentCatalog = estimatePromptTokens(headedBlock(bootstrap, AGENT_CATALOG_HEADING));
    const attributed = Math.min(segments.bootstrap, skillCatalog + agentCatalog);
    segments.skill_catalog += Math.min(skillCatalog, attributed);
    segments.agent_catalog += attributed - Math.min(skillCatalog, attributed);
    segments.bootstrap -= attributed;
  }

  // The deferred tool index is appended to the system prompt after assembly.
  segments.tool_index = estimatePromptTokens(headedBlock(input.systemPrompt, DEFERRED_TOOL_INDEX_HEADING));

  const attributedSystem = segments.tool_index + segments.skill_catalog + segments.agent_catalog + segments.memory + segments.bootstrap;
  segments.system = Math.max(0, systemTokens - attributedSystem);
  segments.tool_schemas = toolSchemaTokens(input.loadedTools);
  segments.history = estimateAgentMessagesTokens([...input.historyMessages]);

  const userTokens = estimateAgentMessagesTokens([...input.userMessages]);
  segments.active_skills = Math.min(estimatePromptTokens(input.activeSkillsContext ?? ''), userTokens);
  segments.user = userTokens - segments.active_skills;

  const total = CONTEXT_BUDGET_SEGMENTS.reduce((sum, segment) => sum + segments[segment], 0);
  const fixed = CONTEXT_BUDGET_SEGMENTS
    .filter((segment) => FIXED_CONTEXT_SEGMENTS.has(segment))
    .reduce((sum, segment) => sum + segments[segment], 0);

  return Object.freeze({
    total_tokens: total,
    fixed_tokens: fixed,
    segments: Object.freeze(segments),
    sections: Object.freeze(sections),
    tools: Object.freeze({ loaded: input.loadedTools.length, deferred: input.deferredToolCount }),
  });
}
