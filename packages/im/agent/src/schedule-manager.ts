/** Generation-owned schedule management and canonical Agent Tool definitions. */
import {
  defineAgentTool,
  type AgentToolDefinition,
  type ToolInputJsonObjectSchema,
  type ToolInputJsonSchema,
  type ToolExecutionContext,
} from '@zhin.js/tool';
import { formatDateTime } from '@zhin.js/plugin-runtime';
import {
  addScheduleJob,
  generateScheduleJobId,
  parseScheduleAddFromToolArgs,
  parseScheduleUpdateFromToolArgs,
  type ScheduleInvocationContext,
} from './assistant/schedule-job-service.js';
import { ADMIN_APPROVABLE_TOOL_TAG } from './security/admin-approvable.js';
import type { TimerScheduler } from './assistant/timer-scheduler.js';
import type { SchedulePreviewOptions, TaskExecutionResult } from './task-executor.js';
import { TRUSTED_OUTPUT_TAG, UNTRUSTED_FAILURE_TAG, currentTurnProvenance } from './security/provenance.js';
import type { ScheduleAuditRecord } from './schedule-domain/audit-logger.js';
import { isEmptyExecutionPlan } from './plugin-runtime/schedule-capability-plan.js';
import { checkScheduleAgent, usableScheduleAgents } from './assistant/schedule-agent.js';
import { getAgentTurnConfiguration } from './turn/agent-turn-context.js';
import { DEFAULT_ZHIN_AGENT_NAME } from './config/types.js';
import {
  isScheduleOwner, scheduleJobChangeRefusal, scheduleJobNotManageable, scheduleJobVisibleTo,
} from './assistant/job-ownership.js';
import type { JobSchedule, ScheduleJob } from './assistant/types.js';

/**
 * #1250 b98: tags of the Host's schedule write tools, whose successful results carry only what the
 * harness wrote (ids, the saved timing, the enabled state, fixed messages) and what the caller wrote in
 * this call, never text someone else wrote (a job's prompt or a label the call did not set). They are
 * trusted output (not a source for the provenance gate); a failure still counts as external content.
 * Only these definitions carry them: a plugin tool of the same name is judged by its own declaration.
 */
const HARNESS_RESULT_TAGS = Object.freeze([TRUSTED_OUTPUT_TAG, UNTRUSTED_FAILURE_TAG]);

/** Holiday names a schedule may filter on (`@zhin.js/schedule` `FestivalName`). */
const FESTIVAL_NAMES: ReadonlySet<string> = new Set(['元旦', '春节', '清明节', '劳动节', '端午节', '中秋节', '国庆节']);
/**
 * One cron field: digits, `*`, `?`, `,`, `/`, `-`, `#`, `L`, `W` and the month / weekday names. A saved
 * cron was already parsed by the scheduler; this only keeps anything else out of the result.
 */
const CRON_FIELD = /^(?:[0-9*?,/#-]|L|W|MON|TUE|WED|THU|FRI|SAT|SUN|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)+$/iu;
/** An IANA zone name such as `Asia/Shanghai` or `Etc/GMT-8`. */
const TIME_ZONE_TEXT = /^[A-Za-z0-9_+\-/]{1,64}$/u;

/**
 * #1250 b55: `prompt` of `schedule_add` / `schedule_preview` is what runs when the job is due, not the
 * request to create the job: a preview given "remind me at 8 tomorrow to drink water" used to try to
 * create the job itself (and could not, being unattended).
 */
export const SCHEDULE_PROMPT_DESCRIPTION = '到点要执行的内容（例如「提醒我喝水」），不是建任务的请求，不要包含时间安排'
  + '（时间放在 cron / delay_minutes 里）';

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
  options: Readonly<{ readOnly?: boolean; requiresApproval?: 'never' }> = {},
): ScheduleToolRegistration {
  return Object.freeze({
    name,
    definition: defineAgentTool<Record<string, unknown>, unknown>({
      description,
      inputSchema,
      execute,
      ...(tags ? { tags } : {}),
      ...(options.readOnly ? { readOnly: true } : {}),
      ...(options.requiresApproval ? { requiresApproval: options.requiresApproval } : {}),
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
        const owner = isScheduleOwner(context);
        const persistent = manager.engine
          ? (await manager.engine.listJobs())
              .filter((job) => scheduleJobVisibleTo(job, context))
              .map((job) => ({
                type: 'persistent' as const,
                id: job.id,
                schedule: job.schedule,
                prompt: job.action.kind === 'agent' ? job.action.prompt : undefined,
                ...listedAgent(job, agents, visibleAgents, owner),
                label: job.label,
                enabled: job.enabled,
                notify: job.notify,
                createdAt: job.createdAt,
                state: job.state,
              }))
          : [];
        return { memory, persistent };
      },
      undefined,
      // #1250: a lookup; it is not a schedule write and needs no confirmation of its own. #1250 b91: nor
      // an approval: under `on-risk` its schedule name kept the declarative approval (a card for the owner
      // with master shell `ask`, a refusal for a member nobody can approve for). `never` is set here, on
      // the Host's own tool only; `readOnlyDeclarationApplies` keeps refusing the relaxation to plugin
      // tools with config / schedule names. Rows stay filtered by `scheduleJobVisibleTo`, the tool stays
      // `readOnly` and its output stays external content (a source for the provenance gate).
      { readOnly: true, requiresApproval: 'never' },
    ),
    registration(
      'schedule_add',
      '添加持久化调度任务。中国大陆工作日必须使用 workday；支持 6 段 cron 或 delay_minutes 一次性任务。'
        + '要修改已有任务（改时间、标签、启用状态）请用 schedule_update，不要删除后重建：重建会丢掉隐藏的 Agent 等设置。',
      schema({
        schedule_kind: { type: 'string', description: 'solar|lunar|workday|freeDay|holiday，默认 solar' },
        cron: { type: 'string', description: '6 段 cron（秒 分 时 日 月 周）' },
        delay_minutes: { type: 'number', description: '一次性延迟（分钟）' },
        prompt: { type: 'string', description: SCHEDULE_PROMPT_DESCRIPTION },
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
          // #1250: the repository's date format, in the process zone as before (`at` jobs carry no zone).
          const time = formatDateTime(job.schedule.atMs);
          return { success: true, id: job.id, message: `已安排一次性任务，将在 ${time} 执行`, ...(warning ? { warning } : {}) };
        }
        return { success: true, id: job.id, message: '已添加调度任务', ...(warning ? { warning } : {}) };
      },
      // #1250: an admin may confirm creating a scheduled task in their own private chat (allow once).
      // b98: its result (the new id, fixed messages, the run time) is harness output; the prompt is not echoed.
      [ADMIN_APPROVABLE_TOOL_TAG, ...HARNESS_RESULT_TAGS],
    ),
    registration(
      'schedule_preview',
      '预演调度任务：现在试运行一次到点要执行的内容，返回建议执行计划；不会创建任务，确认后用 schedule_add 创建正式任务。'
        + '预演里没有 schedule_* 工具。',
      schema({
        prompt: { type: 'string', description: SCHEDULE_PROMPT_DESCRIPTION },
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
    registration(
      'schedule_update',
      '修改持久化调度任务（按任务 ID）：只改计划时间（cron / schedule_kind / delay_minutes）、标签和启用状态；'
        + '任务的 Agent、提示词、投递目标与创建者保持不变。修改已有任务请用它，不要删除后重建。'
        + '只给 cron 时沿用任务原来的 schedule_kind，只给 schedule_kind 时沿用原来的 cron。',
      schema({
        id: { type: 'string', description: '任务 ID' },
        cron: { type: 'string', description: '新的 6 段 cron（秒 分 时 日 月 周）' },
        schedule_kind: { type: 'string', description: 'solar|lunar|workday|freeDay|holiday；省略时沿用原来的' },
        delay_minutes: { type: 'number', description: '改为一次性任务：从现在起延迟的分钟数（大于 0；不能与 cron 同时给）' },
        label: { type: 'string', description: '新标签；空字符串清除标签' },
        enabled: { type: 'boolean', description: 'true 启用，false 停用' },
      }, ['id']),
      async (input, context) => {
        if (!manager?.engine) return { error: '引擎不可用' };
        const id = String(input.id ?? '');
        // #1250 b55 / b90: the same ownership rules as schedule_remove / pause / resume.
        const notFound = isScheduleOwner(context) ? '未找到' : scheduleJobNotManageable(id);
        const job = (await manager.engine.listJobs()).find((entry) => entry.id === id);
        if (!job) return { error: notFound };
        const refusal = scheduleJobChangeRefusal(job, context);
        if (refusal) return { error: refusal };
        const update = parseScheduleUpdateFromToolArgs(input, job);
        if ('error' in update) return { error: update.error };
        let updated: ScheduleJob | null;
        try {
          updated = await manager.engine.updateJob(id, update);
        } catch (error) {
          return { error: `计划无效，任务未修改: ${error instanceof Error ? error.message : String(error)}` };
        }
        if (!updated) return { error: notFound };
        const next = updated.enabled && typeof updated.state?.nextRunAtMs === 'number'
          ? formatDateTime(updated.state.nextRunAtMs)
          : undefined;
        // Enabled but never firing (e.g. a cron date that does not exist): saved, but say so.
        const stuck = updated.enabled && next === undefined && updated.schedule.kind !== 'event';
        // #1250 b98: only what the harness wrote, plus the label this call set (`null`: cleared). A label
        // this call did not set may be someone else's text (an owner may change anyone's job): not echoed.
        return {
          success: true,
          id,
          schedule: scheduleResult(updated.schedule),
          ...(update.label !== undefined ? { label: update.label } : {}),
          enabled: updated.enabled,
          ...(next ? { next_run: next } : {}),
          message: '已更新调度任务；Agent、提示词与投递目标保持不变',
          ...(stuck ? { warning: '任务已启用，但按新计划算不出下次运行时间，它不会自动执行；请检查 cron 或改用其他计划' } : {}),
        };
      },
      // #1250: like schedule_add, an admin may confirm changing a scheduled task in their own private chat.
      // b98: its result is harness output (see `HARNESS_RESULT_TAGS`), so a second change of the same job in
      // the turn keeps the confirmation.
      [ADMIN_APPROVABLE_TOOL_TAG, ...HARNESS_RESULT_TAGS],
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
        // A non-owner gets the same reply for a missing job and someone else's.
        const notFound = isScheduleOwner(context) ? '未找到' : scheduleJobNotManageable(id);
        const job = (await manager.engine.listJobs()).find((entry) => entry.id === id);
        if (!job) return { error: notFound };
        const refusal = scheduleJobChangeRefusal(job, context);
        if (refusal) return { error: refusal };
        const changed = operation === 'remove'
          ? await manager.engine.removeJob(id)
          : operation === 'pause'
            ? await manager.engine.pauseJob(id)
            : await manager.engine.resumeJob(id);
        return changed ? { success: true } : { error: notFound };
      },
      // #1250 b98: `{ success: true }` only (an error is fixed text with the id the caller gave).
      HARNESS_RESULT_TAGS,
    )),
  ]);
}

/**
 * #1250 b98: the saved timing as `schedule_update` reports it: structured fields only. Free text a job may
 * carry in its timing (an event job's `eventId` / `source` / `eventType`, a scatter window) is left out,
 * and so is a cron, zone or holiday name that does not look like one; `schedule_list` shows the whole job.
 */
function scheduleResult(schedule: JobSchedule): Record<string, unknown> {
  switch (schedule.kind) {
    case 'solar':
    case 'lunar':
    case 'workday':
    case 'freeDay':
    case 'holiday': {
      const festivals = schedule.kind === 'holiday' ? schedule.festivals : undefined;
      return {
        kind: schedule.kind,
        ...(isCronText(schedule.cron) ? { cron: schedule.cron } : {}),
        ...(schedule.tz !== undefined && TIME_ZONE_TEXT.test(schedule.tz) ? { tz: schedule.tz } : {}),
        ...(festivals === 'all' || (Array.isArray(festivals) && festivals.every(name => FESTIVAL_NAMES.has(name)))
          ? { festivals } : {}),
        ...(schedule.kind === 'holiday' && typeof schedule.everyDayOfHoliday === 'boolean'
          ? { everyDayOfHoliday: schedule.everyDayOfHoliday } : {}),
      };
    }
    case 'every':
      return { kind: 'every', ...(Number.isFinite(schedule.everyMs) ? { everyMs: schedule.everyMs } : {}) };
    case 'at':
      return {
        kind: 'at',
        ...(Number.isFinite(schedule.atMs) ? { atMs: schedule.atMs } : {}),
        ...(typeof schedule.deleteAfterRun === 'boolean' ? { deleteAfterRun: schedule.deleteAfterRun } : {}),
      };
    case 'scatter':
    case 'event':
      return { kind: schedule.kind };
  }
}

function isCronText(cron: unknown): cron is string {
  if (typeof cron !== 'string' || cron.length > 128) return false;
  const fields = cron.trim().split(/\s+/u);
  return fields.length >= 5 && fields.length <= 7 && fields.every(field => CRON_FIELD.test(field));
}

/**
 * The `agent` fields of a listed job (#1250 b52 / b55): an Agent removed from `ai.agents` is
 * flagged (`agent_missing`: its runs fail until changed) and named to an owner only; a configured
 * Agent the caller's turn cannot see, and a removed one shown to anyone else, appear as
 * {@link HIDDEN_SCHEDULE_AGENT}, without the name.
 */
function listedAgent(
  job: ScheduleJob,
  agents: readonly string[] | undefined,
  visible: ReadonlySet<string>,
  owner: boolean,
): { agent?: string; agent_missing?: true; agent_hidden?: true } {
  const agent = job.action.kind === 'agent' ? job.action.agent : undefined;
  if (!agent) return {};
  if (agents && !agents.includes(agent)) {
    return owner ? { agent, agent_missing: true } : { agent: HIDDEN_SCHEDULE_AGENT, agent_missing: true };
  }
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
