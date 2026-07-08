import type { Message, MessageType } from './message.js';
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
  endpointId: string;
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

export function sceneRefFromMessage(message: Partial<Message<any>>): IMSceneRef | undefined {
  const platform = nonEmptyString(message.$adapter);
  const endpointId = nonEmptyString(message.$endpoint);
  const kind = message.$channel?.type;
  if (!platform || !endpointId || !kind) return undefined;

  const senderId = nonEmptyString(message.$sender?.id);
  const channelId = nonEmptyString(message.$channel?.id);
  const sceneId = kind === 'private'
    ? senderId ?? channelId
    : channelId ?? senderId;
  if (!sceneId) return undefined;

  const parentKind = message.$channel?.parent
    ? normalizeIMSceneParentKind(message.$channel.parent.type)
    : undefined;
  const parent = parentKind && message.$channel?.parent
    ? {
        kind: parentKind,
        sceneId: String(message.$channel.parent.id),
      }
    : undefined;

  return {
    platform,
    endpointId,
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
    endpoint: scene.endpointId,
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
    endpointId: scene.endpointId,
    sceneId: scene.sceneId,
    kind: scene.kind as KernelIMSceneKind,
  });
}

export function messageToIMDeliveryTarget(message: Partial<Message<any>>): IMDeliveryTarget | undefined {
  const scene = sceneRefFromMessage(message);
  if (!scene) return undefined;
  const quoteId = nonEmptyString(message.$quote_id);
  return {
    channel: 'im',
    scene,
    ...(quoteId ? { quoteId } : {}),
  };
}
