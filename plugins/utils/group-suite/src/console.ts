import {
  createDeliveryTarget,
  definePluginConsoleRpc,
  type DeliveryTarget,
  type PluginStateStore,
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
import { conversationKey } from './conversation-scope.js';
import { KEYWORD_INDEX_KEY, readKeywordIndex } from './keywords.js';

export const GROUP_SUITE_CONSOLE_PAGE = 'index';
export const GROUP_SUITE_READ_PERMISSION = 'group-suite:read';

export interface GroupSuiteCheckinLeaderboardRow {
  /** Nickname recorded at check-in, else the user id. */
  readonly user: string;
  readonly userId: string;
  readonly userName: string;
  readonly groupId: string;
  readonly totalDays: number;
  readonly streakDays: number;
  readonly points: number;
  readonly lastDate: string;
}

export interface GroupSuiteKeywordRow {
  /** `teach` = 问答 (`teach` command), `keyword` = 关键词回复 (`keyword-add`). */
  readonly kind: 'teach' | 'keyword';
  /** Conversation key (`["conversation-v1", …]`), or `global` / a legacy group id. */
  readonly groupId: string;
  readonly keyword: string;
  readonly reply: string;
  readonly creatorId: string;
  readonly creator: string;
}

export interface GroupSuiteConsoleStatus {
  readonly checkinCount: number;
  /** Same scopes as `teach-list` (问答) and `keyword-list` (关键词), counted separately. */
  readonly teachCount: number;
  readonly keywordCount: number;
  /** teachCount + keywordCount. */
  readonly qaCount: number;
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
  const userId = String(row.userId ?? row.user_id ?? '');
  const userName = String(row.userName ?? row.user_name ?? '');
  return {
    user: userName || userId,
    userId,
    userName,
    groupId: String(row.groupId ?? row.group_id ?? row.context_id ?? ''),
    totalDays: Number(row.totalDays ?? row.total_days ?? row.total_checkins ?? 0) || 0,
    streakDays: Number(row.streakDays ?? row.streak_days ?? row.streak ?? 0) || 0,
    points: Number(row.points ?? 0) || 0,
    lastDate: String(row.lastDate ?? row.last_date ?? row.last_checkin ?? ''),
  };
}

function mapKeywordRow(row: GroupSuiteRow, kind: GroupSuiteKeywordRow['kind']): GroupSuiteKeywordRow {
  const creatorId = String(row.creatorId ?? row.creator_id ?? '');
  const creatorName = String(row.creatorName ?? row.creator_name ?? '');
  const contextType = String(row.context_type ?? '');
  return {
    kind,
    groupId: String(row.groupId ?? row.group_id ?? row.context_id ?? '') || (contextType === 'global' ? 'global' : ''),
    keyword: String(row.keyword ?? row.question ?? ''),
    reply: String(row.reply ?? row.answer ?? ''),
    creatorId,
    creator: creatorName || creatorId,
  };
}

function collectEphemeralKeywords(runtime: GroupSuiteRuntime | undefined): GroupSuiteKeywordRow[] {
  if (!runtime?.keywords) return [];
  const rows: GroupSuiteKeywordRow[] = [];
  for (const [groupId, entries] of runtime.keywords.entries()) {
    for (const [keyword, reply] of entries.entries()) {
      rows.push({
        kind: 'keyword',
        groupId,
        keyword,
        reply,
        creatorId: '',
        creator: '',
      });
    }
  }
  return rows;
}

/** Bounded read of the persistent keyword dictionaries listed in the plugin's keyword index. */
async function collectPersistentKeywords(state: PluginStateStore | undefined): Promise<GroupSuiteKeywordRow[]> {
  if (!state) return [];
  const rows: GroupSuiteKeywordRow[] = [];
  let targets: readonly DeliveryTarget[];
  try {
    targets = await readKeywordIndex(state);
  } catch {
    return [];
  }
  for (const target of targets.slice(0, 200)) {
    try {
      const entries = await state.forConversation(createDeliveryTarget({ conversation: target }))
        .get<readonly (readonly [string, string])[]>('keywords');
      const groupId = conversationKey(target);
      for (const [keyword, reply] of entries ?? []) {
        rows.push({ kind: 'keyword', groupId, keyword, reply, creatorId: '', creator: '' });
      }
    } catch {
      // One unreadable conversation must not hide the rest.
    }
  }
  return rows;
}

export interface GroupSuiteConsoleOptions {
  /** Persistent state of the Database Host; persistent keywords live there (see `keywords.ts`). */
  readonly keywordState?: () => PluginStateStore | undefined;
}

export { KEYWORD_INDEX_KEY };

export function createGroupSuiteConsoleRpc(
  defaultRuntime?: GroupSuiteRuntime,
  options: GroupSuiteConsoleOptions = {},
): PluginConsoleRpc {
  return definePluginConsoleRpc({
    status: {
      page: GROUP_SUITE_CONSOLE_PAGE,
      requiredPermissions: [GROUP_SUITE_READ_PERMISSION],
      async handler(_input, call): Promise<PluginConsoleRpcJson> {
        const runtime = resolveRuntime(call, defaultRuntime);
        let keywordState: PluginStateStore | undefined;
        try {
          keywordState = options.keywordState?.();
        } catch {
          keywordState = undefined;
        }
        const [checkinRows, teachRows, legacyKeywordRows, statsRows, persistentKeywords] = await Promise.all([
          readTableRows(runtime, ['group_checkin', CHECKIN_TABLE]),
          readTableRows(runtime, [TEACH_TABLE]),
          readTableRows(runtime, ['group_keywords']),
          readTableRows(runtime, ['group_daily_stats', STATS_TABLE]),
          collectPersistentKeywords(keywordState),
        ]);

        const mappedCheckins = checkinRows.map(mapCheckinRow);
        const topCheckins = [...mappedCheckins]
          .sort((a, b) => (b.points - a.points) || (b.totalDays - a.totalDays))
          .slice(0, 20);

        const teach = teachRows.map(row => mapKeywordRow(row, 'teach'));
        const keywordList = [
          ...legacyKeywordRows.map(row => mapKeywordRow(row, 'keyword')),
          ...persistentKeywords,
          ...collectEphemeralKeywords(runtime),
        ];
        const keywords = [...teach, ...keywordList].slice(0, 50);

        return {
          checkinCount: mappedCheckins.length,
          teachCount: teach.length,
          keywordCount: keywordList.length,
          qaCount: teach.length + keywordList.length,
          dailyStatsCount: statsRows.length,
          topCheckins: topCheckins as unknown as PluginConsoleRpcJson,
          keywords: keywords as unknown as PluginConsoleRpcJson,
        };
      },
    },
  });
}
