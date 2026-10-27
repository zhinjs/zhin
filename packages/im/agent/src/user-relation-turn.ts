/**
 * 回合结束 → 画像/好感度增量写入。fire-and-forget：失败只记日志，绝不阻塞或影响回复。
 */
import { getLogger } from '@zhin.js/logger';
import { AMBIENT_ENGAGEMENT_METADATA_KEY, type TurnContextView } from './context/turn-envelope.js';
import type { UserRelationStore } from './user-relation.js';
import { SCENE_WAKE_METADATA_KEY } from './scene-events.js';

const logger = getLogger('UserRelation');

/** 不算「被当工具使唤」的元工具。 */
const SOCIAL_NEUTRAL_TOOLS = new Set(['load_skill', 'discover', 'load_tool', 'user_profile', 'tool_search']);

export interface RelationTurnOutcome {
  toolCalls?: readonly { tool: string }[];
}

export function countBusinessToolCalls(toolCalls: readonly { tool: string }[] | undefined): number {
  return (toolCalls ?? []).filter((call) => !SOCIAL_NEUTRAL_TOOLS.has(call.tool)).length;
}

/** 旁听回合：意图为 observe，或带着 ambient 元数据标记。 */
export function isAmbientTurn(turn: TurnContextView & { intent?: { kind: string } }): boolean {
  return turn.intent?.kind === 'observe'
    || turn.input?.metadata?.[AMBIENT_ENGAGEMENT_METADATA_KEY] === 'ambient';
}

export function recordRelationTurn(
  relations: UserRelationStore | undefined,
  turn: TurnContextView & { intent?: { kind: string } },
  outcome: RelationTurnOutcome,
): void {
  if (!relations || turn.origin.kind !== 'im') return;
  // #996 非目标：社交事件唤醒的回合不改好感度/画像（没有真人发言）。
  if (turn.input?.metadata?.[SCENE_WAKE_METADATA_KEY] === true) return;
  const { origin, principal } = turn;
  const ambient = isAmbientTurn(turn);
  void relations.recordTurn({
    platform: origin.platform,
    userId: principal.subjectId,
    displayName: principal.displayName,
    scene: origin.scope === 'private' ? undefined : `${origin.scope}:${origin.sceneId}`,
    isMaster: principal.roles.includes('master'),
    addressed: !ambient,
    text: turn.input?.text ?? '',
    toolCalls: countBusinessToolCalls(outcome.toolCalls),
  }).catch((error: unknown) => {
    logger.warn(`relation update skipped: ${error instanceof Error ? error.message : String(error)}`);
  });
}
