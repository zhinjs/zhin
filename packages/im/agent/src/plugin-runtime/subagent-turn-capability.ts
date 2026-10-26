import { EMPTY_DEFERRED_TOOL_SNAPSHOT, createUserMessage } from '@zhin.js/ai';
import { createScopedTraceJournal } from '../trace/turn-trace-registry.js';
import type { AgentCore } from '../core/agent-core.js';
import { collectAgentLoopTurnRun } from '../core/agent-core-run.js';
import { resolveToolBudget } from '../core/turn-progress.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import type { PluginAILoopHookRegistry } from '../plugin-loop-hooks.js';
import { TurnToolExecutionAuthority, TurnToolRuntime } from '../tool/turn-tool-runtime.js';
import { createTurnIngress, type TurnIngress, type TurnPolicyContext } from '../turn/turn-ingress.js';
import type { AgentCapabilities, ToolCapability } from './capability-ingress.js';
import { createDeferredCapabilityPlan } from './deferred-capability-plan.js';
import { BASH_TOOL_NAME, turnPolicyAllowsShell } from './native-bash-tool.js';
import { deriveSubagentPolicy } from '../security/policy-narrowing.js';
import {
  isToolAboveTrust,
  narrowPolicyForTrust,
  renderExternalContent,
  resolveTurnTrustLevel,
} from '../security/trust-level.js';

export const SUBAGENT_TOOL_NAME = 'spawn_task';
/** Sub-agent output handed back to the parent model; the parent writes the user reply. */
export const MAX_SUBAGENT_RESULT_CHARS = 4_000;

export interface SubagentModelSelection {
  readonly modelId: string;
  readonly modelCandidates: readonly string[];
}

export interface SubagentTurnCapabilityOptions {
  readonly host: ZhinAgentPrivate;
  readonly core: AgentCore;
  readonly parentTurn: TurnIngress;
  /** The parent's exact, already-authorized generation projection. */
  readonly capabilities: AgentCapabilities;
  readonly loopHooks?: PluginAILoopHookRegistry;
  /** Resolved lazily: the parent's prompt (and model choice) is built after its capability plan. */
  readonly resolveModel: () => SubagentModelSelection | undefined;
}

export { deriveSubagentPolicy, type SubagentPolicyNarrowing } from '../security/policy-narrowing.js';

const INPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    task: { type: 'string', description: 'Self-contained task for the sub-agent, including target files and expected result' },
    label: { type: 'string', description: 'Short label for the task' },
    read_only: { type: 'boolean', description: 'Restrict the sub-agent to reading (no shell, no writes)' },
  }),
  required: Object.freeze(['task']),
}) as unknown as ToolCapability['inputSchema'];

const SUBAGENT_PERSONA = [
  'You are a sub-agent executing one delegated task for the main assistant.',
  'Work only on that task with the tools you have; you cannot delegate further.',
  'Finish with a concise report of what you found or changed (files, results, open questions).',
  'Do not greet or address the end user; the main assistant writes the reply.',
].join('\n');

/**
 * `spawn_task` for the plugin-runtime turn path: runs a synchronous child turn
 * inside the parent turn. The child reuses the parent's origin, principal and
 * approval/question ports, so approvals reach the same conversation and
 * requester with typed outcomes, and an unattended parent yields an unattended
 * child with no interactive ports. Results return to the parent model only.
 */
export function createSubagentTurnCapability(options: SubagentTurnCapabilityOptions): ToolCapability {
  let spawned = 0;
  let active = 0;
  const execute = async (input: unknown): Promise<string> => {
    const args = (input ?? {}) as Record<string, unknown>;
    const task = typeof args.task === 'string' ? args.task.trim() : '';
    const label = typeof args.label === 'string' && args.label.trim() ? `「${args.label.trim()}」` : '';
    if (!task) return '子任务未启动（同步等待）：请提供 task。';
    const limit = Math.max(1, options.host.config.maxParallelSubagents ?? 1);
    if (active >= limit) {
      return `子任务${label}未启动（同步等待）：已达到并行子任务上限 ${limit}，请等待已有子任务完成。`;
    }
    const model = options.resolveModel();
    if (!model) return `子任务${label}未启动（同步等待）：当前回合没有可用模型。`;
    spawned += 1;
    active += 1;
    try {
      const reply = await runSubagentTurn(options, {
        index: spawned,
        task,
        readOnly: args.read_only === true,
        model,
      });
      // The report is external_content: instructions in it never raise the parent's authority.
      return `子任务${label}已完成（同步等待）。\n\n${renderExternalContent('subagent_report', clip(reply))}`;
    } catch (error) {
      if (options.parentTurn.signal.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      return `子任务${label}失败（同步等待）：${message}`;
    } finally {
      active -= 1;
    }
  };
  return Object.freeze({
    owner: options.capabilities.owner,
    name: SUBAGENT_TOOL_NAME,
    qualifiedName: SUBAGENT_TOOL_NAME,
    description: 'Delegate a self-contained task to a sub-agent and wait for its report. '
      + 'The sub-agent has at most your own tools and permissions (never more) and cannot delegate further. '
      + 'Use it for focused multi-step work; give it target files and the expected result.',
    inputSchema: INPUT_SCHEMA,
    requiresApproval: 'never' as const,
    source: 'builtin:subagent',
    execute: execute as ToolCapability['execute'],
  });
}

async function runSubagentTurn(
  options: SubagentTurnCapabilityOptions,
  run: Readonly<{ index: number; task: string; readOnly: boolean; model: SubagentModelSelection }>,
): Promise<string> {
  const { host, parentTurn } = options;
  // #726: a sub-agent keeps its initiator's trust level even if the parent's
  // policy or tool list was not already narrowed.
  const trustLevel = resolveTurnTrustLevel(parentTurn);
  const policy = narrowPolicyForTrust(
    deriveSubagentPolicy(parentTurn.policy, { readOnly: run.readOnly }),
    trustLevel,
  );
  const shellAllowed = turnPolicyAllowsShell(policy);
  const childTools = Object.freeze(options.capabilities.tools.filter(tool =>
    tool.name !== SUBAGENT_TOOL_NAME
    && (shellAllowed || tool.name !== BASH_TOOL_NAME)
    && !isToolAboveTrust(tool, trustLevel)));
  const turnId = `${parentTurn.identity.turnId}:subagent:${run.index}`;
  const sessionKey = `${parentTurn.session.key}#subagent:${run.index}`;
  const turn = createTurnIngress({
    identity: Object.freeze({ ...parentTurn.identity, turnId }),
    origin: parentTurn.origin,
    principal: parentTurn.principal,
    intent: Object.freeze({ kind: 'new' as const }),
    input: Object.freeze({ text: run.task, locale: parentTurn.input.locale, commandPrefix: parentTurn.input.commandPrefix, commandMenu: parentTurn.input.commandMenu }),
    session: Object.freeze({ key: sessionKey }),
    policy,
    capabilities: Object.freeze({
      tools: Object.freeze(childTools.map(tool => tool.name)),
      skills: Object.freeze([]),
    }),
    signal: parentTurn.signal,
    ports: Object.freeze({
      // Child tool events land in the parent's journal for one audit trail.
      journal: createScopedTraceJournal(parentTurn.ports.journal, { turnId, sessionKey }),
      ...(parentTurn.ports.approval ? { approval: parentTurn.ports.approval } : {}),
      ...(parentTurn.ports.question ? { question: parentTurn.ports.question } : {}),
    }),
  });
  const plan = createDeferredCapabilityPlan({
    capabilities: Object.freeze({ ...options.capabilities, tools: childTools, skills: Object.freeze([]) }),
    sessionSnapshot: structuredClone(EMPTY_DEFERRED_TOOL_SNAPSHOT),
    config: host.config,
    platform: parentTurn.origin.kind === 'im' ? parentTurn.origin.platform : undefined,
    persistSnapshot: async () => undefined,
  });
  const runtime = new TurnToolRuntime(turn, plan.capabilities);
  const result = await collectAgentLoopTurnRun(options.core.runText({
    host,
    sessionId: sessionKey,
    rawContent: run.task,
    promptProfile: { kind: 'interactive' },
    turnContext: turn,
    allTools: [...plan.allTools],
    resolvedTools: [...plan.resolvedTools],
    toolExecution: new TurnToolExecutionAuthority(runtime),
    toolEventSource: 'authority',
    loopHooks: options.loopHooks,
    promptRuntime: {
      agentNickname: host.activeBinding?.nickname,
      modelId: run.model.modelId,
      providerAlias: host.activeBinding?.providerAlias,
    },
    personaEnhanced: SUBAGENT_PERSONA,
    modelId: run.model.modelId,
    modelCandidates: [...run.model.modelCandidates],
    initialMessages: [createUserMessage(run.task)],
    signal: parentTurn.signal,
    deferredStats: plan.deferredStats,
    deferredController: plan.controller,
    toolCatalog: plan.catalog,
    toolLoading: 'deferred',
    conversationPersistence: 'none',
    maxIterations: host.config.maxSubagentIterations,
    // Same progress-aware budget, lower hard cap, and no auto-continuation:
    // an unfinished sub-agent reports back to the parent instead.
    maxTotalIterations: resolveToolBudget(host.config.toolBudget).maxSubagentTotalIterations,
    autoContinuation: false,
    generation: parentTurn.identity.generation,
  }));
  return result.reply.trim() || '子任务结束，但没有生成报告。';
}

function clip(text: string): string {
  return text.length > MAX_SUBAGENT_RESULT_CHARS
    ? `${text.slice(0, MAX_SUBAGENT_RESULT_CHARS)}\n…（子任务报告已截断）`
    : text;
}
