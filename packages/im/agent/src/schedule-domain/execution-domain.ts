import { renderAgentOutput, type AgentOutputElement } from '../outbound/agent-output.js';
import { randomUUID } from 'node:crypto';
import { resolveLocale, type Locale } from '@zhin.js/plugin-runtime';

import type { ReplyFallback, TurnEvent } from '../event/turn-event.js';
import { formatReplyFallback, inlineToolName } from '../core/tool-calls-user-format.js';
import { chatFailureKindOf } from '../outbound/chat-failure.js';
import { isTransientModelFailure, type ScheduleModelFailure } from './model-failure.js';
import type { ScheduleJob, ScheduleJobCreator, ScheduleJobExecutionPlan, ScheduleJobProvenance } from '../assistant/types.js';
import type { ZhinAgentConfig } from '../config/zhin-agent-config.js';
import { DEFAULT_CONFIG } from '../config/zhin-agent-defaults.js';
import { BudgetGuard, type ScheduleExecutionBudget } from './budget-guard.js';
import {
  JsonlScheduleAuditLogger,
  createScheduleAuditRecord,
  type ScheduleRunDegradation,
  type ScheduleAuditLogger,
  type ScheduleAuditRecord,
} from './audit-logger.js';
import { validateScheduleOutput } from './output-validator.js';
import { createScheduleSecurityContext, type ScheduleSecurityDenial } from './security-harness.js';
import type { TurnOutcome } from '../turn/turn-ingress.js';
import { AttemptReplayEvidence, type ReplayEvidence } from './replay-evidence.js';
import type { ScheduleAttemptContext } from './attempt-context.js';
import type { ToolOperationEvidencePort } from '../tool/tool-operation-evidence.js';
import type { ScheduleObservationOwner } from './execution-history.js';
import { ScheduleExecutionHistory } from './execution-history-store.js';
import { ScheduleHistoryReporter } from './history-observer.js';

export interface ScheduleExecutionResult {
  success: boolean;
  output: string;
  durationMs: number;
  toolsUsed: string[];
  tokenUsage: { input: number; output: number };
  error?: string;
  audit: ScheduleAuditRecord;
  replay?: ReplayEvidence;
  /**
   * `degraded` (#1250 b33): the run finished and its reply was delivered, but it did not do what was asked
   * (no tool, a denied tool, or the framework's fallback instead of a reply); `error` says why.
   */
  status?: 'succeeded' | 'failed' | 'cancelled' | 'budget_partial' | 'degraded';
  degraded?: ScheduleRunDegradation;
  /**
   * #1250 b40 schedule-failed-run-marked-ok: the run failed because a model request failed. `transient`:
   * the model service was temporarily unavailable (network, 5xx, timeout), so a later retry may succeed.
   */
  modelFailure?: ScheduleModelFailure;
}



export interface ScheduleExecutionOptions {
  preview?: boolean;
  signal?: AbortSignal;
  attempt?: ScheduleAttemptContext;
}

export interface ScheduleExecutionDomain {
  execute(job: ScheduleJob, options?: ScheduleExecutionOptions): Promise<ScheduleExecutionResult>;
  dispose?(): void;
}

export interface ScheduleTurnExecutionRequest {
  readonly locale?: Locale;
  readonly executionId: string;
  readonly jobId: string;
  readonly prompt: string;
  readonly agent?: string;
  readonly preview: boolean;
  readonly createdBy?: ScheduleJobCreator;
  readonly executionPlan?: ScheduleJobExecutionPlan;
  /** ADR 0067 D2.1: restored into the run's provenance (`scheduled_prompt`). */
  readonly provenance?: ScheduleJobProvenance;
  readonly security: ReturnType<typeof createScheduleSecurityContext>;
  readonly signal: AbortSignal;
  readonly onTurnEvent: (event: TurnEvent) => void;
  readonly operationEvidence: ToolOperationEvidencePort;
}

export interface ScheduleTurnPort {
  execute(request: ScheduleTurnExecutionRequest): Promise<TurnOutcome>;
}

export interface ScheduleExecutionDomainDeps {
  turn: ScheduleTurnPort;
  config: Required<ZhinAgentConfig>;
  auditLogger?: ScheduleAuditLogger;
  now?: () => number;
  observations?: ScheduleObservationOwner;
}

function textFromElements(elements: AgentOutputElement[]): string {
  return elements.map(element => {
    if (element.type === 'message') return renderAgentOutput([element]);
    if (element.type === 'text') return element.content || '';
    if (element.type === 'image') return `<image url="${element.url}"/>`;
    return '';
  }).join('\n').trim();
}

function resolveBudget(config: Required<ZhinAgentConfig>, job: ScheduleJob): ScheduleExecutionBudget {
  const global = config.schedule?.budget ?? DEFAULT_CONFIG.schedule?.budget ?? {};
  return {
    maxTokens: job.budget?.maxTokens ?? global.maxTokens ?? 32_000,
    maxToolCalls: job.budget?.maxToolCalls ?? global.maxToolCalls ?? 15,
    timeoutMs: job.budget?.timeoutMs ?? global.timeoutMs ?? 120_000,
  };
}

function terminationLabel(reason: NonNullable<ScheduleAuditRecord['budgetTerminated']>): string {
  if (reason === 'token_limit') return 'token 预算耗尽';
  if (reason === 'tool_limit') return '工具调用预算耗尽';
  return '执行超时';
}

export class ScheduleExecutionDomainImpl implements ScheduleExecutionDomain {
  private readonly now: () => number;
  readonly #ownedObservations?: ScheduleExecutionHistory;
  readonly #history: ScheduleHistoryReporter;

  constructor(private readonly deps: ScheduleExecutionDomainDeps) {
    this.#ownedObservations = deps.observations ? undefined : new ScheduleExecutionHistory({ auditLogger: deps.auditLogger ?? new JsonlScheduleAuditLogger() });
    this.#history = new ScheduleHistoryReporter(undefined, deps.observations ?? this.#ownedObservations);
    this.now = deps.now ?? Date.now;
  }

  async execute(
    job: ScheduleJob,
    options: ScheduleExecutionOptions = {},
  ): Promise<ScheduleExecutionResult> {
    options.signal?.throwIfAborted();
    const startedAt = this.now();
    const executionId = options.attempt?.identity.attemptId ?? randomUUID();
    const evidence = options.attempt?.evidence ?? new AttemptReplayEvidence();
    const prompt = job.executionPlan?.prompt?.trim() || job.action.prompt.trim();
    const security = createScheduleSecurityContext(
      this.deps.config.schedule?.security?.execPreset ?? 'readonly',
      this.deps.config.schedule?.security?.allowedDomains ?? [],
    );
    const securityDenials: ScheduleSecurityDenial[] = [];
    let resolution: ScheduleToolResolution = {
      tools: [], skills: [], resolvedBy: 'affinity', missingTools: [], missingSkills: [], warnings: [],
    };
    let fallback: ReplyFallback | undefined;
    let modelError: Readonly<{ kind: string; message: string; service?: string }> | undefined;
    let toolResults = 0;
    const guard = new BudgetGuard(resolveBudget(this.deps.config, job));
    let streamed = '';
    let usageSeen = false;
    let cumulativeUsage = { input: 0, output: 0 };

    const guarded = await guard.run(async budget => this.deps.turn.execute({
        executionId,
        jobId: job.id,
        locale: resolveLocale(job.locale),
        prompt,
        agent: job.action.kind === 'agent' ? job.action.agent : undefined,
        preview: options.preview === true,
        createdBy: job.createdBy,
        executionPlan: job.executionPlan,
        ...(job.provenance ? { provenance: job.provenance } : {}),
        security,
        signal: budget.signal,
        operationEvidence: evidence,
        onTurnEvent: (event: TurnEvent) => {
          const attempt = options.attempt;
          if (attempt) {
            const common = { type: 'attempt_progress' as const, runId: attempt.identity.runId,
              jobId: job.id, attemptId: executionId, at: this.now() };
            if (event.type === 'iteration_start' || event.type === 'turn_start' || event.type === 'turn_end'
              || event.type === 'error' || event.type === 'turn_cancelled' || event.type === 'budget_exceeded') {
              void attempt.history.observe({ ...common, phase: 'model', status: event.type });
            } else if (event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'tool_failed'
              || event.type === 'tool_cancelled' || event.type === 'tool_denied') {
              void attempt.history.observe({ ...common, phase: event.type === 'tool_denied' ? 'approval' : 'tool',
                status: event.type, toolName: event.toolName, toolUseId: event.toolUseId,
                ...(event.type === 'tool_denied' ? { code: event.policy } : {}) });
            }
          }
          if (event.type === 'chunk') streamed = event.accumulated;
          if (event.type === 'capability_resolution') {
            resolution = {
              tools: [...event.tools],
              skills: [...event.skills],
              resolvedBy: event.resolvedBy === 'session' ? 'affinity' : event.resolvedBy,
              missingTools: [...event.missingTools],
              missingSkills: [...event.missingSkills],
              warnings: [...(event.warnings ?? [])],
              ...(event.unattendedApproval ? { unattendedApproval: event.unattendedApproval } : {}),
            };
          }
          if (event.type === 'turn_end' && event.fallback) fallback = event.fallback;
          if (event.type === 'turn_end' && event.modelFailure) modelError = event.modelFailure;
          if (event.type === 'tool_result') toolResults += 1;
          if (event.type === 'tool_call') budget.onToolCall(event.toolName);
          if (event.type === 'tool_denied') {
            securityDenials.push({ tool: event.toolName, policy: event.policy, reason: event.reason });
          }
          if (event.type === 'usage') {
            usageSeen = true;
            cumulativeUsage = {
              input: cumulativeUsage.input + event.usage.promptTokens,
              output: cumulativeUsage.output + event.usage.completionTokens,
            };
            budget.onUsage(cumulativeUsage.input, cumulativeUsage.output);
          } else if (event.type === 'turn_end' && !usageSeen) {
            budget.onUsage(event.usage.promptTokens, event.usage.completionTokens);
          }
        },
    }), options.signal);
    const outcome = guarded.value;
    const completedOutput = outcome?.status === 'completed' ? outcome.output : [];
    const raw = completedOutput.length > 0 ? textFromElements([...completedOutput]) : streamed;
    // #1250 b33: the framework's fallback is re-worded with the job's name; the rest of the reply stays.
    const scheduleContext = { jobId: job.id, ...(job.label ? { label: job.label } : {}), turnId: executionId };
    const degradedRaw = fallback && outcome?.status === 'completed'
      ? formatReplyFallback(fallback, { schedule: scheduleContext, locale: resolveLocale(job.locale) }) : raw;
    const validation = validateScheduleOutput(degradedRaw);
    const suffix = guarded.terminatedBy ? `\n\n[任务因${terminationLabel(guarded.terminatedBy)}被终止]` : '';
    const output = validation.valid ? `${validation.cleaned}${suffix}` : '';
    const durationMs = this.now() - startedAt;
    const acceptedPartial = !options.signal?.aborted && Boolean(guarded.terminatedBy && validation.valid);
    const outcomeError = outcome && outcome.status !== 'completed'
      ? outcome.status === 'failed' ? outcome.error.message
        : outcome.status === 'cancelled' ? outcome.reason
          : `budget exceeded: ${outcome.budget}`
      : undefined;
    // #1250 b40: a turn that ended on a failed model request (its reply is the failure text) failed.
    const thrownKind = outcome?.status === 'failed' ? chatFailureKindOf(outcome.error.message) : undefined;
    const modelFailure: ScheduleModelFailure | undefined = options.signal?.aborted ? undefined
      : outcome?.status === 'completed' && modelError
        ? Object.freeze({ kind: modelError.kind, transient: isTransientModelFailure(modelError.kind),
          ...(modelError.service ? { service: modelError.service } : {}) })
        : thrownKind && thrownKind !== 'unknown'
          ? Object.freeze({ kind: thrownKind, transient: isTransientModelFailure(thrownKind) })
          : undefined;
    const modelFailureError = modelFailure
      ? `模型调用失败（${modelFailure.kind}）：${modelError?.message ?? outcomeError ?? ''}；排查：zhin trace ${executionId}`
      : undefined;
    const failureError = acceptedPartial
      ? undefined
      : modelFailureError ?? guarded.error?.message ?? outcomeError
        ?? (validation.valid ? undefined : 'schedule output is empty after validation');
    const succeeded = Boolean(acceptedPartial || (!guarded.error && !modelFailure && outcome?.status === 'completed' && validation.valid));
    // #1250 b33: a finished run that used the fallback text, ran without any tool result and with an empty
    // reply, or had a tool denied did not do what was asked: it is recorded as degraded, not ok.
    const degraded = succeeded
      ? detectDegradation({ fallback, denials: securityDenials, toolResults, reply: raw })
      : undefined;
    const error = failureError ?? (degraded ? describeDegradation(degraded, executionId) : undefined);
    const audit = createScheduleAuditRecord({
      jobId: job.id,
      executionId,
      timestamp: startedAt,
      createdBy: job.createdBy,
      prompt,
      toolsResolved: resolution.tools,
      toolsResolvedBy: resolution.resolvedBy,
      skillsResolved: resolution.skills,
      missingTools: resolution.missingTools,
      missingSkills: resolution.missingSkills,
      toolsUsed: guarded.toolCalls,
      tokenUsage: guarded.tokenUsage,
      durationMs,
      budgetTerminated: guarded.terminatedBy,
      securityDenials,
      success: succeeded,
      outputLength: output.length,
      outputStripped: validation.stripped,
      error,
      ...(resolution.warnings.length ? { warnings: [...resolution.warnings] } : {}),
      ...(resolution.unattendedApproval ? { unattendedApproval: resolution.unattendedApproval } : {}),
      ...(degraded ? { degraded } : {}),
    });
    (options.attempt?.history ?? this.#history).audit({ attempt: options.attempt?.identity ?? {
      runId: executionId, jobId: job.id, attemptId: executionId, number: 1, startedAt,
    }, record: audit });
    return {
      success: audit.success,
      output,
      durationMs,
      toolsUsed: guarded.toolCalls,
      tokenUsage: guarded.tokenUsage,
      error: audit.error,
      audit,
      replay: evidence.snapshot(),
      status: options.signal?.aborted ? 'cancelled' : acceptedPartial ? 'budget_partial'
        : audit.success ? degraded ? 'degraded' : 'succeeded' : 'failed',
      ...(degraded ? { degraded } : {}),
      ...(modelFailure ? { modelFailure } : {}),
    };
  }

  dispose(): void { this.#ownedObservations?.close(); }

}

interface ScheduleToolResolution {
  tools: string[];
  skills: string[];
  resolvedBy: 'execution-plan' | 'affinity';
  missingTools: string[];
  missingSkills: string[];
  warnings: string[];
  unattendedApproval?: ScheduleAuditRecord['unattendedApproval'];
}

/** #1250 b33: why a finished run did not do what was asked, or undefined when it did. */
export function detectDegradation(input: Readonly<{
  fallback?: ReplyFallback;
  denials: readonly ScheduleSecurityDenial[];
  toolResults: number;
  reply: string;
}>): ScheduleRunDegradation | undefined {
  const denied = [...new Set(input.denials.map(denial => denial.tool))];
  if (input.fallback) {
    const tools = input.fallback.tools?.length ? input.fallback.tools : denied;
    return Object.freeze({ cause: input.fallback.cause === 'empty_reply' && denied.length ? 'tool_denied' : input.fallback.cause,
      ...(tools.length ? { tools: Object.freeze([...tools]) } : {}), fallback: true });
  }
  if (denied.length) return Object.freeze({ cause: 'tool_denied', tools: Object.freeze(denied), fallback: false });
  if (input.toolResults === 0 && !input.reply.trim()) return Object.freeze({ cause: 'empty_reply', fallback: false });
  return undefined;
}

/** `last_error` text of a degraded run: the cause, the tools involved and where to look. */
export function describeDegradation(degraded: ScheduleRunDegradation, turnId: string): string {
  const tools = degraded.tools?.length ? degraded.tools.map(inlineToolName).join('、') : '';
  const cause = degraded.cause === 'no_tools' ? '没有可用的工具，模型没有给出回复'
    : degraded.cause === 'tool_denied' ? `工具${tools ? ` ${tools} ` : ''}被拒绝，没有运行`
      : '模型没有返回可见内容';
  return `${cause}${degraded.fallback ? '（已发送兜底说明）' : ''}；排查：zhin trace ${turnId}`;
}
