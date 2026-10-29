/**
 * ADR 0041 §1/§2 state-change lines. Only fixed templates are produced: the verbs (`changed` / `join`
 * / `leave`) and field names are a whitelist, and every value a member can influence is either
 * rendered through {@link renderSenderId} (ids) or {@link quoteEventValue} (free text).
 */
import type { EventMessage } from '../llm/types/agent-message.js';
import { escapeHeaderValue, quoteEventValue, renderSenderId } from './message-header.js';

export const STATE_CHANGE_PREFIX = '[state change]';

/** Fields a `changed` line may name. */
export const MEMBER_PROFILE_FIELDS = Object.freeze(['role', 'name', 'mute_time', 'group_title', 'group_nickname'] as const);
export type MemberProfileField = typeof MEMBER_PROFILE_FIELDS[number];

/** Instance-timezone `HH:mm:ss.SSS`. */
export function formatEventClock(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/** The actor of a change as it appears in a line: absent operator = the host (`system`). */
function renderOperator(operatorId: string | undefined): string {
  return operatorId && operatorId.trim() ? renderSenderId(operatorId) : 'system';
}

/** `<operator> changed <user_id> <field> to "<value>"` */
export function formatMemberChangedLine(input: Readonly<{
  operatorId?: string;
  userId: string;
  field: MemberProfileField;
  value: string;
}>): string {
  return `${renderOperator(input.operatorId)} changed ${renderSenderId(input.userId)} ${input.field} to ${quoteEventValue(input.value)}`;
}

/** `<user_id> join|leave <scene_id> on <HH:mm:ss.SSS> by <self|operator_id>` */
export function formatMemberPresenceLine(input: Readonly<{
  action: 'join' | 'leave';
  userId: string;
  sceneId: string;
  timestamp: number;
  /** Operator when someone else caused it (kick, approval); absent or equal to the member = `self`. */
  operatorId?: string;
}>): string {
  const user = renderSenderId(input.userId);
  const operator = input.operatorId?.trim();
  const sameAsMember = !operator || operator === input.userId.trim();
  // A real operator literally named `self` must not read as the self marker.
  const by = sameAsMember ? 'self' : (renderSenderId(operator).toLowerCase() === 'self' ? `user:${renderSenderId(operator)}` : renderSenderId(operator));
  return `${user} ${input.action} ${escapeHeaderValue(input.sceneId)} on ${formatEventClock(input.timestamp)} by ${by}`;
}

export interface EventMessageSource {
  readonly timestamp: number;
  /** Stable id for the header (e.g. the conversation event sequence); falls back to the timestamp. */
  readonly id?: string;
}

export function createMemberChangedEvent(
  source: EventMessageSource,
  input: Parameters<typeof formatMemberChangedLine>[0],
): EventMessage {
  return {
    role: 'event',
    kind: 'member_changed',
    name: formatMemberChangedLine(input),
    timestamp: source.timestamp,
    ...(source.id ? { id: source.id } : {}),
  };
}

export function createMemberPresenceEvent(
  source: EventMessageSource,
  input: Omit<Parameters<typeof formatMemberPresenceLine>[0], 'timestamp'>,
): EventMessage {
  return {
    role: 'event',
    kind: input.action === 'join' ? 'member_joined' : 'member_left',
    name: formatMemberPresenceLine({ ...input, timestamp: source.timestamp }),
    timestamp: source.timestamp,
    ...(source.id ? { id: source.id } : {}),
  };
}
