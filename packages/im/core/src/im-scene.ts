import type { MessageType } from './message.js';
import type { Message } from './plugin-runtime/im/contracts.js';
import type { SendContent, SendOptions } from './types.js';
import {
  resolveIMSceneSessionId as resolveIMSceneSessionIdKernel,
  type IMSceneKind as KernelIMSceneKind,
} from '@zhin.js/kernel';

export type IMSceneKind = MessageType;

/** Parent scene kind (distinct from sub-channel MessageType.channel). */
export type IMSceneParentKind = 'group' | 'guild';

export interface IMSceneParentRef {
  kind: IMSceneParentKind;
  sceneId: string;
}

export interface IMSceneRef {
  platform: string;
  endpointKey: string;
  sceneId: string;
  kind: IMSceneKind;
  senderId?: string;
  parent?: IMSceneParentRef;
}

export interface IMDeliveryTarget {
  channel: 'im';
  scene: IMSceneRef;
  threadId?: string;
  quoteId?: string;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Normalize legacy parent.type channel → guild. */
export function normalizeIMSceneParentKind(value: unknown): IMSceneParentKind | undefined {
  if (value === 'group' || value === 'guild') return value;
  if (value === 'channel') return 'guild';
  return undefined;
}

export function sceneRefFromMessage(message: Partial<Message>): IMSceneRef | undefined {
  const platform = nonEmptyString(message.clientAdapter ?? message.conversation?.endpoint.adapter);
  const endpointKey = nonEmptyString(message.endpointId ?? message.conversation?.endpoint.id);
  const kind = message.conversation?.kind;
  if (!platform || !endpointKey || !kind) return undefined;

  const senderId = nonEmptyString(message.sender?.id);
  const channelId = nonEmptyString(message.conversation?.id);
  const sceneId = kind === 'private'
    ? senderId ?? channelId
    : channelId ?? senderId;
  if (!sceneId) return undefined;

  const parentKind = message.conversation?.parent
    ? normalizeIMSceneParentKind(message.conversation.parent.kind)
    : undefined;
  const parent = parentKind && message.conversation?.parent
    ? {
        kind: parentKind,
        sceneId: String(message.conversation.parent.id),
      }
    : undefined;

  return {
    platform,
    endpointKey,
    sceneId,
    kind,
    ...(senderId ? { senderId } : {}),
    ...(parent ? { parent } : {}),
  };
}

export function sceneRefToSendOptions(
  target: IMDeliveryTarget,
  content: SendContent,
): SendOptions {
  const { scene } = target;
  return {
    context: scene.platform,
    endpoint: scene.endpointKey,
    id: scene.sceneId,
    type: scene.kind,
    parent: scene.parent
      ? { type: scene.parent.kind, id: scene.parent.sceneId }
      : undefined,
    content,
    ...(target.quoteId ? { quoteId: target.quoteId } : {}),
    ...(target.threadId ? { threadId: target.threadId } : {}),
  };
}

export function resolveIMSceneSessionId(scene: IMSceneRef): string {
  return resolveIMSceneSessionIdKernel({
    platform: scene.platform,
    endpointKey: scene.endpointKey,
    sceneId: scene.sceneId,
    kind: scene.kind as KernelIMSceneKind,
  });
}

export function messageToIMDeliveryTarget(message: Partial<Message>): IMDeliveryTarget | undefined {
  const scene = sceneRefFromMessage(message);
  if (!scene) return undefined;
  return {
    channel: 'im',
    scene,
  };
}
