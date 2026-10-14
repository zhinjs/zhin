/**
 * Eval case schema. A case describes the inbound traffic, the tools the turn
 * can see (with mocked results), the scripted model responses, and the
 * expected harness behaviour.
 */
import { RESERVED_TOOL_NAME_PREFIXES, RESERVED_TOOL_NAMES } from '../../src/reserved-tools.js';
import type { ZhinAgentConfig } from '../../src/config/zhin-agent-config.js';
import type { TurnPolicyContext } from '../../src/turn/turn-ingress.js';
import type { ScriptStep } from './scripted-model.js';

export type EvalTag = 'long-task' | 'context' | 'memory' | 'injection' | 'tool-use' | 'approval' | 'subagent';

export interface EvalInboundMessage {
  readonly text: string;
  /** Defaults to `private`. */
  readonly scope?: 'private' | 'group';
  /** Defaults to `{ id: 'eval-user', roles: ['user'] }`. */
  readonly sender?: Readonly<{ id: string; name?: string; roles?: readonly string[] }>;
  /** Background conversation events rendered as untrusted data before the message. */
  readonly backgroundEvents?: readonly string[];
  /** Overrides the default policy derived from the sender. */
  readonly policy?: TurnPolicyContext;
}

export interface EvalTool {
  readonly name: string;
  readonly description?: string;
  /** Mocked tool result. A function receives the model's arguments. */
  readonly result?: unknown | ((args: Record<string, unknown>) => unknown);
  /** Throw this message instead of returning a result. */
  readonly error?: string;
  readonly requiresApproval?: 'never' | 'once' | 'always';
}

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
  /** Terminal type of the last turn. Defaults to `turn_end`. */
  readonly termination?: EvalTermination;
  /** Exact number of model requests across the case. */
  readonly modelSteps?: number;
  /** Bound on model requests across the case. */
  readonly maxModelSteps?: number;
}

export interface EvalCase {
  readonly id: string;
  readonly description: string;
  readonly tags?: readonly EvalTag[];
  /** One inbound message, or a sequence run as consecutive turns in one session. */
  readonly inbound: EvalInboundMessage | readonly EvalInboundMessage[];
  readonly tools?: readonly EvalTool[];
  readonly approval?: EvalApprovalBehaviour;
  /** Agent config overrides (budget, sub-agent mode, …). */
  readonly agentConfig?: Partial<ZhinAgentConfig>;
  readonly script: readonly ScriptStep[];
  /** Unused script steps fail the case unless this is true. */
  readonly allowUnusedSteps?: boolean;
  readonly expect: EvalExpectations;
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
  const inbound = Array.isArray(candidate.inbound) ? candidate.inbound : [candidate.inbound];
  if (inbound.length === 0) problems.push('inbound must contain at least one message');
  if (!Array.isArray(candidate.script) || candidate.script.length === 0) problems.push('script must contain at least one step');
  const toolNames = (candidate.tools ?? []).map((tool) => tool.name);
  const duplicates = toolNames.filter((name, index) => toolNames.indexOf(name) !== index);
  if (duplicates.length > 0) problems.push(`duplicate tool names: ${[...new Set(duplicates)].join(', ')}`);
  for (const name of toolNames) {
    if (RESERVED_TOOL_NAMES.includes(name) || RESERVED_TOOL_NAME_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      problems.push(`tool "${name}" uses a reserved built-in name; mocked tools need their own names`);
    }
  }
  candidate.script?.forEach((step, index) => {
    if ('toolCalls' in step && step.toolCalls.length === 0) problems.push(`script step ${index + 1} has an empty toolCalls list`);
  });
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
