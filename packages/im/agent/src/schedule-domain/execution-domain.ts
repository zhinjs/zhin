import { randomUUID } from 'node:crypto';
import type { OutputElement } from '@zhin.js/ai';
import type { Message } from '@zhin.js/core';
import type { TurnEvent } from '../event/turn-event.js';
import type { ScheduleJob } from '../assistant/types.js';
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
import { createScheduleSecurityContext } from './security-harness.js';

export interface ScheduleExecutionResult {
  success: boolean;
  output: string;
  durationMs: number;
  toolsUsed: string[];
  tokenUsage: { input: number; output: number };
  error?: string;
  audit: ScheduleAuditRecord;
}

export interface ScheduleExecutionOptions {
  preview?: boolean;
}

export interface ScheduleExecutionDomain {
  execute(job: ScheduleJob, message: Message, options?: ScheduleExecutionOptions): Promise<ScheduleExecutionResult>;
}

export interface ScheduleAgentPort {
  config: Required<ZhinAgentConfig>;
  processTurn(request: {
    content: string;
    message: Message;
    signal?: AbortSignal;
    activityFeedbackEligible?: boolean;
    scheduleContext?: import('../internal/host-types.js').HostScheduleTurnContext;
    onChunk?: (chunk: string, full: string) => void;
    onTurnEvent?: (event: TurnEvent) => void;
  }): Promise<OutputElement[]>;
}

export interface ScheduleExecutionDomainDeps {
  agent: ScheduleAgentPort;
  auditLogger?: ScheduleAuditLogger;
  now?: () => number;
}

function textFromElements(elements: OutputElement[]): string {
  return elements.map(element => {
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
  private readonly auditLogger: ScheduleAuditLogger;
  private readonly now: () => number;

  constructor(private readonly deps: ScheduleExecutionDomainDeps) {
    this.auditLogger = deps.auditLogger ?? new JsonlScheduleAuditLogger();
    this.now = deps.now ?? Date.now;
  }

  async execute(
    job: ScheduleJob,
    message: Message,
    options: ScheduleExecutionOptions = {},
  ): Promise<ScheduleExecutionResult> {
    const startedAt = this.now();
    const executionId = randomUUID();
    const prompt = job.executionPlan?.prompt?.trim() || job.action.prompt.trim();
    const scheduleContext: import('../internal/host-types.js').HostScheduleTurnContext = {
      jobId: job.id,
      preview: options.preview || undefined,
      executionPlan: job.executionPlan,
      createdBy: job.createdBy,
      activityFeedback: job.activityFeedback,
      security: createScheduleSecurityContext(
        this.deps.agent.config.schedule?.security?.execPreset ?? 'readonly',
        this.deps.agent.config.schedule?.security?.allowedDomains ?? [],
      ),
      securityDenials: [],
    };
    const guard = new BudgetGuard(resolveBudget(this.deps.agent.config, job));
    let streamed = '';
    let usageSeen = false;
    let cumulativeUsage = { input: 0, output: 0 };

    const guarded = await guard.run(async budget => this.deps.agent.processTurn({
        content: prompt,
        message,
        signal: budget.signal,
        scheduleContext,
        activityFeedbackEligible: false,
        onChunk: (_chunk, full) => { streamed = full; },
        onTurnEvent: (event: TurnEvent) => {
          if (event.type === 'tool_call') budget.onToolCall(event.toolName);
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
    }));
    const raw = guarded.value ? textFromElements(guarded.value) : streamed;
    const validation = validateScheduleOutput(raw);
    const suffix = guarded.terminatedBy ? `\n\n[任务因${terminationLabel(guarded.terminatedBy)}被终止]` : '';
    const output = validation.valid ? `${validation.cleaned}${suffix}` : '';
    const durationMs = this.now() - startedAt;
    const resolution = scheduleContext.toolResolution ?? {
      tools: [], skills: [], resolvedBy: 'affinity' as const, missingTools: [], missingSkills: [],
    };
    const acceptedPartial = Boolean(guarded.terminatedBy && validation.valid);
    const error = acceptedPartial
      ? undefined
      : guarded.error?.message ?? (validation.valid ? undefined : 'schedule output is empty after validation');
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
      securityDenials: scheduleContext.securityDenials,
      success: acceptedPartial || (!guarded.error && validation.valid),
      outputLength: output.length,
      outputStripped: validation.stripped,
      error,
    });
    await this.auditLogger.write(audit);
    return {
      success: audit.success,
      output,
      durationMs,
      toolsUsed: guarded.toolCalls,
      tokenUsage: guarded.tokenUsage,
      error: audit.error,
      audit,
    };
  }
}
