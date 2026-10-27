/**
 * 会话画像入站钩子：每条 IM 入站消息在旁听判定与 AI 回合之前调用。
 * 折叠新的 conversation_events 与发送者角色进会话画像，并判定 Bot 当前能否在此会话发言。
 * 任何错误都按「可以发言」处理（fail-open），不阻断正常消息。
 */
import { sceneRoleOf, type SessionProfileStore, type SpeakBlockReason } from '@zhin.js/agent';
import type { Message } from '@zhin.js/core/runtime';
import type { ConversationEventReader } from '@zhin.js/im-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';

const logger = getLogger('agent');

export interface SessionGateInput {
  readonly sessions: SessionProfileStore | undefined;
  readonly events: ConversationEventReader | undefined;
  readonly message: Message;
  readonly platform: string;
  readonly scope: 'private' | 'group' | 'channel';
  readonly sceneId: string;
  readonly senderId: string;
  readonly endpointId: string;
  readonly conversationSequence: number | undefined;
}

export async function observeSessionAndCheckSpeak(input: SessionGateInput): Promise<SpeakBlockReason | null> {
  const { sessions, message } = input;
  if (!sessions || !input.platform || !input.sceneId) return null;
  try {
    const metadata = (message.metadata ?? {}) as Record<string, unknown>;
    const roles = [
      ...((message.sender as { roles?: readonly unknown[] } | undefined)?.roles ?? []),
      ...(Array.isArray(metadata.roles) ? metadata.roles : []),
    ];
    const selfIds = [input.endpointId, metadata.selfId, metadata.self_id]
      .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
      .map(String);
    const conversationName = (message.conversation as { name?: unknown }).name;
    const { blocked } = await sessions.observeInbound({
      platform: input.platform,
      scope: input.scope,
      sceneId: input.sceneId,
      ...(typeof conversationName === 'string' ? { title: conversationName } : {}),
      sender: { id: input.senderId, ...(message.sender?.name ? { name: message.sender.name } : {}), sceneRole: sceneRoleOf(roles) },
      selfIds,
      throughSequence: input.conversationSequence,
      ...(input.events ? {
        events: {
          listBetween: (after: number, through: number, limit: number) =>
            input.events!.listBetween(message.conversation, after, through, limit),
        },
      } : {}),
    });
    return blocked;
  } catch (error) {
    logger.warn(formatCompact({ op: 'session_profile_observe_failed', error: error instanceof Error ? error.message : String(error) }));
    return null;
  }
}

export interface SceneWakeGateInput {
  readonly sessions: SessionProfileStore | undefined;
  readonly events: ConversationEventReader | undefined;
  readonly conversation: Message['conversation'];
  readonly platform: string;
  readonly scope: 'group' | 'channel';
  readonly sceneId: string;
  readonly selfIds: readonly string[];
  readonly throughSequence: number;
}

/**
 * 状态感知唤醒（#996）走同一道门：先把这批事件折叠进会话画像（禁言 Bot、全员禁言等），
 * 再判定能否发言。不能发言时调用方**不调模型**，只留下更新后的画像。fail-open。
 */
export async function observeSceneWakeAndCheckSpeak(input: SceneWakeGateInput): Promise<SpeakBlockReason | null> {
  const { sessions } = input;
  if (!sessions || !input.platform || !input.sceneId) return null;
  try {
    const { blocked } = await sessions.observeInbound({
      platform: input.platform,
      scope: input.scope,
      sceneId: input.sceneId,
      selfIds: input.selfIds,
      throughSequence: input.throughSequence,
      ...(input.events ? {
        events: {
          listBetween: (after: number, through: number, limit: number) =>
            input.events!.listBetween(input.conversation, after, through, limit),
        },
      } : {}),
    });
    return blocked;
  } catch (error) {
    logger.warn(formatCompact({ op: 'session_profile_observe_failed', source: 'scene_wake', error: error instanceof Error ? error.message : String(error) }));
    return null;
  }
}
