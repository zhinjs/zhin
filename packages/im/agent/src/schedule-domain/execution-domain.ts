import { renderAgentOutput, type AgentOutputElement } from '../outbound/agent-output.js';
import { randomUUID } from 'node:crypto';
import { resolveLocale, type Locale } from '@zhin.js/plugin-runtime';

import type { TurnEvent } from '../event/turn-event.js';
import type { ScheduleJob, ScheduleJobCreator, ScheduleJobExecutionPlan } from '../assistant/types.js';
import type { ZhinAgentConfig } from '../config/zhin-agent-config.js';
import { DEFAULT_CONFIG } from '../config/zhin-agent-defaults.js';
import { BudgetGuard, type ScheduleExecutionBudget } from './budget-guard.js';
import {
  JsonlScheduleAuditLogger,
  createScheduleAuditRecord,
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
  status?: 'succeeded' | 'failed' | 'cancelled' | 'budget_partial';
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
      tools: [], skills: [], resolvedBy: 'affinity', missingTools: [], missingSkills: [],
    };
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
            };
          }
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
    const validation = validateScheduleOutput(raw);
    const suffix = guarded.terminatedBy ? `\n\n[任务因${terminationLabel(guarded.terminatedBy)}被终止]` : '';
    const output = validation.valid ? `${validation.cleaned}${suffix}` : '';
    const durationMs = this.now() - startedAt;
    const acceptedPartial = !options.signal?.aborted && Boolean(guarded.terminatedBy && validation.valid);
    const outcomeError = outcome && outcome.status !== 'completed'
      ? outcome.status === 'failed' ? outcome.error.message
        : outcome.status === 'cancelled' ? outcome.reason
          : `budget exceeded: ${outcome.budget}`
      : undefined;
    const error = acceptedPartial
      ? undefined
      : guarded.error?.message ?? outcomeError
        ?? (validation.valid ? undefined : 'schedule output is empty after validation');
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
      success: Boolean(acceptedPartial || (!guarded.error && outcome?.status === 'completed' && validation.valid)),
      outputLength: output.length,
      outputStripped: validation.stripped,
      error,
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
      status: options.signal?.aborted ? 'cancelled' : acceptedPartial ? 'budget_partial' : audit.success ? 'succeeded' : 'failed',
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
}
