/**
 * 状态感知（#996）：社交事件的优先级与极短摘要。
 *
 * 只读 `conversation_events` 中已归一化的事件；**从不**把平台原始 JSON 交给模型。
 * - 高优先：禁言/解禁、入群申请、成员进出、公告变更、戳 Bot —— 可独立唤醒回合；
 * - 低优先：表情回应、名片/头衔/备注变更、人与人之间的戳一戳 —— 只挂到下一轮的 `[Scene events]` 摘要。
 */
import type { ActorRef, ConversationEvent } from '@zhin.js/im-contract';

export type SceneEventPriority = 'high' | 'low';

/** 场景事件类型（`message.created` / `message.recalled` 不在此列）。 */
export const SCENE_EVENT_TYPES = Object.freeze([
  'member.muted',
  'member.unmuted',
  'member.joined',
  'member.left',
  'member.role_changed',
  'scene.join_requested',
  'scene.notice_updated',
  'conversation.poked',
  'message.reaction_changed',
  'member.card_changed',
  'member.title_changed',
  'member.remark_changed',
] as const satisfies readonly ConversationEvent['type'][]);

export type SceneEventType = typeof SCENE_EVENT_TYPES[number];
export type SceneConversationEvent = Extract<ConversationEvent, { type: SceneEventType }>;

/** 只在 `[Scene events]` 中出现、不进入旧的 conversation context 块的新类型（避免重复注入与落库）。 */
export const SCENE_ONLY_EVENT_TYPES: ReadonlySet<ConversationEvent['type']> = new Set([
  'scene.join_requested',
  'scene.notice_updated',
  'member.card_changed',
  'member.title_changed',
  'member.remark_changed',
]);

/** 单条摘要的上限（字符）。整段 `[Scene events]` 另有总上限。 */
export const SCENE_EVENT_SUMMARY_MAX = 60;
/** 公告/申请附言等用户文本在事件里保存的上限。 */
export const SCENE_EVENT_TEXT_MAX = 40;

export function isSceneEvent(event: ConversationEvent): event is SceneConversationEvent {
  return (SCENE_EVENT_TYPES as readonly string[]).includes(event.type);
}

/** 部分平台以 user_id 0 表示「全员」。 */
const WHOLE_SCENE_IDS = new Set(['0', 'all']);

/**
 * 事件优先级；不是场景事件时返回 undefined。
 * `selfIds` 为 Bot 在该平台的账号候选，用来判断「戳的是不是 Bot」。
 */
export function sceneEventPriority(
  event: ConversationEvent,
  selfIds: ReadonlySet<string> = new Set(),
): SceneEventPriority | undefined {
  switch (event.type) {
    case 'member.muted':
    case 'member.unmuted':
    case 'member.joined':
    case 'member.left':
    case 'scene.join_requested':
    case 'scene.notice_updated':
      return 'high';
    case 'conversation.poked':
      return event.target && selfIds.has(String(event.target.id)) ? 'high' : 'low';
    case 'member.role_changed':
    case 'message.reaction_changed':
    case 'member.card_changed':
    case 'member.title_changed':
    case 'member.remark_changed':
      return 'low';
    default:
      return undefined;
  }
}

/** 截断并清理用户文本：去掉换行/控制字符，只留一行。 */
export function clipSceneText(value: unknown, max = SCENE_EVENT_TEXT_MAX): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const flat = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export interface SceneEventSummaryOptions {
  /** Bot 账号候选：目标为 Bot 时写成 `you`。 */
  readonly selfIds?: ReadonlySet<string>;
  /** 关系称呼（如 `ai_user_relations` 中的昵称）；返回空时退回平台显示名。 */
  readonly nameOf?: (actor: ActorRef) => string | undefined;
}

function nameOf(actor: ActorRef | undefined, options: SceneEventSummaryOptions): string {
  if (!actor) return 'someone';
  const id = String(actor.id);
  if (options.selfIds?.has(id)) return 'you';
  if (WHOLE_SCENE_IDS.has(id)) return 'everyone';
  const name = options.nameOf?.(actor)?.trim() || actor.displayName?.trim() || id;
  return clipSceneText(name, 16) || id;
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '';
  if (seconds < 60) return ` ${seconds}s`;
  if (seconds < 3600) return ` ${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return ` ${Math.round(seconds / 3600)}h`;
  return ` ${Math.round(seconds / 86400)}d`;
}

/**
 * 一条事件的极短英文摘要（≤ {@link SCENE_EVENT_SUMMARY_MAX} 字符）。不是场景事件时返回空串。
 * 摘要只含称呼、动作与截断后的短文本；没有分数、没有原始字段。
 */
export function summarizeSceneEvent(event: ConversationEvent, options: SceneEventSummaryOptions = {}): string {
  const by = (actor: ActorRef | undefined) => (actor ? ` by ${nameOf(actor, options)}` : '');
  let text: string;
  switch (event.type) {
    case 'member.muted':
      text = WHOLE_SCENE_IDS.has(String(event.member.id))
        ? `mute-all on${by(event.actor)}`
        : `${nameOf(event.member, options)} muted${formatDuration(event.durationSeconds)}${by(event.actor)}`;
      break;
    case 'member.unmuted':
      text = WHOLE_SCENE_IDS.has(String(event.member.id))
        ? `mute-all off${by(event.actor)}`
        : `${nameOf(event.member, options)} unmuted${by(event.actor)}`;
      break;
    case 'member.joined':
      text = `${nameOf(event.member, options)} joined`;
      break;
    case 'member.left':
      text = event.reason === 'removed'
        ? `${nameOf(event.member, options)} removed${by(event.actor)}`
        : `${nameOf(event.member, options)} left`;
      break;
    case 'member.role_changed':
      text = `${nameOf(event.member, options)} ${event.enabled ? 'became' : 'is no longer'} ${event.role}`;
      break;
    case 'scene.join_requested': {
      const comment = clipSceneText(event.comment, 24);
      text = event.invite
        ? `${nameOf(event.actor, options)} invites you to join`
        : `${nameOf(event.actor, options)} asks to join${comment ? `: "${comment}"` : ''}`;
      break;
    }
    case 'scene.notice_updated': {
      const body = clipSceneText(event.text, 30);
      text = `notice updated${by(event.actor)}${body ? `: "${body}"` : ''}`;
      break;
    }
    case 'conversation.poked':
      text = `${nameOf(event.actor, options)} poked ${nameOf(event.target, options)}`;
      break;
    case 'message.reaction_changed':
      text = `${nameOf(event.actor, options)} ${event.operation === 'removed' ? 'removed' : 'reacted'} ${clipSceneText(event.reaction, 8)}`;
      break;
    case 'member.card_changed':
    case 'member.title_changed':
    case 'member.remark_changed': {
      const field = event.type === 'member.card_changed' ? 'card' : event.type === 'member.title_changed' ? 'title' : 'remark';
      const value = clipSceneText(event.value, 16);
      text = `${nameOf(event.member, options)} ${field} → ${value ? `"${value}"` : '(cleared)'}`;
      break;
    }
    default:
      return '';
  }
  return clipSceneText(text, SCENE_EVENT_SUMMARY_MAX);
}
