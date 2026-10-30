import { createHash } from 'node:crypto';
import { conversationRefKey, type ConversationKind, type ConversationRef } from '@zhin.js/im-contract';
import type { PersonalSessionAddress, PersonalSessionIdentity, PersonalSessionOwner } from './types.js';

function identityPart(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty identity`);
  return value;
}

function conversationKind(value: ConversationKind): ConversationKind {
  if (!['private', 'group', 'channel'].includes(value)) throw new TypeError('Invalid conversation kind');
  return value;
}

function digest(parts: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

// Capability ids may contain NUL. Preserve canonical values while framing every
// field structurally, so embedded separators can never merge distinct scopes.
function conversationTuple(conversation: ConversationRef): readonly unknown[] {
  return [conversation.endpoint.adapter, conversation.endpoint.id, conversation.kind, conversation.id,
    conversation.parent ? [conversation.parent.kind, conversation.parent.id] : null, conversation.threadId ?? null];
}

export function samePersonalSessionOwner(left: PersonalSessionOwner, right: PersonalSessionOwner): boolean {
  return left.rootId === right.rootId && left.platform === right.platform && left.endpoint === right.endpoint
    && left.adapterId === right.adapterId && left.subjectId === right.subjectId;
}

/** Personal catalog/vault owner across scenes, scoped to one Host and account. */
export function personalSessionOwnerId(owner: PersonalSessionOwner): string {
  const parts = [
    identityPart(owner.rootId, 'rootId'), identityPart(owner.platform, 'platform'),
    identityPart(owner.endpoint, 'endpoint instance'), identityPart(owner.adapterId, 'adapter capability id'),
    identityPart(owner.subjectId, 'subjectId'),
  ];
  return `personal-owner:v1:${digest(parts)}`;
}

/** Copies canonical identity fields; display names never affect Session identity. */
export function personalSessionIdentity(input: PersonalSessionAddress): PersonalSessionIdentity {
  const rootId = identityPart(input.rootId, 'rootId');
  const platform = identityPart(input.platform, 'platform');
  const endpoint = identityPart(input.endpoint, 'endpoint instance');
  const subjectId = identityPart(input.subjectId, 'subjectId');
  const source = input.conversation;
  const conversation = Object.freeze({
    endpoint: Object.freeze({
      adapter: identityPart(source.endpoint.adapter, 'adapter'),
      id: identityPart(source.endpoint.id, 'endpoint'),
    }),
    kind: conversationKind(source.kind),
    id: identityPart(source.id, 'conversation id'),
    ...(source.parent ? { parent: Object.freeze({
      kind: conversationKind(source.parent.kind),
      id: identityPart(source.parent.id, 'parent id'),
    }) } : {}),
    ...(source.threadId !== undefined ? { threadId: identityPart(source.threadId, 'thread id') } : {}),
  });
  const address = Object.freeze({ rootId, platform, endpoint, conversation, subjectId });
  const scene = [rootId, platform, endpoint, conversationRefKey(conversation), conversationTuple(conversation)];
  return Object.freeze({
    key: `personal-session:v1:${digest([...scene, subjectId])}`,
    sceneKey: `personal-scene:v1:${digest(scene)}`,
    address,
    owner: Object.freeze({ rootId, platform, endpoint, adapterId: conversation.endpoint.id, subjectId }),
  });
}

export function samePersonalSessionAddress(left: PersonalSessionAddress, right: PersonalSessionAddress): boolean {
  return left.rootId === right.rootId && left.platform === right.platform && left.endpoint === right.endpoint
    && left.subjectId === right.subjectId
    && JSON.stringify(conversationTuple(left.conversation)) === JSON.stringify(conversationTuple(right.conversation));
}
