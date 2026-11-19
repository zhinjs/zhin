/** Generation-owned schedule management and canonical Agent Tool definitions. */
import {
  defineAgentTool,
  type AgentToolDefinition,
  type ToolInputJsonObjectSchema,
  type ToolInputJsonSchema,
  type ToolExecutionContext,
} from '@zhin.js/tool';
import {
  addScheduleJob,
  generateScheduleJobId,
  parseScheduleAddFromToolArgs,
  type ScheduleInvocationContext,
} from './assistant/schedule-job-service.js';
import { ADMIN_APPROVABLE_TOOL_TAG } from './security/admin-approvable.js';
import type { TimerScheduler } from './assistant/timer-scheduler.js';
import type { SchedulePreviewOptions, TaskExecutionResult } from './task-executor.js';
import { currentTurnProvenance } from './security/provenance.js';
import type { ScheduleAuditRecord } from './schedule-domain/audit-logger.js';
import { isEmptyExecutionPlan } from './plugin-runtime/schedule-capability-plan.js';
import { checkScheduleAgent, usableScheduleAgents } from './assistant/schedule-agent.js';
import { getAgentTurnConfiguration } from './turn/agent-turn-context.js';
import { DEFAULT_ZHIN_AGENT_NAME } from './config/types.js';
import { scheduleJobChangeRefusal, scheduleJobVisibleTo } from './assistant/job-ownership.js';
import type { ScheduleJob } from './assistant/types.js';

/** #1250 b55: `schedule_list` shows an Agent the caller cannot see in this turn as this, unnamed. */
export const HIDDEN_SCHEDULE_AGENT = '其他 Agent';

export const SCHEDULE_JOBS_FILENAME = 'schedule-jobs.json';

export interface ScheduleManager {
  scheduleFeature: {
    getStatus(): Array<{
      id: string;
      kind: string;
      expression?: string;
      running: boolean;
      nextExecution: Date | null;
      plugin: string;
    }>;
  };
  engine: TimerScheduler | null;
  /**
   * Agents a job may run on (`zhin` and `ai.agents` bindings), #1250 b52. Absent: `schedule_add`
   * accepts no `agent`.
   */
  agents?: () => readonly string[];
  previewTask?: (
    prompt: string,
    context: ScheduleInvocationContext,
    options?: SchedulePreviewOptions,
  ) => Promise<TaskExecutionResult>;
}

export interface ScheduleToolRegistration {
  readonly name: string;
  readonly definition: Readonly<AgentToolDefinition<Record<string, unknown>, unknown>>;
}

export { generateScheduleJobId };

function schema(
  properties: Record<string, ToolInputJsonSchema> = {},
  required: readonly string[] = [],
): ToolInputJsonObjectSchema {
  return Object.freeze({ type: 'object', properties: Object.freeze(properties), required: Object.freeze([...required]) });
}

function registration(
  name: string,
  description: string,
  inputSchema: ToolInputJsonObjectSchema,
  execute: (input: Record<string, unknown>, context: ToolExecutionContext) => unknown | Promise<unknown>,
  tags?: readonly string[],
): ScheduleToolRegistration {
  return Object.freeze({
    name,
    definition: defineAgentTool<Record<string, unknown>, unknown>({
      description,
      inputSchema,
      execute,
      ...(tags ? { tags } : {}),
    }),
  });
}

export function createScheduleTools(manager: ScheduleManager): readonly ScheduleToolRegistration[] {
  return Object.freeze([
    registration(
      'schedule_list',
      '列出调度任务：插件内存任务，以及持久化任务（项目数据库 agent_schedule_jobs 表；无 SQL 数据库时为 data/schedule-jobs.json），含下次运行时间 state.nextRunAtMs。'
        + '所有者看到全部持久化任务；其他人只看到自己创建的任务和投递到当前会话的任务',
      schema(),
      async (_input, context) => {
        // Plugin memory jobs name only the plugin and its cron: no prompt, target or Agent.
        const memory = manager.scheduleFeature.getStatus();
        const agents = manager.agents?.();
        // #1250 b55: the Agents this turn can see (`@name` routing), plus the default.
        const visibleAgents = new Set([DEFAULT_ZHIN_AGENT_NAME, ...(getAgentTurnConfiguration()?.availableAgents ?? [])]);
        const persistent = manager.engine
          ? (await manager.engine.listJobs())
              .filter((job) => scheduleJobVisibleTo(job, context))
              .map((job) => ({
                type: 'persistent' as const,
                id: job.id,
                schedule: job.schedule,
                prompt: job.action.kind === 'agent' ? job.action.prompt : undefined,
                ...listedAgent(job, agents, visibleAgents),
                label: job.label,
                enabled: job.enabled,
                notify: job.notify,
                createdAt: job.createdAt,
                state: job.state,
              }))
          : [];
        return { memory, persistent };
      },
    ),
    registration(
      'schedule_add',
      '添加持久化调度任务。中国大陆工作日必须使用 workday；支持 6 段 cron 或 delay_minutes 一次性任务。',
      schema({
        schedule_kind: { type: 'string', description: 'solar|lunar|workday|freeDay|holiday，默认 solar' },
        cron: { type: 'string', description: '6 段 cron（秒 分 时 日 月 周）' },
        delay_minutes: { type: 'number', description: '一次性延迟（分钟）' },
        prompt: { type: 'string', description: '到点 prompt' },
        label: { type: 'string', description: '标签' },
        notify_channel: { type: 'string', description: 'im | silent | log' },
        activity_feedback: { type: 'boolean', description: '是否发布 activity feedback' },
        budget_max_tokens: { type: 'number', description: 'token 硬上限' },
        budget_max_tool_calls: { type: 'number', description: '工具调用硬上限' },
        budget_timeout_ms: { type: 'number', description: '执行超时毫秒数' },
        execution_plan: { type: 'object', description: '预演确认后的执行计划' },
        refined_prompt: { type: 'string', description: '预演 refine 后的 prompt' },
        tools: { type: 'string', description: '逗号分隔的工具名' },
        skills: { type: 'string', description: '逗号分隔的技能名' },
        agent: { type: 'string', description: '可选：到点由哪个 Agent 执行（Agent 名称）；省略时用默认 Agent。只能指定当前用户可用的 Agent' },
      }, ['prompt']),
      async (input, context) => {
        if (!manager?.engine) return { error: '持久化调度引擎不可用' };
        const parsed = parseScheduleAddFromToolArgs(input, context);
        if ('error' in parsed) return { error: parsed.error };
        // #1250 b52: only an Agent the caller may use in this conversation (the same set `@name`
        // routing offers them); without a runtime turn, only the default.
        const usable = usableScheduleAgents(manager.agents?.() ?? [], getAgentTurnConfiguration()?.availableAgents);
        const agent = checkScheduleAgent(input.agent, usable);
        if ('error' in agent) return { error: agent.error };
        // ADR 0067 D2.1: a job created after the turn read anything keeps that, and every run starts tainted.
        const provenance = currentTurnProvenance()?.snapshotForSchedule();
        const job = await addScheduleJob(manager.engine, { ...parsed, ...agent, id: generateScheduleJobId(),
          ...(provenance ? { provenance } : {}) });
        // #1250 b33: a plan without tools or skills is accepted (it falls back to prompt-based selection
        // when the job runs), but the caller is told, so it can preview and pass the tools explicitly.
        const warning = isEmptyExecutionPlan(job.executionPlan)
          ? '执行计划没有指定工具或技能：到点时将按提示词自动选择工具。建议先用 schedule_preview 预演，再把 execution_plan 一起传给 schedule_add。'
          : undefined;
        if (job.schedule.kind === 'at') {
          const time = new Date(job.schedule.atMs).toLocaleString('zh-CN', { hour12: false });
          return { success: true, id: job.id, message: `已安排一次性任务，将在 ${time} 执行`, ...(warning ? { warning } : {}) };
        }
        return { success: true, id: job.id, message: '已添加调度任务', ...(warning ? { warning } : {}) };
      },
      // #1250: an admin may confirm creating a scheduled task in their own private chat (allow once).
      [ADMIN_APPROVABLE_TOOL_TAG],
    ),
    registration(
      'schedule_preview',
      '预演调度任务；返回建议执行计划，确认后用 schedule_add 创建正式任务。',
      schema({
        prompt: { type: 'string', description: '任务 prompt' },
        activity_feedback: { type: 'boolean', description: '是否发布 activity feedback' },
      }, ['prompt']),
      async (input, context) => {
        if (!manager?.previewTask) return { error: '预演服务不可用' };
        // ADR 0067 D2.1: the preview runs the prompt now, with the calling turn's provenance.
        const provenance = currentTurnProvenance()?.snapshotForSchedule();
        const result = await manager.previewTask(String(input.prompt), context, {
          activityFeedback: input.activity_feedback === true,
          ...(provenance ? { provenance } : {}),
        });
        if (!result.success) return { error: result.error || '预演失败' };
        const unattended = describeUnattendedPreview(result.audit.unattendedApproval);
        return {
          success: true,
          preview: result.responseText,
          execution_plan: result.executionPlan,
          ...(unattended ? { unattended_approval: unattended.detail } : {}),
          ...(result.status === 'degraded' ? { warning: `预演没有完成任务：${result.error ?? ''}` } : {}),
          message: ['预演完成。确认无误后使用 schedule_add 并传入 execution_plan 创建正式任务。', unattended?.message]
            .filter(Boolean).join(''),
        };
      },
    ),
    ...(['remove', 'pause', 'resume'] as const).map((operation) => registration(
      `schedule_${operation}`,
      `${operation === 'remove' ? '删除' : operation === 'pause' ? '暂停' : '恢复'}持久化调度任务（按任务 ID）`,
      schema({ id: { type: 'string', description: '任务 ID' } }, ['id']),
      async (input, context) => {
        if (!manager?.engine) return { error: '引擎不可用' };
        const id = String(input.id ?? '');
        // #1250 b55: an owner manages any job; anyone else only the jobs they created. A profile
        // routine is changed in the Assistant Profile (a change here is reverted on restart).
        const job = (await manager.engine.listJobs()).find((entry) => entry.id === id);
        if (!job) return { error: '未找到' };
        const refusal = scheduleJobChangeRefusal(job, context);
        if (refusal) return { error: refusal };
        const changed = operation === 'remove'
          ? await manager.engine.removeJob(id)
          : operation === 'pause'
            ? await manager.engine.pauseJob(id)
            : await manager.engine.resumeJob(id);
        return changed ? { success: true } : { error: '未找到' };
      },
    )),
  ]);
}

/**
 * The `agent` fields of a listed job (#1250 b52 / b55): an Agent removed from `ai.agents` is named
 * and flagged (`agent_missing`: its runs fail until changed); a configured Agent the caller's turn
 * cannot see is shown as {@link HIDDEN_SCHEDULE_AGENT}, without its name.
 */
function listedAgent(
  job: ScheduleJob,
  agents: readonly string[] | undefined,
  visible: ReadonlySet<string>,
): { agent?: string; agent_missing?: true; agent_hidden?: true } {
  const agent = job.action.kind === 'agent' ? job.action.agent : undefined;
  if (!agent) return {};
  if (agents && !agents.includes(agent)) return { agent, agent_missing: true };
  return visible.has(agent) ? { agent } : { agent: HIDDEN_SCHEDULE_AGENT, agent_hidden: true };
}

/**
 * #1250 b33: what `schedule_preview` tells the caller about tools an unattended run cannot use freely.
 * Informative only: approval is decided per call when the job runs.
 */
export function describeUnattendedPreview(
  info: ScheduleAuditRecord['unattendedApproval'],
): { detail: NonNullable<ScheduleAuditRecord['unattendedApproval']>; message: string } | undefined {
  if (!info || (info.denied.length === 0 && info.reviewed.length === 0)) return undefined;
  const parts: string[] = [];
  if (info.denied.length) {
    parts.push(`无人值守执行时，这些工具会被拒绝：${info.denied.map(name => `\`${name}\``).join('、')}。`);
  }
  if (info.reviewed.length) {
    parts.push(`这些工具需要审批，到点时交给自动审核，审核拒绝则不执行：${info.reviewed.map(name => `\`${name}\``).join('、')}。`);
  }
  return { detail: info, message: parts.join('') };
}
