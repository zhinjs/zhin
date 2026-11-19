/**
 * `zhin trace <turnId|engagementId|last>` — print an Agent turn trace from the
 * persistent archive in data/agent-traces/ (#728) or an Engagement collaboration
 * graph from `engagement_events` (ADR 0048 H5).
 */
import { Command } from 'commander';
import { formatDateTime } from '@zhin.js/plugin-runtime';
import { sessionDisplayNameOf, sessionLabelOf, sessionPartsOf, shortSessionKey } from '@zhin.js/gateway/usage';
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

/** #1250 b35: pre-b35 records still merged; only the instance splits them. */
const LEGACY_ENGAGEMENTS_PENDING_NOTICE = '旧版协作记录尚未拆分，重启实例后会自动整理。';
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

function withSessionDisplayName(trace: unknown): unknown {
  const name = sessionDisplayNameOf(trace);
  return name && trace && typeof trace === 'object' ? { ...trace, session_display_name: name } : trace;
}

/** Readable-name fields of a session summary / chat (`@zhin.js/agent/trace` `TurnTraceSessionLabelFields`). */
interface TraceSessionLabel {
  readonly origin?: unknown;
  readonly platform?: string;
  readonly scope_kind?: string;
  readonly scene_label?: string;
  readonly display_name?: string;
}

/** One `zhin trace --sessions` row: the summary of `TurnTraceArchive.sessions()`; `origin`, the name fields and `conversations` are newer (#1250 b63). */
export interface TraceSessionRow extends TraceSessionLabel {
  readonly session_key: string;
  readonly turns: number;
  readonly last_started_at: number;
  readonly last_status: string;
  readonly total_tokens: number;
  readonly conversations?: ReadonlyArray<TraceSessionLabel & { readonly turns: number; readonly last_started_at: number }>;
  readonly conversations_total?: number;
}

const SCOPE_TEXT: Readonly<Record<string, string>> = {
  private: '私聊', group: '群聊', channel: '频道', http: 'HTTP', schedule: '定时任务', a2a: 'A2A', mcp: 'MCP', internal: '内部',
};

/**
 * `平台 · 私聊 · 名称` of a session summary or one of its chats: its `display_name`, else built from
 * its `origin` (an older `@zhin.js/agent` without name fields); `undefined` without either.
 */
export function traceSessionName(row: TraceSessionLabel): string | undefined {
  if (row.display_name) return row.display_name;
  const origin = row.origin as { kind?: unknown; platform?: unknown } | undefined;
  if (!origin || typeof origin !== 'object') return undefined;
  const parts = sessionPartsOf({ origin });
  const platform = origin.kind === 'im' && typeof origin.platform === 'string' && origin.platform ? origin.platform : undefined;
  const scope = parts.scopeKind ? SCOPE_TEXT[parts.scopeKind] ?? parts.scopeKind : undefined;
  const text = [platform, scope, parts.sceneLabel].filter(Boolean).join(' · ');
  return text || undefined;
}

/** Lines of one `zhin trace --sessions` row; chats of a session spanning several are indented below it. */
export function formatTraceSessionRow(row: TraceSessionRow): string[] {
  const name = traceSessionName(row);
  const key = name ? `${name}（${shortSessionKey(row.session_key)}）` : row.session_key;
  const lines = [`${key}  ${row.turns} 回合  最近 ${formatDateTime(row.last_started_at)}  ${row.last_status}  ${row.total_tokens} tokens`];
  for (const chat of row.conversations ?? []) {
    lines.push(`  · ${traceSessionName(chat) ?? '未记录来源'}  ${chat.turns} 回合  最近 ${formatDateTime(chat.last_started_at)}`);
  }
  const shown = row.conversations?.length ?? 0;
  if (row.conversations_total && row.conversations_total > shown) lines.push(`  · 另有 ${row.conversations_total - shown} 段聊天`);
  return lines;
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
      // #1250 b35: the CLI never splits pre-b35 records itself (stderr keeps --json output clean).
      if (opened.legacyPending) console.error(LEGACY_ENGAGEMENTS_PENDING_NOTICE);
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
        // Exact id first: `m-<run>-1` is also a prefix of `m-<run>-17` (#1250 b35).
        const targetId = ids.find((id) => id === turn) ?? ids.find((id) => id.startsWith(turn)) ?? turn;
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
      // Readable conversation (`平台 · 私聊 · 名称`) with the short key, as `zhin trace -l` (#1250 b63).
      else for (const s of sessions as readonly TraceSessionRow[]) console.log(formatTraceSessionRow(s).join('\n'));
      return;
    }

    if (options.list || options.session || options.since || options.until) {
      const traces = await store.query(filter);
      // Readable conversation as in `zhin usage report` (#1250); `--json` keeps the full session_key
      // and adds that name as `session_display_name`.
      console.log(options.json
        ? JSON.stringify(traces.map(trace => withSessionDisplayName(trace)), null, 2)
        : mod.formatTurnTraceList(traces, { sessionLabel: trace => sessionLabelOf(trace) }));
      return;
    }

    const trace = turn === 'last' ? await store.latest() : await store.find(turn);
    if (!trace && turn !== 'last') {
      const opened = await openProjectEngagementJournal();
      if (opened) {
        try {
          const ids = await opened.journal.listEngagements(500);
          const matchedId = ids.find((id) => id === turn) ?? ids.find((id) => id.startsWith(turn));
          if (matchedId) {
            const events = await opened.journal.read(matchedId);
            if (events.length > 0) {
              if (opened.legacyPending) console.error(LEGACY_ENGAGEMENTS_PENDING_NOTICE);
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
