/**
 * 持久化调度任务 CLI — 通过运行中 Host 的 `/assistant/jobs` 操作。
 * 调度器在首次启动后以数据库为准，离线改 data/schedule-jobs.json 不会生效，因此不再直接改文件。
 */
import { Command } from 'commander';
import { logger } from '../utils/logger.js';
import { output } from '../utils/output.js';
import { reportHostFailure } from '../utils/host-error.js';
import {
  type ScheduleJobRecordCli,
  type JobScheduleCli,
  parseNotifyChannel,
  withNotifyTarget,
  targetSummary,
  nextRunSummary,
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

async function requireOk<T>(result: HostFetchResult<T>): Promise<T | undefined> {
  if (result.ok) return result.data;
  if (result.status === 404 && result.error === 'assistant.enabled is false') {
    logger.error('运行中的实例未启用 assistant（assistant.enabled），无法管理调度任务');
  } else {
    await reportHostFailure(result, `HTTP ${result.status}`);
  }
  process.exit(1);
}

async function mutateJob(action: 'remove' | 'pause' | 'resume', id: string): Promise<void> {
  await requireOk(await hostPost(await requireHost(), `/assistant/jobs/${action}`, { id }));
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
  if (s.kind === 'at') return `at ${new Date(s.atMs).toISOString()}`;
  if (s.kind === 'every') {
    const m = s.everyMs / (60 * 1000);
    if (m < 60) return `every ${m}m`;
    const h = m / 60;
    if (h < 24) return `every ${h}h`;
    return `every ${h / 24}d`;
  }
  // The Host may also return kinds the CLI cannot create (holiday/scatter/event).
  return `${s.kind} ${(s as { cron?: string }).cron ?? ''}`.trimEnd();
}

const listCommand = new Command('list')
  .description('列出运行中实例的持久化调度任务')
  .action(async () => {
    const data = await requireOk(
      await hostGet<{ jobs?: ScheduleJobRecordCli[] }>(await requireHost(), '/assistant/jobs'),
    );
    const jobs = data?.jobs ?? [];
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
      const target = targetSummary(j);
      if (target) output.line(`    目标:   ${target}`);
      const next = nextRunSummary(j);
      if (next) output.line(`    下次:   ${next}`);
      output.line(`    内容:   ${j.action.prompt}`);
    }
  });

const addCommand = new Command('add')
  .description('添加持久化调度任务（6 段 cron，或 --at / --every）；需要实例正在运行')
  .argument('[cronExpression]', 'Cron 表达式，如 "0 0 9 * * *"（与 --at/--every 二选一）')
  .option('--prompt <prompt>', '到点触发时发给 AI 的提示词（必填）')
  .option('-l, --label <label>', '可选标签')
  .option('--kind <kind>', 'solar|lunar|workday|freeDay（默认 solar）', 'solar')
  .option('--notify-channel <channel>', '结果投递：im | silent | log（默认 silent；指定 --target 时为 im）')
  .option('--target <target>', 'im 投递目标 <adapter>:<endpoint>:<kind>:<id>，kind 为 private | group | channel；省略时沿用 assistant / profile 的 defaults.notify')
  .option('--at <iso8601>', '单次执行时间，ISO8601')
  .option('--every <interval>', '固定间隔，如 30m, 1h, 1d')
  .action(async (cronExpression: string | undefined, opts: {
    prompt?: string;
    label?: string;
    kind?: string;
    notifyChannel?: string;
    target?: string;
    at?: string;
    every?: string;
  }) => {
    const now = Date.now();

    const prompt = opts.prompt?.trim();
    if (!prompt) {
      logger.error('请通过 --prompt 提供提示词');
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
        const atMs = new Date(opts.at).getTime();
        if (Number.isNaN(atMs) || atMs <= now) {
          logger.error('--at 必须是未来的有效 ISO8601 时间');
          process.exit(1);
        }
        schedule = { kind: 'at', atMs, deleteAfterRun: true };
      } else if (opts.every) {
        schedule = { kind: 'every', everyMs: parseEveryMs(opts.every) };
      } else {
        if (!cronExpression?.trim()) {
          logger.error('请提供 Cron 表达式，或使用 --at / --every');
          process.exit(1);
        }
        const kind = (opts.kind ?? 'solar').trim() as JobScheduleCli['kind'];
        if (!['solar', 'lunar', 'workday', 'freeDay'].includes(kind)) {
          logger.error('--kind 无效');
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
      { label: opts.label, schedule, prompt, notify },
    ));
    output.line(`已添加调度任务: ${data?.job?.id ?? ''}`);
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
  .description('恢复已暂停的任务')
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
  .addCommand(removeCommand)
  .addCommand(pauseCommand)
  .addCommand(resumeCommand);
