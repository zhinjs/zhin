import type { Message, MessageType } from './message.js';
import type { SendContent, SendOptions } from './types.js';

export type IMSceneKind = MessageType;

export interface IMSceneParentRef {
  kind: Extract<IMSceneKind, 'group' | 'channel'>;
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

  const parent = message.$channel?.parent
    ? {
        kind: message.$channel.parent.type as IMSceneParentRef['kind'],
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
  const platform = String(scene.platform || 'unknown');
  const endpointId = String(scene.endpointId || 'default');
  const kind: IMSceneKind = scene.kind || 'private';
  const sceneId = String(scene.sceneId || 'unknown');
  return `${platform}:${endpointId}:${kind}:${sceneId}`;
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
