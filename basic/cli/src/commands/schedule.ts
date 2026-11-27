/**
 * 持久化调度任务 CLI — 通过运行中 Host 的 `/assistant/jobs` 操作。
 * 调度器在首次启动后以数据库为准，离线改 data/schedule-jobs.json 不会生效，因此不再直接改文件。
 */
import { formatDateTime } from '@zhin.js/plugin-runtime';
import { Command } from 'commander';
import { isConsoleFeatureDisabled } from '@zhin.js/console-protocol';
import { logger } from '../utils/logger.js';
import { output } from '../utils/output.js';
import { reportHostFailure } from '../utils/host-error.js';
import { isCliDebug } from '../utils/cli-flags.js';
import {
  type ScheduleJobRecordCli,
  type JobScheduleCli,
  parseNotifyChannel,
  withNotifyTarget,
  targetSummary,
  nextRunSummary,
  contentLines,
  agentSummary,
  normalizeCronExpression,
} from '../utils/assistant-jobs.js';
import {
  hostGet,
  hostPost,
  ALLOW_UNVERIFIED_HOST_OPTION_DESCRIPTION,
  HOST_OPTION_DESCRIPTION,
  requireHostHttpConfig,
  type HostFetchResult,
  type HostHttpConfig,
} from '../utils/host-http.js';

async function requireHost(): Promise<HostHttpConfig> {
  const { host, allowUnverifiedHost } = scheduleCommand.opts<{ host?: string; allowUnverifiedHost?: boolean }>();
  return requireHostHttpConfig({ host, allowUnverifiedHost }, message => logger.error(message));
}

/** Which write a refusal answers, for {@link describeScheduleRefusal}. */
export type ScheduleWriteAction =
  | { readonly kind: 'add' }
  | { readonly kind: 'resume' | 'set-agent' | 'update'; readonly id: string };

/**
 * Longest delay of a one-shot `--at` job: 365 days. Mirrors `MAX_SCHEDULE_AT_DELAY_MS` in
 * `packages/im/zhin/src/instance/console/assistant-job-routes.ts` (the instance refuses
 * `atMs - now > 365 days` with 400 `invalid_argument`), which is also the bound of the Agent's
 * schedule tools. Defined here because `@zhin.js/cli` must not import `zhin.js`; keep both in step.
 */
export const MAX_SCHEDULE_AT_DELAY_MS = 365 * 24 * 60 * 60_000;

/** `--at` as epoch ms, or the error to print: a valid time, in the future, at most 365 days ahead. */
export function parseScheduleAt(value: string, now: number): { atMs: number } | { error: string } {
  const atMs = new Date(value).getTime();
  if (Number.isNaN(atMs) || atMs <= now) return { error: '--at 必须是未来的有效 ISO8601 时间' };
  if (atMs - now > MAX_SCHEDULE_AT_DELAY_MS) return { error: '--at 最多是 365 天以后（与实例的上限相同）' };
  return { atMs };
}

const AGENT_NOT_FOUND = /Agent 不存在：(.+?)。可用的 Agent：(.*)$/u;

/** Calendar kinds by lower-cased spelling: `--kind` is matched case-insensitively (#1250 b90). */
const CRON_KINDS = new Map<string, string>([
  ['solar', 'solar'], ['lunar', 'lunar'], ['workday', 'workday'], ['freeday', 'freeDay'], ['holiday', 'holiday'],
]);
const CRON_KIND_LIST = 'solar | lunar | workday | freeDay | holiday';

/** Hint for a cron its calendar kind cannot evaluate (`schedule_invalid`, #1250 b90 review). */
const SCHEDULE_INVALID_HINT = '工作日（workday）、休息日（freeDay）、节假日（holiday）计划只取 Cron 的时分秒，日、月、周三段须为 *（如 "0 0 9 * * *"）；'
  + '改回公历（solar）时请用 --kind solar --cron 给出完整的 Cron（如 "0 0 9 * * 1-5"），原来的周一至周五不会自动恢复';

function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((name): name is string => typeof name === 'string').map(name => name.trim()).filter(Boolean))];
}

/**
 * Explanation of a schedule write the Host refused for a known reason (#1250 b55 / b61), or
 * `undefined` to report it as any other failure. The first line is the error, the rest are hints.
 *
 * - `schedule_target_forbidden` (403): the job delivers to an account the caller may not send from
 *   (`endpoint.operate`); resuming it, changing its Agent or creating it would send on their behalf.
 * - `schedule_agent_not_found` (400): `data: { code, agent, available }`; the usable Agents are listed
 *   (read from the message for an older Host that sends no `data`).
 */
export function describeScheduleRefusal(result: HostFetchResult<unknown>, action: ScheduleWriteAction): string[] | undefined {
  if (result.ok) return undefined;
  const detail = result.detail && typeof result.detail === 'object' ? result.detail as Record<string, unknown> : {};
  const code = typeof detail.code === 'string' ? detail.code : result.code;
  const message = result.error ?? '';
  if (code === 'schedule_target_forbidden') {
    // An older Host spelled a target without an account as `undefined / undefined`: not an account.
    const extracted = /需要 (.+?) 上的 endpoint\.operate/u.exec(message)?.[1];
    const account = extracted && !/\bundefined\b/u.test(extracted) ? extracted : undefined;
    const need = account ? `（需要 ${account} 上的 endpoint.operate）` : '';
    if (action.kind === 'resume') {
      return [
        `无法恢复任务 ${action.id}：你没有权限向它的投递目标发消息${need}`,
        `请让管理员授予你投递账号的 endpoint.operate 权限；或删除该任务（zhin schedule remove ${action.id}）后，以你有权限的投递目标重新创建`,
      ];
    }
    if (action.kind === 'set-agent') {
      return [
        `无法修改任务 ${action.id} 的 Agent：你没有权限向它的投递目标发消息${need}`,
        '请让管理员授予你投递账号的 endpoint.operate 权限',
      ];
    }
    if (action.kind === 'update') {
      return [
        `无法修改任务 ${action.id}：你没有权限向它的投递目标发消息${need}`,
        '请让管理员授予你投递账号的 endpoint.operate 权限：改计划时间、改标签或启用任务（任务保持启用时）都需要该权限；'
          + '只有停用任务（--disable）不需要',
      ];
    }
    return [
      `无法创建任务：你没有权限向投递目标发消息${need}`,
      '请让管理员授予你该账号的 endpoint.operate 权限，或用 --target 改投你有权限的账号',
    ];
  }
  if (code === 'schedule_invalid') {
    return [
      action.kind === 'add' ? `无法创建任务：${message}` : `无法修改任务 ${action.id}：${message}`,
      SCHEDULE_INVALID_HINT,
    ];
  }
  const parsed = AGENT_NOT_FOUND.exec(message);
  if (code !== 'schedule_agent_not_found' && !parsed) return undefined;
  const agent = typeof detail.agent === 'string' && detail.agent.trim() ? detail.agent.trim() : parsed?.[1];
  // `data.available` with no usable name (empty or not strings): fall back to the message.
  const fromDetail = names(detail.available);
  const available = fromDetail.length > 0 ? fromDetail : names(parsed?.[2]?.split('、'));
  const head = agent ? `Agent 不存在：${agent}` : 'Agent 不存在';
  if (available.length === 0) {
    return [
      `${head}。当前没有可用的 Agent`,
      action.kind === 'add'
        ? '请先在配置的 ai.agents 中添加 Agent，或省略 --agent 使用默认 Agent（zhin）'
        : `请先在配置的 ai.agents 中添加 Agent，或用 zhin schedule set-agent ${action.id} --clear 恢复默认 Agent（zhin）`,
    ];
  }
  return [
    `${head}。可用的 Agent：${available.join('、')}`,
    action.kind === 'add'
      ? '用 --agent <名称> 指定其中之一，或省略 --agent 使用默认 Agent'
      : `用 zhin schedule set-agent ${action.id} <名称> 改选其中之一，或加 --clear 恢复默认 Agent`,
  ];
}

async function requireOk<T>(result: HostFetchResult<T>, action?: ScheduleWriteAction): Promise<T | undefined> {
  if (result.ok) return result.data;
  const refusal = action ? describeScheduleRefusal(result, action) : undefined;
  if (refusal) {
    const [first, ...hints] = refusal;
    logger.error(first!);
    for (const hint of hints) logger.info(`  ${hint}`);
    const detail = result.detail && typeof result.detail === 'object' ? result.detail as Record<string, unknown> : {};
    const code = typeof detail.code === 'string' ? detail.code : result.code;
    if (isCliDebug() && code) logger.info(`  错误码: ${code}（HTTP ${result.status}）`);
  } else if (result.status === 404 && result.error === 'assistant.enabled is false') {
    // Newer instances name the reason in `data` (ConsoleFeatureDisabled, #1250).
    const disabled = result.detail;
    logger.error(isConsoleFeatureDisabled(disabled)
      ? `${disabled.message}；无法管理调度任务`
      : '运行中的实例未启用 assistant（assistant.enabled），无法管理调度任务');
  } else {
    await reportHostFailure(result, `HTTP ${result.status}`);
  }
  process.exit(1);
}

async function mutateJob(action: 'remove' | 'pause' | 'resume', id: string): Promise<void> {
  await requireOk(await hostPost(await requireHost(), `/assistant/jobs/${action}`, { id }), action === 'resume' ? { kind: 'resume', id } : undefined);
}

function parseEveryMs(s: string): number {
  const m = s.trim().match(/^(\d+)(m|h|d|s)$/i);
  if (!m) throw new Error(`Invalid --every format: ${s}. Use e.g. 30m, 1h, 1d`);
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  if (unit === 's') return n * 1000;
  if (unit === 'm') return n * 60 * 1000;
  if (unit === 'h') return n * 60 * 60 * 1000;
  if (unit === 'd') return n * 24 * 60 * 60 * 1000;
  throw new Error(`Unknown unit: ${unit}`);
}

function notifySummary(notify: ScheduleJobRecordCli['notify']): string {
  if (notify.channel === 'silent') return 'silent';
  if (notify.channel === 'log') return 'log';
  const parts: string[] = [notify.channel];
  if (notify.platform) parts.push(notify.platform);
  if (notify.sceneId) parts.push(`scene:${notify.sceneId}`);
  return parts.join('/');
}

function scheduleSummary(s: JobScheduleCli): string {
  if (s.kind === 'at') return `at ${formatDateTime(s.atMs)}`;
  if (s.kind === 'every') {
    const m = s.everyMs / (60 * 1000);
    if (m < 60) return `every ${m}m`;
    const h = m / 60;
    if (h < 24) return `every ${h}h`;
    return `every ${h / 24}d`;
  }
  // The Host may also return kinds the CLI cannot create (scatter/event).
  return `${s.kind} ${(s as { cron?: string }).cron ?? ''}`.trimEnd();
}

/** #1250 b33: the last run's status, with its cause when it failed or was degraded. */
export function lastRunSummary(job: Pick<ScheduleJobRecordCli, 'state'>): string | undefined {
  const status = job.state?.lastStatus;
  if (!status) return undefined;
  const label = status === 'ok' ? '成功' : status === 'error' ? '失败' : status === 'degraded' ? '未完成（降级）'
    : status === 'skipped' ? '跳过' : status;
  const error = (status === 'error' || status === 'degraded') && job.state.lastError ? `：${job.state.lastError}` : '';
  return `${label}${error}`;
}

const listCommand = new Command('list')
  .description('列出运行中实例的持久化调度任务')
  .option('--json', '以 JSON 输出（含完整的任务内容）')
  .action(async (opts: { json?: boolean }) => {
    const data = await requireOk(
      await hostGet<{ jobs?: ScheduleJobRecordCli[]; agents?: string[] }>(await requireHost(), '/assistant/jobs'),
    );
    if (isConsoleFeatureDisabled(data)) {
      logger.error(`${data.message}；无法列出调度任务`);
      process.exit(1);
    }
    const jobs = data?.jobs ?? [];
    // The configured Agents (#1250 b52); absent from older instances, then nothing is flagged.
    const agents = Array.isArray(data?.agents) ? data.agents : undefined;
    if (opts.json) {
      output.line(JSON.stringify(jobs, null, 2));
      return;
    }
    if (jobs.length === 0) {
      output.line('暂无调度任务。使用 zhin schedule add 添加。');
      return;
    }
    output.line('\n调度任务\n');
    for (const j of jobs) {
      const status = j.enabled ? '启用' : '暂停';
      const label = j.label ? ` (${j.label})` : '';
      output.line(`  ${j.id}${label}  [${status}]`);
      output.line(`    计划:   ${scheduleSummary(j.schedule)}`);
      output.line(`    投递:   ${notifySummary(j.notify)}`);
      output.line(`    Agent:  ${agentSummary(j, agents)}`);
      const target = targetSummary(j);
      if (target) output.line(`    目标:   ${target}`);
      const next = nextRunSummary(j);
      if (next) output.line(`    下次:   ${next}`);
      const last = lastRunSummary(j);
      if (last) output.line(`    上次:   ${last}`);
      for (const line of contentLines(j.action.prompt)) output.line(line);
    }
  });

const addCommand = new Command('add')
  .description('添加持久化调度任务（6 段 cron，或 --at / --every）；需要实例正在运行')
  .argument('[cronExpression]', 'Cron 表达式，如 "0 0 9 * * *"（与 --at/--every 二选一）')
  .option('--prompt <prompt>', '到点触发时发给 AI 的提示词（必填）')
  .option('-l, --label <label>', '可选标签')
  .option('--kind <kind>', 'solar|lunar|workday|freeDay|holiday（不区分大小写，默认 solar）', 'solar')
  .option('--notify-channel <channel>', '结果投递：im | silent | log（默认 silent；指定 --target 时为 im）')
  .option('--target <target>', 'im 投递目标 <adapter>:<endpoint>:<kind>:<id>，kind 为 private | group | channel；省略时沿用 assistant / profile 的 defaults.notify')
  .option('--at <iso8601>', '单次执行时间，ISO8601')
  .option('--every <interval>', '固定间隔，如 30m, 1h, 1d')
  .option('--agent <name>', '到点由哪个 Agent 执行（ai.agents 中的名称）；省略时用默认 Agent zhin。不存在时实例拒绝添加并列出可用的 Agent')
  .action(async (cronExpression: string | undefined, opts: {
    prompt?: string;
    label?: string;
    kind?: string;
    notifyChannel?: string;
    target?: string;
    at?: string;
    every?: string;
    agent?: string;
  }) => {
    const now = Date.now();

    const prompt = opts.prompt?.trim();
    if (!prompt) {
      logger.error('请通过 --prompt 提供提示词');
      process.exit(1);
    }
    const agent = opts.agent?.trim();
    if (opts.agent !== undefined && !agent) {
      logger.error('--agent 需要 Agent 名称');
      process.exit(1);
    }

    let notify;
    try {
      notify = withNotifyTarget(parseNotifyChannel(opts.notifyChannel ?? (opts.target ? 'im' : 'silent')), opts.target);
    } catch (e) {
      logger.error((e as Error).message);
      process.exit(1);
    }

    let schedule: JobScheduleCli;
    try {
      if (opts.at) {
        const at = parseScheduleAt(opts.at, now);
        if ('error' in at) {
          logger.error(at.error);
          process.exit(1);
        }
        schedule = { kind: 'at', atMs: at.atMs, deleteAfterRun: true };
      } else if (opts.every) {
        schedule = { kind: 'every', everyMs: parseEveryMs(opts.every) };
      } else {
        if (!cronExpression?.trim()) {
          logger.error('请提供 Cron 表达式，或使用 --at / --every');
          process.exit(1);
        }
        const kind = CRON_KINDS.get((opts.kind ?? 'solar').trim().toLowerCase()) as JobScheduleCli['kind'] | undefined;
        if (!kind) {
          logger.error(`--kind 无效，可选 ${CRON_KIND_LIST}`);
          process.exit(1);
        }
        const cron = normalizeCronExpression(cronExpression);
        schedule = { kind, cron } as JobScheduleCli;
      }
    } catch (e) {
      logger.error((e as Error).message);
      process.exit(1);
    }

    const data = await requireOk(await hostPost<{ job?: { id?: string } }>(
      await requireHost(),
      '/assistant/jobs',
      { label: opts.label, schedule, prompt, notify, ...(agent ? { agent } : {}) },
    ), { kind: 'add' });
    output.line(`已添加调度任务: ${data?.job?.id ?? ''}`);
  });

const setAgentCommand = new Command('set-agent')
  .description('修改任务由哪个 Agent 执行；--clear 恢复默认 Agent（zhin）。不存在的 Agent 会被拒绝并列出可用的 Agent')
  .argument('<id>', '任务 ID')
  .argument('[agent]', 'Agent 名称（ai.agents 中的名称）')
  .option('--clear', '清除任务的 Agent，恢复默认 Agent')
  .action(async (id: string, agentName: string | undefined, opts: { clear?: boolean }) => {
    const agent = agentName?.trim();
    if (opts.clear ? agent : !agent) {
      logger.error(opts.clear ? '--clear 与 Agent 名称只能二选一' : '请提供 Agent 名称，或用 --clear 恢复默认 Agent');
      process.exit(1);
    }
    await requireOk(await hostPost(await requireHost(), '/assistant/jobs/set-agent', { id, agent: opts.clear ? null : agent }), { kind: 'set-agent', id });
    output.line(opts.clear ? `已恢复默认 Agent: ${id}` : `已将任务 ${id} 的 Agent 设为: ${agent}`);
  });

const updateCommand = new Command('update')
  .description('按 ID 修改任务的计划时间、标签或启用状态；Agent、提示词与投递目标保持不变（不要删除后重建）')
  .argument('<id>', '任务 ID')
  .argument('[cronExpression]', '新的 Cron 表达式（与 --cron 相同）')
  .option('--cron <expression>', '新的 Cron 表达式，如 "0 0 8 * * *"；省略 --kind 时沿用任务原来的计划类型')
  .option('--kind <kind>', '新的计划类型 solar|lunar|workday|freeDay|holiday（不区分大小写）；省略 --cron 时沿用原来的 Cron。'
    + '从 workday 等改回 solar 时请同时给出完整的 --cron（原来的周一至周五不会恢复）')
  .option('--at <iso8601>', '改为单次执行，ISO8601')
  .option('--every <interval>', '改为固定间隔，如 30m, 1h, 1d')
  .option('-l, --label <label>', '新标签；传空字符串清除标签')
  .option('--enable', '启用任务')
  .option('--disable', '停用任务')
  .action(async (id: string, cronExpression: string | undefined, opts: {
    cron?: string;
    kind?: string;
    at?: string;
    every?: string;
    label?: string;
    enable?: boolean;
    disable?: boolean;
  }) => {
    if (cronExpression !== undefined && opts.cron !== undefined) {
      logger.error('Cron 表达式只能给一次（位置参数或 --cron）');
      process.exit(1);
    }
    const cronInput = opts.cron ?? cronExpression;
    if (opts.enable && opts.disable) {
      logger.error('--enable 与 --disable 只能二选一');
      process.exit(1);
    }
    const timing = [cronInput !== undefined || opts.kind !== undefined, opts.at !== undefined, opts.every !== undefined]
      .filter(Boolean).length;
    if (timing > 1) {
      logger.error('--cron / --kind、--at 与 --every 只能选一种');
      process.exit(1);
    }

    const kind = opts.kind === undefined ? undefined : CRON_KINDS.get(opts.kind.trim().toLowerCase());
    if (opts.kind !== undefined && !kind) {
      logger.error(`--kind 无效，可选 ${CRON_KIND_LIST}`);
      process.exit(1);
    }
    let atMs: number | undefined;
    if (opts.at !== undefined) {
      const at = parseScheduleAt(opts.at, Date.now());
      if ('error' in at) {
        logger.error(at.error);
        process.exit(1);
      }
      atMs = at.atMs;
    }
    let schedule: Record<string, unknown> | undefined;
    let invalid: string | undefined;
    try {
      if (atMs !== undefined) schedule = { kind: 'at', atMs };
      else if (opts.every !== undefined) schedule = { kind: 'every', everyMs: parseEveryMs(opts.every) };
      else if (cronInput !== undefined || kind !== undefined) {
        schedule = {
          ...(kind ? { kind } : {}),
          ...(cronInput !== undefined ? { cron: normalizeCronExpression(cronInput) } : {}),
        };
      }
    } catch (e) {
      invalid = (e as Error).message;
    }
    if (invalid !== undefined) {
      logger.error(invalid);
      process.exit(1);
    }

    const label = opts.label === undefined ? undefined : opts.label.trim() || null;
    const enabled = opts.enable ? true : opts.disable ? false : undefined;
    if (!schedule && label === undefined && enabled === undefined) {
      logger.error('请至少指定一项修改：--cron / --kind / --at / --every / --label / --enable / --disable');
      process.exit(1);
    }

    const data = await requireOk(await hostPost<{ job?: ScheduleJobRecordCli; warning?: string }>(
      await requireHost(),
      '/assistant/jobs/update',
      { id, ...(schedule ? { schedule } : {}), ...(label !== undefined ? { label } : {}), ...(enabled !== undefined ? { enabled } : {}) },
    ), { kind: 'update', id });
    output.line(`已更新任务: ${id}（Agent、提示词与投递目标保持不变）`);
    const job = data?.job;
    if (job?.schedule) output.line(`  计划:   ${scheduleSummary(job.schedule)}`);
    if (job && typeof job.enabled === 'boolean') output.line(`  状态:   ${job.enabled ? '启用' : '暂停'}`);
    if (job?.label) output.line(`  标签:   ${job.label}`);
    const next = job?.state ? nextRunSummary(job) : undefined;
    if (next) output.line(`  下次:   ${next}`);
    // Saved, but enabled without a next run: it will not fire until changed (#1250 b90 review).
    if (typeof data?.warning === 'string' && data.warning) logger.warn(data.warning);
  });

const removeCommand = new Command('remove')
  .description('按 ID 删除持久化调度任务')
  .argument('<id>', '任务 ID')
  .action(async (id: string) => {
    await mutateJob('remove', id);
    output.line(`已删除任务: ${id}`);
  });

const pauseCommand = new Command('pause')
  .description('暂停指定任务')
  .argument('<id>', '任务 ID')
  .action(async (id: string) => {
    await mutateJob('pause', id);
    output.line(`已暂停任务: ${id}`);
  });

const resumeCommand = new Command('resume')
  .description('恢复已暂停的任务；任务的投递目标你无权发送时会被拒绝并说明原因')
  .argument('<id>', '任务 ID')
  .action(async (id: string) => {
    await mutateJob('resume', id);
    output.line(`已恢复任务: ${id}`);
  });

export const scheduleCommand = new Command('schedule')
  .option('--host <url>', HOST_OPTION_DESCRIPTION)
  .option('--allow-unverified-host', ALLOW_UNVERIFIED_HOST_OPTION_DESCRIPTION)
  .description('持久化调度任务（操作运行中的实例）')
  .addCommand(listCommand)
  .addCommand(addCommand)
  .addCommand(setAgentCommand)
  .addCommand(updateCommand)
  .addCommand(removeCommand)
  .addCommand(pauseCommand)
  .addCommand(resumeCommand);
