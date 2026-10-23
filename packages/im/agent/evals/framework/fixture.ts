/**
 * Eval case schema. A case describes the inbound traffic, the tools the turn
 * can see (with mocked results), the scripted model responses, and the
 * expected harness behaviour.
 */
import { RESERVED_TOOL_NAME_PREFIXES, RESERVED_TOOL_NAMES } from '../../src/reserved-tools.js';
import type { ZhinAgentConfig } from '../../src/config/zhin-agent-config.js';
import type { TurnPolicyContext } from '../../src/turn/turn-ingress.js';
import type { ScriptStep } from './scripted-model.js';
import type { EvalRunRecord } from './driver.js';
import type { EvalLiveCheck } from './live-checks.js';
import type { MemoryEntryUpsertInput } from '@zhin.js/ai';
import type { ToolInputJsonObjectSchema } from '@zhin.js/tool';
import type { ContextBudgetSegment } from '../../src/trace/context-budget.js';

export type EvalTag = 'long-task' | 'context' | 'memory' | 'injection' | 'tool-use' | 'approval' | 'subagent' | 'quota' | 'multimodal';

export interface EvalInboundMessage {
  readonly text: string;
  /** Defaults to `private`. */
  readonly scope?: 'private' | 'group';
  /** Defaults to `{ id: 'eval-user', roles: ['user'] }`. */
  readonly sender?: Readonly<{ id: string; name?: string; roles?: readonly string[] }>;
  /** Background conversation events rendered as untrusted data before the message. */
  readonly backgroundEvents?: readonly string[];
  /**
   * Grant an isolated shell (the `ai.agent.masterShell: isolated` shape).
   * Only meaningful with a `workspace`; bash still needs `nativeTools`.
   */
  readonly shell?: boolean;
  /** Overrides the default policy derived from the sender (ignores `shell`). */
  readonly policy?: TurnPolicyContext;
  /** Images attached to the message (see `evalImage()` for committed fixtures). */
  readonly images?: readonly EvalImage[];
}

export interface EvalImage {
  /** Base64 payload without a data: prefix. */
  readonly base64: string;
  readonly mimeType: string;
  readonly name?: string;
}

export interface EvalPerception {
  readonly fallbacks?: readonly string[];
  readonly kinds?: readonly ('image' | 'video' | 'file')[];
  readonly maxChars?: number;
  readonly maxItemsPerTurn?: number;
}

export interface EvalTool {
  readonly name: string;
  readonly description?: string;
  /**
   * JSON Schema of the arguments, sent to the model as the tool's parameters.
   * Without it the model sees a tool with no arguments: scripted runs don't
   * care, but a real model (nightly) has nothing to fill in. Cases with `live`
   * checks must declare every argument their script passes.
   */
  readonly parameters?: ToolInputJsonObjectSchema;
  /** Mocked tool result. A function receives the model's arguments. */
  readonly result?: unknown | ((args: Record<string, unknown>) => unknown);
  /** Throw this message instead of returning a result. */
  readonly error?: string;
  readonly requiresApproval?: 'never' | 'once' | 'always';
  /** Keep the tool out of the always-loaded set (reachable via the deferred catalog only). */
  readonly deferred?: boolean;
}

/**
 * Real native tools the case exposes. File tools and bash run against the
 * temporary `workspace`; memory tools run against an in-memory store seeded
 * from `memory`.
 */
export type EvalNativeTool =
  | 'bash' | 'read_file' | 'write_file' | 'edit_file' | 'list_dir' | 'glob' | 'grep'
  | 'memory_search' | 'memory_upsert'
  | 'web_fetch' | 'web_search';

const MEMORY_TOOLS: readonly EvalNativeTool[] = ['memory_search', 'memory_upsert'];
/** Native web tools; their transport never reaches the network in evals. */
export const WEB_TOOLS: readonly EvalNativeTool[] = ['web_fetch', 'web_search'];

/** Seed entry for the semantic-memory store (as written by an earlier turn). */
export type EvalMemoryEntry = MemoryEntryUpsertInput;

/** How the fake approval channel answers approval requests. */
export type EvalApprovalBehaviour = 'approve' | 'deny' | 'unavailable';

export type EvalTermination = 'turn_end' | 'error' | 'turn_cancelled' | 'budget_exceeded';

export interface EvalExpectations {
  readonly toolsCalled?: readonly string[];
  readonly toolsNotCalled?: readonly string[];
  /** Every string must appear somewhere in the outbound text. */
  readonly outboundContains?: readonly string[];
  /** No string may appear anywhere in the outbound text. */
  readonly outboundNotContains?: readonly string[];
  /** Fail when any tool's raw result text is echoed verbatim to the user. */
  readonly noRawToolOutput?: boolean;
  readonly approvalRequested?: boolean | readonly string[];
  /** Every string must appear in at least one approval question (e.g. the provenance chain). */
  readonly approvalQuestionContains?: readonly string[];
  /** Terminal type of the last turn. Defaults to `turn_end`. */
  readonly termination?: EvalTermination;
  /** Exact number of model requests across the case. */
  readonly modelSteps?: number;
  /** Model id of every request, in order (fallback cases). */
  readonly modelIds?: readonly string[];
  /** Bound on model requests across the case. */
  readonly maxModelSteps?: number;
  /** Strings that must appear in what the model received (messages and tool results, not the system prompt). */
  readonly modelInputContains?: readonly string[];
  /** Strings that must appear in what one specific model request received (1-based request number → strings). */
  readonly requestInputContains?: Readonly<Record<number, readonly string[]>>;
  /** Strings that must never appear in what the model received. */
  readonly modelInputNotContains?: readonly string[];
  /** Image blocks the model received, per request in order (multimodal cases). */
  readonly modelImages?: readonly number[];
  /** Strings that must appear in the system prompt of every model request. */
  readonly systemPromptContains?: readonly string[];
  /** Strings that must each appear in the system prompt of at least one model request (e.g. a compaction summary request). */
  readonly anySystemPromptContains?: readonly string[];
  /** Number of reply-port sends across the case (final replies plus progress updates). */
  readonly outboundMessages?: number;
  /** Strings that must not appear in the system prompt of any model request. */
  readonly systemPromptNotContains?: readonly string[];
  /** Bounds on the first turn's estimated context cost. */
  readonly contextBudget?: EvalContextBudgetExpectation;
  /**
   * Tool events that stream consumers must see, in order, as `type:toolName`
   * (e.g. `tool_call:get_weather`, `tool_result:get_weather`, `tool_denied:write_file`).
   */
  readonly streamToolEvents?: readonly string[];
}

/** A skill visible to the turn. Only its name and one-line trigger are resident; instructions load on demand. */
export interface EvalSkill {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  /** Tool names the skill unlocks when loaded. */
  readonly toolNames?: readonly string[];
  readonly keywords?: readonly string[];
}

/** Bounds on the first model request's estimated context cost (see TurnTrace.context_budget). */
export interface EvalContextBudgetExpectation {
  /** Upper bound on fixed tokens (system, tool schemas, catalogs, memory, bootstrap). */
  readonly maxFixedTokens?: number;
  /** Upper bound per segment, e.g. `{ skill_catalog: 400 }`. */
  readonly maxSegmentTokens?: Readonly<Partial<Record<ContextBudgetSegment, number>>>;
  /** Exact number of tools whose schema is sent up front. */
  readonly loadedTools?: number;
}

export interface EvalPromptSection {
  /** Plugin instance key that owns the section. */
  readonly plugin: string;
  readonly title: string;
  readonly content: string;
}

export interface EvalCase {
  readonly id: string;
  readonly description: string;
  /** The concrete problem this case guards against (issue/PR number or incident). */
  readonly source: string;
  /** Skip with this reason (known gap or unmerged dependency); keep the reason actionable. */
  readonly skip?: string;
  readonly tags?: readonly EvalTag[];
  /** One inbound message, or a sequence run as consecutive turns in one session. */
  readonly inbound: EvalInboundMessage | readonly EvalInboundMessage[];
  readonly tools?: readonly EvalTool[];
  readonly skills?: readonly EvalSkill[];
  readonly nativeTools?: readonly EvalNativeTool[];
  /** Files (relative path → content) written to a temporary workspace that becomes the turn's workspaceRoot. */
  readonly workspace?: Readonly<Record<string, string>>;
  /** Semantic-memory entries present before the first turn; they are also recalled per turn (#734). */
  readonly memory?: readonly EvalMemoryEntry[];
  /** Canned stdout for native `bash` (it never runs a real shell in evals). */
  readonly bashOutput?: string;
  readonly approval?: EvalApprovalBehaviour;
  /**
   * Extra model ids registered after the primary `scripted-model`, in fallback
   * order. They become the turn's later `modelCandidates`.
   */
  readonly models?: readonly string[];
  /** Prompt sections contributed by third-party plugins (owned by a child plugin, not the agent's owner). */
  readonly promptSections?: readonly EvalPromptSection[];
  /** Agent config overrides (budget, sub-agent mode, …). */
  readonly agentConfig?: Partial<ZhinAgentConfig>;
  /** Context window of the scripted model (default: the provider preset), for compaction cases. */
  readonly contextWindow?: number;
  /** Per-model input overrides, e.g. `{ 'scripted-fallback': ['text'] }` for a text-only fallback. */
  readonly modelInputs?: Readonly<Record<string, readonly ('text' | 'image' | 'audio' | 'video' | 'file')[]>>;
  /**
   * Enable the `ai.multimodal.perception` pre-pass with a scripted perception
   * model (`scripted-perception`, image/video/file input). Its requests consume
   * script steps like any other; pin them with `model: 'scripted-perception'`.
   */
  readonly perception?: EvalPerception;
  /** Input modalities of the scripted model (default text only). Multimodal cases add `image`. */
  readonly modelInput?: readonly ('text' | 'image' | 'audio' | 'video' | 'file')[];
  readonly script: readonly ScriptStep[];
  /** Unused script steps fail the case unless this is true. */
  readonly allowUnusedSteps?: boolean;
  readonly expect: EvalExpectations;
  /**
   * Real-model tier (#723): semantic checks used when the nightly runner
   * replays this case against a real provider. They must also pass on the
   * scripted run; the PR gate checks that, so they stay honest.
   */
  readonly live?: EvalLiveMode;
}

export interface EvalLiveMode {
  readonly checks: (run: EvalRunRecord) => readonly EvalLiveCheck[];
}

/** Identity helper that gives case files type checking. */
export function defineEvalCase(definition: EvalCase): EvalCase {
  return definition;
}

const CASE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Structural checks that TypeScript cannot express. Returns readable problems. */
export function validateEvalCase(candidate: EvalCase): string[] {
  const problems: string[] = [];
  if (!CASE_ID.test(candidate.id ?? '')) problems.push(`id "${candidate.id}" must be kebab-case`);
  if (!candidate.description?.trim()) problems.push('description is required');
  if (!candidate.source?.trim()) problems.push('source is required (the issue or incident this case guards against)');
  const inbound = Array.isArray(candidate.inbound) ? candidate.inbound : [candidate.inbound];
  if (inbound.length === 0) problems.push('inbound must contain at least one message');
  if (!Array.isArray(candidate.script) || candidate.script.length === 0) problems.push('script must contain at least one step');
  const toolNames = (candidate.tools ?? []).map((tool) => tool.name);
  const duplicates = toolNames.filter((name, index) => toolNames.indexOf(name) !== index);
  if (duplicates.length > 0) problems.push(`duplicate tool names: ${[...new Set(duplicates)].join(', ')}`);
  const workspaceTools = (candidate.nativeTools ?? []).filter((name) => !MEMORY_TOOLS.includes(name) && !WEB_TOOLS.includes(name));
  if (workspaceTools.length && !candidate.workspace) problems.push('file and shell nativeTools need a workspace');
  for (const name of toolNames) {
    if (RESERVED_TOOL_NAMES.includes(name) || RESERVED_TOOL_NAME_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      problems.push(`tool "${name}" uses a reserved built-in name; mocked tools need their own names`);
    }
  }
  candidate.script?.forEach((step, index) => {
    if ('toolCalls' in step && step.toolCalls.length === 0) problems.push(`script step ${index + 1} has an empty toolCalls list`);
  });
  if (candidate.live) {
    // A real model only knows the arguments a tool declares; an undeclared one is never filled in.
    const mocks = new Map((candidate.tools ?? []).map((tool) => [tool.name, tool]));
    for (const step of candidate.script ?? []) {
      if (!('toolCalls' in step)) continue;
      for (const call of step.toolCalls) {
        const tool = mocks.get(call.name);
        if (!tool) continue;
        const missing = Object.keys(call.args ?? {}).filter((arg) => !tool.parameters?.properties[arg]);
        if (missing.length > 0) problems.push(`live case: tool "${call.name}" must declare parameters for ${missing.join(', ')}`);
      }
    }
  }
  return problems;
}

/**
 * Loads case modules (e.g. from `import.meta.glob`) and validates them.
 * Throws one error listing every invalid case and duplicate id.
 */
export function loadEvalCases(modules: Record<string, { default: EvalCase }>): EvalCase[] {
  const problems: string[] = [];
  const cases: EvalCase[] = [];
  const seen = new Map<string, string>();
  for (const [file, module] of Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))) {
    const candidate = module.default;
    if (!candidate) {
      problems.push(`${file}: missing default export`);
      continue;
    }
    for (const problem of validateEvalCase(candidate)) problems.push(`${file}: ${problem}`);
    const previous = seen.get(candidate.id);
    if (previous) problems.push(`${file}: id "${candidate.id}" already used by ${previous}`);
    seen.set(candidate.id, file);
    cases.push(candidate);
  }
  if (problems.length > 0) throw new Error(`Invalid eval cases:\n  - ${problems.join('\n  - ')}`);
  return cases;
}
