import {
  definePluginConsoleRpc,
  type PluginConsoleRpc,
  type PluginConsoleRpcCall,
  type PluginConsoleRpcJson,
  type Token,
} from 'zhin.js';
import {
  CHECKIN_TABLE,
  STATS_TABLE,
  TEACH_TABLE,
  type GroupSuiteModel,
  type GroupSuiteRow,
} from './memory-store.js';
import { groupSuiteRuntimeToken, type GroupSuiteRuntime } from './runtime-state.js';

export const GROUP_SUITE_CONSOLE_PAGE = 'index';
export const GROUP_SUITE_READ_PERMISSION = 'group-suite:read';

export interface GroupSuiteCheckinLeaderboardRow {
  readonly userId: string;
  readonly groupId: string;
  readonly totalDays: number;
  readonly streakDays: number;
  readonly points: number;
  readonly lastDate: string;
}

export interface GroupSuiteKeywordRow {
  readonly groupId: string;
  readonly keyword: string;
  readonly reply: string;
  readonly creatorId: string;
}

export interface GroupSuiteConsoleStatus {
  readonly checkinCount: number;
  readonly keywordCount: number;
  readonly dailyStatsCount: number;
  readonly topCheckins: readonly GroupSuiteCheckinLeaderboardRow[];
  readonly keywords: readonly GroupSuiteKeywordRow[];
}

type RuntimeWithUse = {
  use?: <T>(token: Token<T>) => T;
};

function resolveRuntime(
  call: PluginConsoleRpcCall,
  fallbackRuntime?: GroupSuiteRuntime,
): GroupSuiteRuntime | undefined {
  const runtimeWithUse = call.runtime as RuntimeWithUse | undefined;
  if (typeof runtimeWithUse?.use === 'function') {
    try {
      const resolved = runtimeWithUse.use(groupSuiteRuntimeToken);
      if (resolved) return resolved;
    } catch {
      // Fall back to the plugin setup runtime when call.runtime.use is unavailable.
    }
  }
  return fallbackRuntime;
}

async function queryModelRows(model: GroupSuiteModel | undefined): Promise<GroupSuiteRow[]> {
  if (!model || typeof model.select !== 'function') return [];
  try {
    const selection = model.select();
    if (Array.isArray(selection)) return selection as GroupSuiteRow[];
    if (selection && typeof (selection as PromiseLike<GroupSuiteRow[]>).then === 'function') {
      const rows = await selection;
      return Array.isArray(rows) ? rows : [];
    }
    if (selection && typeof selection.where === 'function') {
      const rows = await selection.where({});
      return Array.isArray(rows) ? rows : [];
    }
  } catch {
    // Handle any database query failure gracefully.
  }
  return [];
}

async function readTableRows(
  runtime: GroupSuiteRuntime | undefined,
  tableNames: readonly string[],
): Promise<GroupSuiteRow[]> {
  const getModel = runtime?.db?.models?.get?.bind(runtime.db.models);
  if (typeof getModel !== 'function') return [];
  const collected: GroupSuiteRow[] = [];
  const visited = new Set<GroupSuiteModel>();
  for (const name of tableNames) {
    let model: GroupSuiteModel | undefined;
    try {
      model = getModel(name);
    } catch {
      model = undefined;
    }
    if (!model || visited.has(model)) continue;
    visited.add(model);
    const rows = await queryModelRows(model);
    if (rows.length > 0) collected.push(...rows);
  }
  return collected;
}

function mapCheckinRow(row: GroupSuiteRow): GroupSuiteCheckinLeaderboardRow {
  return {
    userId: String(row.userId ?? row.user_id ?? ''),
    groupId: String(row.groupId ?? row.group_id ?? row.context_id ?? ''),
    totalDays: Number(row.totalDays ?? row.total_days ?? row.total_checkins ?? 0) || 0,
    streakDays: Number(row.streakDays ?? row.streak_days ?? row.streak ?? 0) || 0,
    points: Number(row.points ?? 0) || 0,
    lastDate: String(row.lastDate ?? row.last_date ?? row.last_checkin ?? ''),
  };
}

function mapKeywordRow(row: GroupSuiteRow): GroupSuiteKeywordRow {
  return {
    groupId: String(row.groupId ?? row.group_id ?? row.context_id ?? ''),
    keyword: String(row.keyword ?? row.question ?? ''),
    reply: String(row.reply ?? row.answer ?? ''),
    creatorId: String(row.creatorId ?? row.creator_id ?? ''),
  };
}

function collectEphemeralKeywords(runtime: GroupSuiteRuntime | undefined): GroupSuiteKeywordRow[] {
  if (!runtime?.keywords) return [];
  const rows: GroupSuiteKeywordRow[] = [];
  for (const [groupId, entries] of runtime.keywords.entries()) {
    for (const [keyword, reply] of entries.entries()) {
      rows.push({
        groupId,
        keyword,
        reply,
        creatorId: '',
      });
    }
  }
  return rows;
}

export function createGroupSuiteConsoleRpc(
  defaultRuntime?: GroupSuiteRuntime,
): PluginConsoleRpc {
  return definePluginConsoleRpc({
    status: {
      page: GROUP_SUITE_CONSOLE_PAGE,
      requiredPermissions: [GROUP_SUITE_READ_PERMISSION],
      async handler(_input, call): Promise<PluginConsoleRpcJson> {
        const runtime = resolveRuntime(call, defaultRuntime);
        const [checkinRows, keywordDbRows, statsRows] = await Promise.all([
          readTableRows(runtime, ['group_checkin', CHECKIN_TABLE]),
          readTableRows(runtime, ['group_keywords', TEACH_TABLE]),
          readTableRows(runtime, ['group_daily_stats', STATS_TABLE]),
        ]);

        const mappedCheckins = checkinRows.map(mapCheckinRow);
        const topCheckins = [...mappedCheckins]
          .sort((a, b) => (b.points - a.points) || (b.totalDays - a.totalDays))
          .slice(0, 20);

        const mappedKeywords = [
          ...keywordDbRows.map(mapKeywordRow),
          ...collectEphemeralKeywords(runtime),
        ];
        const keywords = mappedKeywords.slice(0, 50);

        return {
          checkinCount: mappedCheckins.length,
          keywordCount: mappedKeywords.length,
          dailyStatsCount: statsRows.length,
          topCheckins: topCheckins as unknown as PluginConsoleRpcJson,
          keywords: keywords as unknown as PluginConsoleRpcJson,
        };
      },
    },
  });
}
