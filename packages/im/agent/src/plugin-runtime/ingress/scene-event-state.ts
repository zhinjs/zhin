/**
 * ADR 0041 §6/§7: member side events that become `EventMessage`s in the session history
 * (`[state change] …` lines) instead of ephemeral `[Scene events]` lines.
 *
 * Lines are fixed templates; operator ids are taken from the normalized event (`system` when the
 * platform gives none) and free text (card / title) is only ever rendered as a quoted, clipped value.
 */
import {
  createMemberChangedEvent,
  createMemberPresenceEvent,
  type EventMessage,
} from '@zhin.js/ai';
import type { ConversationEvent } from '@zhin.js/im-contract';

/** OneBot-style ids that mean "everyone" (a scene-wide mute, not a member). */
const WHOLE_SCENE_IDS = new Set(['0', 'all']);

function idOf(actor: { id: unknown } | undefined): string | undefined {
  return actor ? String(actor.id) : undefined;
}

/**
 * @returns the event message for this side event, or undefined when it is not a recorded member
 * state change (pokes, notices, join requests, scene-wide mutes …).
 */
export function sceneEventToStateMessage(event: ConversationEvent): EventMessage | undefined {
  const source = { timestamp: event.timestamp, ...(event.eventId ? { id: String(event.eventId) } : {}) };
  const sceneId = String(event.conversation.id);
  switch (event.type) {
    case 'member.joined':
      return createMemberPresenceEvent(source, {
        action: 'join', userId: String(event.member.id), sceneId, ...operator(idOf(event.actor)),
      });
    case 'member.left':
      return createMemberPresenceEvent(source, {
        action: 'leave', userId: String(event.member.id), sceneId, ...operator(event.reason === 'removed' ? idOf(event.actor) : undefined),
      });
    case 'member.role_changed':
      return createMemberChangedEvent(source, {
        ...operator(idOf(event.actor)), userId: String(event.member.id), field: 'role', value: event.enabled ? event.role : 'member',
      });
    case 'member.muted':
      if (WHOLE_SCENE_IDS.has(String(event.member.id))) return undefined;
      return createMemberChangedEvent(source, {
        ...operator(idOf(event.actor)), userId: String(event.member.id), field: 'mute_time', value: String(Math.max(0, Math.floor(event.durationSeconds || 0))),
      });
    case 'member.unmuted':
      if (WHOLE_SCENE_IDS.has(String(event.member.id))) return undefined;
      return createMemberChangedEvent(source, {
        ...operator(idOf(event.actor)), userId: String(event.member.id), field: 'mute_time', value: '0',
      });
    case 'member.card_changed':
      return createMemberChangedEvent(source, {
        ...operator(idOf(event.actor)), userId: String(event.member.id), field: 'group_nickname', value: event.value ?? '',
      });
    case 'member.title_changed':
      return createMemberChangedEvent(source, {
        ...operator(idOf(event.actor)), userId: String(event.member.id), field: 'group_title', value: event.value ?? '',
      });
    default:
      return undefined;
  }
}

function operator(id: string | undefined): { operatorId?: string } {
  return id ? { operatorId: id } : {};
}
