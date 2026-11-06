/**
 * `zhin trace <turnId|engagementId|last>` — print an Agent turn trace from the
 * persistent archive in data/agent-traces/ (#728) or an Engagement collaboration
 * graph from `engagement_events` (ADR 0048 H5).
 */
import { Command } from 'commander';
import {
  DatabaseEngagementJournal,
  defineEngagementEventModel,
  reconstructBoardFromEvents,
  summarizeEngagementEvents,
  type EngagementEvent,
  type EngagementJournalDatabase,
  type EngagementSummary,
} from '@zhin.js/harness';

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

/**
 * Formats an EngagementSummary (and optional raw events) into an ASCII
 * Collaboration Graph, Blackboard summary, and governance diagnostics (ADR 0048 H5).
 */
export function formatEngagementCollaborationGraph(
  summary: EngagementSummary,
  events?: readonly EngagementEvent[],
): string {
  const lines: string[] = [];
  const durationText = summary.endedAt !== undefined
    ? `${Math.max(0, summary.endedAt - summary.startedAt)}ms`
    : 'open';
  lines.push(`Engagement ${summary.engagementId}  [${summary.status}]`);
  if (summary.initiator) {
    lines.push(`  Initiator: ${summary.initiator.id} (trust: ${summary.initiator.trust})`);
  }
  if (summary.venue) {
    lines.push(`  Venue:     ${summary.venue.kind}:${summary.venue.id}`);
  }
  lines.push(`  Duration:  ${durationText}`);
  lines.push(
    `  Budget:    modelCalls=${summary.consumed.modelCalls}  tokens=${summary.consumed.tokens}  wallMs=${summary.consumed.wallMs}  sideEffects=${summary.consumed.sideEffects}`,
  );
  lines.push(`  Actors:    ${summary.actors.length > 0 ? summary.actors.join(', ') : '(none)'}`);
  if (summary.reason) {
    lines.push(`  Reason:    ${summary.reason}`);
  }

  lines.push('');
  lines.push(`Collaboration Hop Graph (${summary.hops.length} hops, ${summary.mailCount} mails):`);
  if (summary.hops.length === 0) {
    lines.push('  (no mail hops)');
  } else {
    for (const hop of summary.hops) {
      const cause = hop.causationId ? `, cause=${hop.causationId}` : '';
      lines.push(`  ${hop.from} ──[${hop.kind}]──► ${hop.to}  (${hop.status}, id=${hop.mailId}${cause})`);
    }
  }

  lines.push('');
  lines.push(`Blackboard (${summary.boardEntries.length} entries):`);
  if (summary.boardEntries.length === 0) {
    lines.push('  (empty)');
  } else {
    for (const entry of summary.boardEntries) {
      const preview = entry.content.length > 80 ? `${entry.content.slice(0, 77)}...` : entry.content;
      const statusSuffix = entry.status ? `, status=${entry.status}` : '';
      lines.push(
        `  [${entry.kind}] ${entry.key} = ${preview}  (by ${entry.author || 'unknown'}, v${entry.version}${statusSuffix})`,
      );
    }
  }

  lines.push('');
  lines.push(`Diagnostics (tools=${summary.toolCallCount}, guardBlocks=${summary.guardBlocks.length}, escalations=${summary.escalations.length}, projections=${summary.projections.length}):`);
  if (events && events.length > 0) {
    for (const ev of events) {
      if (ev.type === 'tool_called') {
        const actor = typeof ev.data.actor === 'string' ? ev.data.actor : 'agent';
        const tool = typeof ev.data.tool === 'string' ? ev.data.tool : typeof ev.data.name === 'string' ? ev.data.name : 'tool';
        lines.push(`  [tool] ${actor} -> ${tool}`);
      }
    }
  }
  for (const block of summary.guardBlocks) {
    const target = block.to ? ` -> ${block.to}` : '';
    const detail = block.reason.detail ? ` (${block.reason.detail})` : '';
    lines.push(`  [guard_blocked] ${block.from}${target}: ${block.reason.code}${detail}`);
  }
  for (const esc of summary.escalations) {
    lines.push(`  [escalated] ${esc.by}: ${esc.reason}`);
  }
  for (const proj of summary.projections) {
    lines.push(
      `  [venue_projected] ${proj.venue.kind}:${proj.venue.id} by ${proj.actor} [${proj.mode}] (mail=${proj.mailId})`,
    );
  }

  return lines.join('\n');
}

export function formatEngagementList(summaries: readonly EngagementSummary[]): string {
  if (summaries.length === 0) {
    return '没有协作 Engagement 记录。';
  }
  return summaries
    .map((s) => {
      const duration = s.endedAt !== undefined ? `${Math.max(0, s.endedAt - s.startedAt)}ms` : 'open';
      const actors = s.actors.length > 0 ? s.actors.join(',') : '-';
      return `${s.engagementId}  [${s.status}]  ${duration}  actors=${actors}  hops=${s.hops.length}  tools=${s.toolCallCount}  tokens=${s.consumed.tokens}`;
    })
    .join('\n');
}

async function openProjectEngagementJournal(root: string): Promise<{
  readonly journal: DatabaseEngagementJournal;
  close(): Promise<void>;
} | null> {
  try {
    const [{ createConfigDocument }, { DEFAULT_ROOT_CONFIG_FILE_NAME }, { findConfigFile }, { createDatabaseHost, resolveDatabaseConfig }] = await Promise.all([
      import('@zhin.js/runtime'),
      import('@zhin.js/plugin-runtime'),
      import('../utils/config-file.js'),
      import('../plugin-runtime/database-host-installer.js'),
    ]);
    const selected = findConfigFile(root);
    const file = selected ? `${root}/${selected}` : `${root}/${DEFAULT_ROOT_CONFIG_FILE_NAME}`;
    let rawDoc: Record<string, unknown> = {};
    try {
      const doc = createConfigDocument(file);
      rawDoc = ((await doc.read()).document ?? {}) as Record<string, unknown>;
    } catch {
      rawDoc = {};
    }
    const dbConfig = await resolveDatabaseConfig(root, rawDoc);
    const dbHost = createDatabaseHost(dbConfig);
    if (!['sqlite', 'mysql', 'pg'].includes(dbHost.dialect)) {
      return null;
    }
    defineEngagementEventModel(dbHost);
    await dbHost.start();
    const journal = new DatabaseEngagementJournal(dbHost as unknown as EngagementJournalDatabase);
    return {
      journal,
      close: () => dbHost.stop(),
    };
  } catch {
    return null;
  }
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

    if (options.engagements) {
      const opened = await openProjectEngagementJournal(root);
      if (!opened) {
        console.error('无法打开协作事件数据库（需要 SQLite、MySQL 或 PostgreSQL）。');
        process.exitCode = 1;
        return;
      }
      try {
        if (options.list || turn === 'last') {
          const ids = await opened.journal.listEngagements(effectiveLimit);
          if (options.list) {
            const summaries: EngagementSummary[] = [];
            for (const id of ids) {
              const s = await opened.journal.summarize(id);
              if (s) summaries.push(s);
            }
            console.log(options.json ? JSON.stringify(summaries, null, 2) : formatEngagementList(summaries));
            return;
          }
          const latestId = ids[0];
          if (!latestId) {
            console.error('还没有协作 Engagement 记录。');
            process.exitCode = 1;
            return;
          }
          const events = await opened.journal.read(latestId);
          const summary = summarizeEngagementEvents(latestId, events);
          const board = reconstructBoardFromEvents(events);
          console.log(
            options.json
              ? JSON.stringify({ summary, events, board }, null, 2)
              : formatEngagementCollaborationGraph(summary, events),
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
        const summary = summarizeEngagementEvents(targetId, events);
        const board = reconstructBoardFromEvents(events);
        console.log(
          options.json
            ? JSON.stringify({ summary, events, board }, null, 2)
            : formatEngagementCollaborationGraph(summary, events),
        );
        return;
      } finally {
        await opened.close();
      }
    }

    let mod: typeof import('@zhin.js/agent/trace');
    try {
      mod = await import('@zhin.js/agent/trace');
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
      const opened = await openProjectEngagementJournal(root);
      if (opened) {
        try {
          const ids = await opened.journal.listEngagements(500);
          const matchedId = ids.find((id) => id === turn || id.startsWith(turn));
          if (matchedId) {
            const events = await opened.journal.read(matchedId);
            if (events.length > 0) {
              const summary = summarizeEngagementEvents(matchedId, events);
              const board = reconstructBoardFromEvents(events);
              console.log(
                options.json
                  ? JSON.stringify({ summary, events, board }, null, 2)
                  : formatEngagementCollaborationGraph(summary, events),
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
    console.log(options.json
      ? JSON.stringify(trace, null, 2)
      : mod.formatTurnTrace(trace, { timeline: options.timeline !== false }));
  });
