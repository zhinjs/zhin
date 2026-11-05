/**
 * `[Scene events]` 的数据来源（#996）：从 conversation_events 读最近的社交事件，生成极短摘要行（最新在前）。
 * 每个 Agent 会话只展示一次（内存游标），重启后最多在时间窗内重放一次。
 */
import { isSceneEvent, summarizeSceneEvent } from '@zhin.js/core';
import type { ActorRef, ConversationEventReader, ConversationRef } from '@zhin.js/im-contract';
import { sceneEventToStateMessage } from './scene-event-state.js';

/** 只看最近这段时间的场景事件（与会话上下文的时间窗一致）。 */
export const SCENE_EVENT_MAX_AGE_MS = 30 * 60 * 1000;
/** 每次最多回看的事件条数（含普通消息）。 */
export const SCENE_EVENT_LOOKBACK = 80;
/** 注入行数上限。 */
export const SCENE_EVENT_MAX_LINES = 5;

export interface SceneEventLinesInput {
  readonly reader: ConversationEventReader | undefined;
  readonly conversation: ConversationRef;
  readonly throughSequence: number;
  /** 已展示到的序号（不含）；之前的不再展示。 */
  readonly afterSequence?: number;
  readonly selfIds: readonly string[];
  /** 关系称呼（`ai_user_relations`），不注分数。 */
  readonly nicknames?: (actors: readonly ActorRef[]) => Promise<ReadonlyMap<string, string>>;
  readonly now?: number;
  /** 进出 / 资料变更已写进会话历史（ADR 0041 §7）时为真：这些事件不再进 [Scene events]。 */
  readonly omitStateChanges?: boolean;
}

export async function readSceneEventLines(input: SceneEventLinesInput): Promise<{ lines: string[]; through: number }> {
  const through = input.throughSequence;
  if (!input.reader || !Number.isSafeInteger(through) || through <= 0) return { lines: [], through: input.afterSequence ?? 0 };
  const after = Math.max(input.afterSequence ?? 0, through - SCENE_EVENT_LOOKBACK);
  if (after >= through) return { lines: [], through };
  const entries = await input.reader.listBetween(input.conversation, after, through, SCENE_EVENT_LOOKBACK);
  const notBefore = (input.now ?? Date.now()) - SCENE_EVENT_MAX_AGE_MS;
  // ADR 0041 §7：进出 / 资料变更走会话历史的 [state change]，这里只留戳一戳、公告等其余社交事件。
  const scene = entries.filter((entry) => isSceneEvent(entry.event) && (!input.omitStateChanges || !sceneEventToStateMessage(entry.event)) && entry.event.timestamp >= notBefore);
  if (scene.length === 0) return { lines: [], through };
  const selfIds = new Set(input.selfIds);
  const actors = new Map<string, ActorRef>();
  for (const { event } of scene) {
    for (const actor of [
      'actor' in event ? event.actor : undefined,
      'member' in event ? event.member : undefined,
      'target' in event ? event.target : undefined,
    ]) {
      if (actor && !selfIds.has(String(actor.id)) && actors.size < 8) actors.set(String(actor.id), actor);
    }
  }
  let names: ReadonlyMap<string, string> = new Map();
  if (input.nicknames && actors.size) {
    try {
      names = await input.nicknames([...actors.values()]);
    } catch {
      names = new Map();
    }
  }
  const counted: { text: string; count: number }[] = [];
  for (const { event } of [...scene].reverse()) {
    const text = summarizeSceneEvent(event, { selfIds, nameOf: (actor) => names.get(String(actor.id)) });
    if (!text) continue;
    const same = counted.find((item) => item.text === text);
    if (same) same.count += 1;
    else counted.push({ text, count: 1 });
  }
  const lines = counted.slice(0, SCENE_EVENT_MAX_LINES).map((item) => (item.count > 1 ? `${item.text} ×${item.count}` : item.text));
  return { lines, through };
}
