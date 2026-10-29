/**
 * ADR 0041 §1/§4 participant headers.
 *
 * The trusted host stores the FULL header in `UserMessage.name` / `AssistantMessage.name`. At the LLM
 * boundary {@link projectParticipantHeaders} decides full vs short per `user_id`, synthesizes
 * `member_changed` events for facts that changed without an event, and renders the chosen header as
 * the first line of the message text. Stored history is never mutated and `name` is never sent to a provider.
 */
import type {
  AgentMessage,
  AssistantMessage,
  ConversationActor,
  EventMessage,
  UserMessage,
} from '../llm/types/agent-message.js';
import { isEventMessage } from '../llm/types/agent-message.js';
import { formatHeader, quoteEventValue, renderSenderId } from './message-header.js';

export interface ParticipantFacts {
  /** Native message id (users only; the bot's own sent ids are unknown at store time). */
  readonly messageId?: string;
  /** Already rendered via {@link renderSenderId}. */
  readonly userId: string;
  readonly name?: string;
  /** Platform role + authorization roles, deduplicated. */
  readonly role?: readonly string[];
  readonly groupNickname?: string;
  readonly groupTitle?: string;
  /** Remaining mute seconds relative to the message timestamp; 0 = not muted; undefined = unknown. */
  readonly muteTime?: number;
  /** Only another bot is marked (trusted ingress `origin=peer_bot`); humans carry no origin field. */
  readonly origin?: 'peer_bot';
}

export interface HeaderFormatOptions {
  /** IANA zone of the instance; defaults to the process zone. */
  readonly timeZone?: string;
}

const PLATFORM_ROLES = new Set(['owner', 'admin', 'member']);
const SCENE_ROLE_ALIASES: Record<string, string> = { scene_owner: 'owner', scene_admin: 'admin' };

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? '';
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      ...(timeZone ? { timeZone } : {}),
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      fractionalSecondDigits: 3,
    });
    formatterCache.set(key, formatter);
  }
  return formatter;
}

/** `{ date: 'YYYY-MM-DD', time: 'HH:mm:ss.SSS' }` in the instance zone. */
export function formatHeaderInstant(timestamp: number, options?: HeaderFormatOptions): { date: string; time: string } {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(options?.timeZone).formatToParts(new Date(timestamp))) parts[part.type] = part.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond}`,
  };
}

/** Platform roles first, then authorization roles; `user` (the default) is dropped. */
export function mergeHeaderRoles(...lists: ReadonlyArray<readonly string[] | undefined>): string[] {
  const seen = new Set<string>();
  for (const list of lists) {
    for (const raw of list ?? []) {
      const role = SCENE_ROLE_ALIASES[raw] ?? raw;
      if (role && role !== 'user') seen.add(role);
    }
  }
  const all = [...seen];
  return [...all.filter(role => PLATFORM_ROLES.has(role)), ...all.filter(role => !PLATFORM_ROLES.has(role))];
}

export function muteTimeFromExpiry(mutedUntil: number | null | undefined, timestamp: number): number | undefined {
  if (typeof mutedUntil !== 'number' || !Number.isFinite(mutedUntil)) return undefined;
  return mutedUntil <= 0 ? 0 : Math.max(0, Math.ceil((mutedUntil - timestamp) / 1000));
}

export function factsFromActor(actor: ConversationActor, messageId: string | undefined, timestamp: number): ParticipantFacts {
  let role = mergeHeaderRoles(actor.roles, actor.authorizationRoles);
  if (role.length === 0 && (actor.scope === 'group' || actor.scope === 'channel')) role = ['member'];
  const muteTime = muteTimeFromExpiry(actor.mutedUntil, timestamp);
  return {
    ...(messageId ? { messageId } : {}),
    userId: renderSenderId(actor.subjectId),
    ...(actor.displayName?.trim() ? { name: actor.displayName.trim() } : {}),
    ...(role.length ? { role } : {}),
    ...(actor.groupNickname ? { groupNickname: actor.groupNickname } : {}),
    ...(actor.groupTitle ? { groupTitle: actor.groupTitle } : {}),
    ...(muteTime !== undefined ? { muteTime } : {}),
    ...(actor.origin === 'peer_bot' ? { origin: 'peer_bot' as const } : {}),
  };
}

export interface BotHeaderFacts {
  readonly id?: string;
  readonly name?: string;
  readonly platformRole?: string;
  readonly nickname?: string;
}

export function factsFromBot(bot: BotHeaderFacts | undefined): ParticipantFacts | undefined {
  if (!bot?.id) return undefined;
  const role = mergeHeaderRoles(bot.platformRole ? [bot.platformRole] : undefined);
  return {
    userId: renderSenderId(bot.id),
    ...(bot.name?.trim() ? { name: bot.name.trim() } : {}),
    ...(role.length ? { role } : {}),
    ...(bot.nickname ? { groupNickname: bot.nickname } : {}),
  };
}

interface RenderOptions extends HeaderFormatOptions {
  readonly full: boolean;
  readonly date?: boolean;
  /** Bots do not advertise mute_time (ADR: id/name/role/group_nickname). */
  readonly bot?: boolean;
}

/** Renders a header line; the full form carries every known fact, the short form only id / user_id / time. */
export function renderParticipantHeader(facts: ParticipantFacts, timestamp: number, options: RenderOptions): string {
  const instant = formatHeaderInstant(timestamp, options);
  const date: [string, string | undefined] = ['date', options.date ? instant.date : undefined];
  if (!options.full) {
    return formatHeader([['id', facts.messageId], ['user_id', facts.userId], date, ['time', instant.time]]);
  }
  return formatHeader([
    ['id', facts.messageId],
    ['user_id', facts.userId],
    ['name', facts.name],
    ['role', facts.role],
    ['origin', facts.origin],
    ['group_nickname', facts.groupNickname],
    ['group_title', facts.groupTitle],
    ['mute_time', options.bot ? undefined : facts.muteTime],
    date,
    ['time', instant.time],
  ]);
}

/** The FULL header stored in `name` by the trusted host. */
export function buildStoredHeader(facts: ParticipantFacts, timestamp: number, options?: HeaderFormatOptions & { bot?: boolean }): string {
  return renderParticipantHeader(facts, timestamp, { ...options, full: true });
}

/** Parses a `[k:v;…;]` header line back into facts. Returns undefined when it is not a participant header. */
export function parseParticipantHeader(line: string | undefined): ParticipantFacts | undefined {
  if (typeof line !== 'string') return undefined;
  const match = /^\[(.*);\]$/u.exec(line.trim());
  if (!match) return undefined;
  const raw: Record<string, string> = {};
  for (const part of match[1]!.split(';')) {
    const colon = part.indexOf(':');
    if (colon > 0) raw[part.slice(0, colon)] = part.slice(colon + 1);
  }
  if (!raw.user_id) return undefined;
  return {
    userId: raw.user_id,
    ...(raw.id !== undefined ? { messageId: raw.id } : {}),
    ...(raw.name !== undefined ? { name: raw.name } : {}),
    ...(raw.role ? { role: raw.role.split(',').filter(Boolean) } : {}),
    ...(raw.group_nickname !== undefined ? { groupNickname: raw.group_nickname } : {}),
    ...(raw.group_title !== undefined ? { groupTitle: raw.group_title } : {}),
    ...(raw.mute_time !== undefined && /^\d+$/u.test(raw.mute_time) ? { muteTime: Number(raw.mute_time) } : {}),
    ...(raw.origin === 'peer_bot' ? { origin: 'peer_bot' as const } : {}),
  };
}

type TextMessage = UserMessage | AssistantMessage;

function messageFacts(message: TextMessage): ParticipantFacts | undefined {
  const parsed = parseParticipantHeader(message.name);
  if (parsed) return parsed;
  if (message.role === 'user' && message.actor) return factsFromActor(message.actor, message.messageId, message.timestamp);
  return undefined;
}

/** The short form of a stored header (used to strip rendered prefixes from stored text). */
export function shortHeaderOf(name: string | undefined, timestamp: number, options?: HeaderFormatOptions): string | undefined {
  const facts = parseParticipantHeader(name);
  return facts ? renderParticipantHeader(facts, timestamp, { ...options, full: false }) : undefined;
}

const FIELD_ORDER = ['role', 'name', 'mute_time', 'group_title', 'group_nickname'] as const;
type Field = (typeof FIELD_ORDER)[number];

interface Remembered {
  facts: ParticipantFacts;
  timestamp: number;
}

function fieldValue(facts: ParticipantFacts, field: Field): string | undefined {
  switch (field) {
    case 'role': return facts.role?.join(',');
    case 'name': return facts.name;
    case 'group_title': return facts.groupTitle;
    case 'group_nickname': return facts.groupNickname;
    case 'mute_time': return facts.muteTime === undefined ? undefined : String(facts.muteTime);
  }
}

function fieldChanged(field: Field, before: Remembered, after: Remembered): boolean {
  const a = fieldValue(before.facts, field);
  const b = fieldValue(after.facts, field);
  if (a === undefined || b === undefined) return false; // missing = unknown, never a change
  if (field === 'role') return [...before.facts.role ?? []].sort().join(',') !== [...after.facts.role ?? []].sort().join(',');
  if (field === 'mute_time') {
    const x = before.facts.muteTime!, y = after.facts.muteTime!;
    if ((x === 0) !== (y === 0)) return true;
    // Remaining seconds shrink while a mute runs; only a different expiry is a change.
    return x > 0 && Math.abs((before.timestamp + x * 1000) - (after.timestamp + y * 1000)) > 5000;
  }
  return a !== b;
}

const EVENT_LINE = /^\S+ changed (\S+) (role|name|mute_time|group_title|group_nickname) to /u;

function prefixFirstText(message: TextMessage, header: string): TextMessage {
  const content = message.content as Array<{ type: string; text?: string; contextRef?: unknown; ephemeral?: boolean; presentation?: string }>;
  let index = content.findIndex(block => block.type === 'text' && block.presentation === 'user-input');
  if (index < 0) index = content.findIndex(block => block.type === 'text' && typeof block.text === 'string' && !block.contextRef && !block.ephemeral);
  if (index < 0) {
    return { ...message, content: [{ type: 'text', text: header }, ...message.content] } as TextMessage;
  }
  const block = content[index]!;
  return {
    ...message,
    content: content.map((part, i) => i === index ? { ...part, text: `${header}\n${block.text ?? ''}` } : part),
  } as TextMessage;
}

function mergeFacts(before: ParticipantFacts, after: ParticipantFacts, beforeTs: number, afterTs: number): ParticipantFacts {
  const muteTime = after.muteTime !== undefined
    ? after.muteTime
    : before.muteTime === undefined ? undefined : Math.max(0, before.muteTime - Math.round((afterTs - beforeTs) / 1000));
  const name = after.name ?? before.name;
  const role = after.role ?? before.role;
  const groupNickname = after.groupNickname ?? before.groupNickname;
  const groupTitle = after.groupTitle ?? before.groupTitle;
  return {
    ...after,
    ...(name !== undefined ? { name } : {}),
    ...(role !== undefined ? { role } : {}),
    ...(groupNickname !== undefined ? { groupNickname } : {}),
    ...(groupTitle !== undefined ? { groupTitle } : {}),
    ...(muteTime !== undefined ? { muteTime } : {}),
  };
}

/**
 * Renders participant headers for the visible window (oldest → newest). First sight of a `user_id`
 * gets the full header, unchanged facts the short one, and changed facts get a synthesized
 * `member_changed` event right before the message (unless the history already carries one).
 */
export function projectParticipantHeaders(messages: AgentMessage[], options?: HeaderFormatOptions): AgentMessage[] {
  const remembered = new Map<string, Remembered>();
  const pendingEvents = new Map<string, Set<string>>();
  let lastDate: string | undefined;
  let changed = false;
  const out: AgentMessage[] = [];
  for (const message of messages) {
    if (isEventMessage(message)) {
      const hit = EVENT_LINE.exec(message.name);
      if (hit) {
        const fields = pendingEvents.get(hit[1]!) ?? new Set<string>();
        fields.add(hit[2]!);
        pendingEvents.set(hit[1]!, fields);
      }
      out.push(message);
      continue;
    }
    if (message.role !== 'user' && message.role !== 'assistant') { out.push(message); continue; }
    const text = message as TextMessage;
    if (!Array.isArray(text.content)) { out.push(message); continue; }
    // A tool-call-only assistant turn has no text to carry a header; it neither introduces the bot nor changes its facts.
    if (text.role === 'assistant' && !text.content.some(block => block.type === 'text')) { out.push(message); continue; }
    const facts = messageFacts(text);
    if (!facts) { out.push(message); continue; }

    const current: Remembered = { facts, timestamp: text.timestamp };
    const previous = remembered.get(facts.userId);
    const bot = text.role === 'assistant';
    const instant = formatHeaderInstant(text.timestamp, options);
    const withDate = instant.date !== lastDate;
    lastDate = instant.date;
    if (previous) {
      const pending = pendingEvents.get(facts.userId);
      for (const field of FIELD_ORDER) {
        if (bot && field === 'mute_time') continue;
        if (!fieldChanged(field, previous, current) || pending?.has(field)) continue;
        const event: EventMessage = {
          role: 'event', kind: 'member_changed', timestamp: text.timestamp,
          name: `system changed ${facts.userId} ${field} to ${quoteEventValue(fieldValue(facts, field)!)}`,
        };
        out.push(event);
      }
    }
    pendingEvents.delete(facts.userId);
    remembered.set(facts.userId, {
      timestamp: text.timestamp,
      facts: previous ? mergeFacts(previous.facts, facts, previous.timestamp, text.timestamp) : facts,
    });
    out.push(prefixFirstText(text, renderParticipantHeader(facts, text.timestamp, { ...options, full: !previous, date: withDate, bot })));
    changed = true;
  }
  return changed ? out : messages;
}
