/**
 * `zhin trace <turnId|engagementId|last>` — print an Agent turn trace from the
 * persistent archive in data/agent-traces/ (#728) or an Engagement collaboration
 * graph from `engagement_events` (ADR 0048 H5).
 */
import { Command } from 'commander';
import { importProjectInstanceCli, type InstanceCliModule } from '../utils/project-instance.js';

interface TraceCommandOptions {
  readonly json?: boolean;
  readonly list?: boolean;
  readonly sessions?: boolean;
  readonly engagements?: boolean;
  readonly timeline?: boolean;
  readonly cwd?: string;
  readonly dir?: string;
  readonly session?: string;
  readonly since?: string;
  readonly until?: string;
  readonly limit?: string;
}

const RELATIVE = /^(\d+(?:\.\d+)?)\s*(m|h|d)$/i;
const UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };

/** `30m` / `2h` / `7d` (ago), an ISO date/time, or epoch ms. */
export function parseTraceTime(value: string | undefined, now = Date.now()): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const text = value.trim();
  const relative = RELATIVE.exec(text);
  if (relative) return now - Number(relative[1]) * UNIT_MS[relative[2]!.toLowerCase()]!;
  if (/^\d{12,}$/.test(text)) return Number(text);
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) throw new Error(`无法解析时间：${value}（示例：2h、7d、2026-10-14、2026-10-14T08:00）`);
  return parsed;
}

export const traceCommand = new Command('trace')
  .description('查看 Agent 回合的 trace 或多 Agent 协作 Engagement 拓扑图')
  .argument('[turn]', '回合 id / engagement id（可只写前缀），或 last 表示最近一次', 'last')
  .option('-l, --list', '列出记录的回合（可配合 --session / --since / --until / --engagements）')
  .option('--sessions', '列出有 trace 的会话')
  .option('--engagements', '列出或查看协作 Engagement（来自 engagement_events 日志）')
  .option('-s, --session <key>', '只看这个会话（sessionKey）')
  .option('--since <time>', '起始时间：2h、7d、ISO 时间或毫秒时间戳')
  .option('--until <time>', '截止时间（不含），格式同 --since')
  .option('-n, --limit <n>', '最多显示最近 n 条', '50')
  .option('--json', '输出原始 JSON')
  .option('--no-timeline', '不打印时间线')
  .option('--cwd <dir>', '项目根目录（默认当前目录）')
  .option('--dir <dir>', 'trace 目录（默认 <cwd>/data/agent-traces；评测报告会给出这个参数）')
  .action(async (turn: string, options: TraceCommandOptions) => {
    const root = options.cwd ?? process.cwd();
    const limit = Number.parseInt(options.limit ?? '50', 10);
    const effectiveLimit = Number.isFinite(limit) && limit > 0 ? limit : 50;
    let instance: InstanceCliModule | undefined;
    let instanceError: unknown;
    try {
      instance = await importProjectInstanceCli(root);
    } catch (error) {
      instanceError = error;
    }
    const openProjectEngagementJournal = async () => instance ? await instance.openProjectEngagementJournal(root) : null;

    if (options.engagements) {
      const opened = await openProjectEngagementJournal();
      if (!opened) {
        console.error('无法打开协作事件数据库（需要 SQLite、MySQL 或 PostgreSQL）。');
        process.exitCode = 1;
        return;
      }
      try {
        if (options.list || turn === 'last') {
          const ids = await opened.journal.listEngagements(effectiveLimit);
          if (options.list) {
            const summaries: unknown[] = [];
            for (const id of ids) {
              const s = await opened.journal.summarize(id);
              if (s) summaries.push(s);
            }
            console.log(options.json ? JSON.stringify(summaries, null, 2) : instance!.formatEngagementList(summaries as never[]));
            return;
          }
          const latestId = ids[0];
          if (!latestId) {
            console.error('还没有协作 Engagement 记录。');
            process.exitCode = 1;
            return;
          }
          const events = await opened.journal.read(latestId);
          const { summary, board } = instance!.describeEngagement(latestId, events);
                    console.log(
            options.json
              ? JSON.stringify({ summary, events, board }, null, 2)
              : instance!.formatEngagementCollaborationGraph(summary as never, events as never[]),
          );
          return;
        }

        const ids = await opened.journal.listEngagements(500);
        const targetId = ids.find((id) => id === turn || id.startsWith(turn)) ?? turn;
        const events = await opened.journal.read(targetId);
        if (events.length === 0) {
          console.error(`找不到 Engagement ${turn}。用 zhin trace --engagements --list 查看最近的协作记录。`);
          process.exitCode = 1;
          return;
        }
        const { summary, board } = instance!.describeEngagement(targetId, events);
                console.log(
          options.json
            ? JSON.stringify({ summary, events, board }, null, 2)
            : instance!.formatEngagementCollaborationGraph(summary as never, events as never[]),
        );
        return;
      } finally {
        await opened.close();
      }
    }

    let mod: Awaited<ReturnType<InstanceCliModule['loadAgentTraceModule']>>;
    try {
      if (!instance) throw instanceError;
      mod = await instance.loadAgentTraceModule();
    } catch {
      console.error('需要安装 @zhin.js/agent（AI 栈）。运行: pnpm add @zhin.js/agent');
      process.exitCode = 1;
      return;
    }
    const dir = options.dir ?? mod.defaultTurnTraceDir(root);
    const store = mod.createTurnTraceArchive(dir, { legacyFile: options.dir ? undefined : mod.defaultTurnTraceFile(root), secrets: [] });

    let since: number | undefined;
    let until: number | undefined;
    try {
      since = parseTraceTime(options.since);
      until = parseTraceTime(options.until);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
      return;
    }
    const filter = { sessionKey: options.session, since, until, limit: effectiveLimit };

    if (options.sessions) {
      const sessions = await store.sessions({ since, until });
      if (options.json) console.log(JSON.stringify(sessions, null, 2));
      else if (sessions.length === 0) console.log(`没有 trace 记录（${dir}）。`);
      else for (const s of sessions) {
        console.log(`${s.session_key}  ${s.turns} 回合  最近 ${new Date(s.last_started_at).toLocaleString()}  ${s.last_status}  ${s.total_tokens} tokens`);
      }
      return;
    }

    if (options.list || options.session || options.since || options.until) {
      const traces = await store.query(filter);
      console.log(options.json ? JSON.stringify(traces, null, 2) : mod.formatTurnTraceList(traces));
      return;
    }

    const trace = turn === 'last' ? await store.latest() : await store.find(turn);
    if (!trace && turn !== 'last') {
      const opened = await openProjectEngagementJournal();
      if (opened) {
        try {
          const ids = await opened.journal.listEngagements(500);
          const matchedId = ids.find((id) => id === turn || id.startsWith(turn));
          if (matchedId) {
            const events = await opened.journal.read(matchedId);
            if (events.length > 0) {
              const { summary, board } = instance!.describeEngagement(matchedId, events);
                            console.log(
                options.json
                  ? JSON.stringify({ summary, events, board }, null, 2)
                  : instance!.formatEngagementCollaborationGraph(summary as never, events as never[]),
              );
              return;
            }
          }
        } finally {
          await opened.close();
        }
      }
    }

    if (!trace) {
      console.error(turn === 'last'
        ? `还没有 trace 记录（${dir}）。机器人处理过一次 AI 对话后再试。`
        : `找不到回合或 Engagement ${turn}。用 zhin trace --list 或 zhin trace --engagements --list 查看最近记录。`);
      process.exitCode = 1;
      return;
    }
    if (options.json) {
      console.log(JSON.stringify(trace, null, 2));
      return;
    }
    // Service names from the project's inference graph (#1250); a missing graph shows model names.
    const display = await Promise.resolve(instance?.loadProviderDisplay?.(root)).catch(() => undefined);
    console.log(mod.formatTurnTrace(trace, {
      timeline: options.timeline !== false,
      ...(display ? { providerLabel: (provider: string) => display.resolveProvider(provider)?.label } : {}),
    }));
  });
