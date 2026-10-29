/**
 * Context budget report (#729, M2.1): how many prompt tokens each part of a
 * turn's first model request costs, so context work is driven by data.
 *
 * Numbers are estimates (CJK ≈ 1 token per character, other text ≈ 4
 * characters per token), computed from what the harness actually sends. The
 * provider's real `prompt_tokens` stays in the trace's model calls for
 * comparison. Only sizes are kept; prompt text never enters the report.
 */
import { projectPromptContext, estimateAgentMessagesTokens, type AgentMessage, type AgentTool } from '@zhin.js/ai';
import { estimatePromptTokens } from '../prompt/estimate-tokens.js';
import { AGENT_CATALOG_HEADING, DEFERRED_TOOL_INDEX_HEADING, SKILL_CATALOG_HEADING } from '../skill/capability-catalog.js';
import { SECTION_SEP } from '../config/zhin-agent-constants.js';

/** Prompt segments, in the order the report lists them. */
export const CONTEXT_BUDGET_SEGMENTS = [
  'system',
  'tool_schemas',
  'output_schema',
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

/** Fixed-cost categories; a catalog carried in turn data is deducted separately. */
export const FIXED_CONTEXT_SEGMENTS: ReadonlySet<ContextBudgetSegment> = new Set([
  'system',
  'tool_schemas',
  'output_schema',
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
  /** ADR 0041 segment kind / weight / chars / trimmed (absent in older traces). */
  readonly kind?: string;
  readonly weight?: number;
  readonly chars?: number;
  readonly trimmed?: boolean;
}

/** Snake_case: persisted inside the TurnTrace JSON. */
export interface ContextBudgetReport {
  readonly total_tokens: number;
  /** Fixed segments, excluding the current user-context tool catalog. */
  readonly fixed_tokens: number;
  readonly segments: Readonly<Record<ContextBudgetSegment, number>>;
  /** System prompt sections, largest first. */
  readonly sections: readonly ContextBudgetSection[];
  readonly tools: Readonly<{ loaded: number; deferred: number }>;
}

export interface ContextBudgetInput {
  /** The final system prompt sent to the model. */
  readonly systemPrompt: string;
  readonly outputSchema?: Record<string, unknown>;
  /** Per-section text sizes from the prompt assembly (ids such as `§8_skills`). */
  readonly sections?: readonly Readonly<{
    id: string;
    approxChars: number;
    approxTokens?: number;
    kind?: string;
    weight?: number;
    trimmed?: boolean;
  }>[];
  /** Legacy bootstrap text; current capability catalogs have their own system section. */
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
  // Keep specialist instructions in their previous category; catalog sizes are split out below.
  '§11_capabilities': 'bootstrap',
};

function toolSchemaTokens(tools: readonly AgentTool[]): number {
  return tools.reduce((sum, tool) => sum + estimatePromptTokens(JSON.stringify({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  })), 0);
}

/** Stop at the next heading or assembled section, excluding later reply instructions. */
function headedBlock(text: string, heading: string): string {
  const start = text.indexOf(heading);
  if (start < 0) return '';
  const after = start + heading.length;
  const boundaries = ['\n# ', '\n## ', SECTION_SEP]
    .map(separator => text.indexOf(separator, after))
    .filter(index => index >= 0);
  return text.slice(start, Math.min(text.length, ...boundaries)).trimEnd();
}

function sectionTokens(section: Readonly<{ approxChars: number; approxTokens?: number }>): number {
  return section.approxTokens ?? Math.ceil(section.approxChars / 4);
}

export function buildContextBudgetReport(input: ContextBudgetInput): ContextBudgetReport {
  const systemTokens = estimatePromptTokens(input.systemPrompt);
  const sections = (input.sections ?? [])
    .map((section) => Object.freeze({
      id: section.id,
      tokens: sectionTokens(section),
      ...(section.kind !== undefined ? { kind: section.kind } : {}),
      ...(section.weight !== undefined ? { weight: section.weight } : {}),
      chars: section.approxChars,
      ...(section.trimmed !== undefined ? { trimmed: section.trimmed } : {}),
    }))
    .sort((left, right) => right.tokens - left.tokens);

  const segments: Record<ContextBudgetSegment, number> = Object.fromEntries(
    CONTEXT_BUDGET_SEGMENTS.map((segment) => [segment, 0]),
  ) as Record<ContextBudgetSegment, number>;

  for (const section of sections) {
    const segment = SECTION_SEGMENT[section.id];
    if (segment) segments[segment] += section.tokens;
  }

  // Current turns keep capability catalogs after stable system instructions.
  // Read their rendered text; older callers may still bundle them with bootstrap.
  const catalogSource = sections.some(section => section.id === '§11_capabilities')
    ? input.systemPrompt
    : input.bootstrapContext ?? '';
  if (catalogSource && segments.bootstrap > 0) {
    const skillCatalog = estimatePromptTokens(headedBlock(catalogSource, SKILL_CATALOG_HEADING));
    const agentCatalog = estimatePromptTokens(headedBlock(catalogSource, AGENT_CATALOG_HEADING));
    const attributed = Math.min(segments.bootstrap, skillCatalog + agentCatalog);
    segments.skill_catalog += Math.min(skillCatalog, attributed);
    segments.agent_catalog += attributed - Math.min(skillCatalog, attributed);
    segments.bootstrap -= attributed;
  }

  // Legacy callers may still carry the tool index in system; current turns mark it in user context.
  segments.tool_index = estimatePromptTokens(headedBlock(input.systemPrompt, DEFERRED_TOOL_INDEX_HEADING));

  const attributedSystem = segments.tool_index + segments.skill_catalog + segments.agent_catalog + segments.memory + segments.bootstrap;
  segments.system = Math.max(0, systemTokens - attributedSystem);
  segments.tool_schemas = toolSchemaTokens(input.loadedTools);
  segments.output_schema = input.outputSchema ? estimatePromptTokens(JSON.stringify(input.outputSchema)) : 0;
  const projected = projectPromptContext([...input.historyMessages, ...input.userMessages]);
  segments.history = estimateAgentMessagesTokens(projected.slice(0, input.historyMessages.length));
  const current = projected.slice(input.historyMessages.length);
  const contextTokens = (key: (key: string) => boolean) => current.reduce((total, message) => {
    if (!Array.isArray(message.content)) return total;
    return total + message.content.reduce((sum, block) => sum + (
      block.type === 'text' && typeof block.contextRef?.key === 'string' && key(block.contextRef.key)
        ? estimatePromptTokens(block.text) : 0
    ), 0);
  }, 0);
  const dynamicIndexTokens = contextTokens(key => key === 'deferred-tools');
  segments.tool_index += dynamicIndexTokens;
  const userTokens = estimateAgentMessagesTokens(current);
  const skillTokens = contextTokens(key => key.startsWith('skill:'));
  const hasMarkedSkills = input.userMessages.some(message => Array.isArray(message.content)
    && message.content.some(block => typeof block.contextRef?.key === 'string' && block.contextRef.key.startsWith('skill:')));
  segments.active_skills = Math.min(hasMarkedSkills ? skillTokens : estimatePromptTokens(input.activeSkillsContext ?? ''), userTokens);
  segments.user = Math.max(0, userTokens - segments.active_skills - dynamicIndexTokens);

  const total = CONTEXT_BUDGET_SEGMENTS.reduce((sum, segment) => sum + segments[segment], 0);
  const fixed = CONTEXT_BUDGET_SEGMENTS
    .filter((segment) => FIXED_CONTEXT_SEGMENTS.has(segment))
    .reduce((sum, segment) => sum + segments[segment], 0);

  return Object.freeze({
    total_tokens: total,
    fixed_tokens: fixed - dynamicIndexTokens,
    segments: Object.freeze(segments),
    sections: Object.freeze(sections),
    tools: Object.freeze({ loaded: input.loadedTools.length, deferred: input.deferredToolCount }),
  });
}
