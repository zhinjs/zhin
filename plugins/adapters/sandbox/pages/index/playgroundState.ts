import type { MessageSegment } from '@zhin.js/client';
import {
  DEFAULT_SANDBOX_AGENT_RUN_CONFIG,
  normalizeSandboxAgentRunConfig,
  type SandboxAgentRunConfig,
  type SandboxSafetyMode,
} from '../../src/run-config.js';

export const PLAYGROUND_STORAGE_KEY = 'zhin.sandbox.agent-playground.v1';

export type PlaygroundScope = 'private' | 'group' | 'channel';

export interface PlaygroundSession {
  readonly id: string;
  readonly name: string;
  readonly type: PlaygroundScope;
  readonly unread: number;
  readonly runConfig: SandboxAgentRunConfig;
}

export interface PlaygroundMessage {
  readonly id: string;
  readonly type: 'sent' | 'received';
  readonly channelType: PlaygroundScope;
  readonly channelId: string;
  readonly channelName: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly content: MessageSegment[];
  readonly timestamp: number;
  /** Legacy field name: the choice was submitted; this never reports policy acceptance. */
  readonly interactionResolved?: boolean;
  /** Stored controls are display data; only the live pending authority may accept their answers. */
  readonly interactionReadOnly?: boolean;
  readonly historySequence?: number;
  readonly historyCreatedSequence?: number;
  /** Origin of the selected historical body; a live wire revision clears this provenance. */
  readonly historyEvent?: Readonly<{ type: 'message.created' | 'message.updated'; sequence: number }>;
  readonly recalled?: boolean;
  readonly recalledMessageId?: string;
  readonly revision?: number;
  readonly streaming?: boolean;
  /** ADR 0064 P1b: reactions the Bot put on this message (Endpoint `control.addReaction`). */
  readonly reactions?: readonly PlaygroundReaction[];
  /** Payloads clicked on this message's buttons in this page session (not persisted). */
  readonly submittedActions?: readonly string[];
  /** What became of the last click: a processing failure or no answer at all (not persisted). */
  readonly actionFeedback?: PlaygroundActionFeedback;
}

export interface PlaygroundActionFeedback {
  readonly tone: 'error' | 'quiet';
  readonly text: string;
}

export interface PlaygroundReaction {
  readonly id: string;
  readonly emoji: string;
}

export interface PlaygroundState {
  readonly version: 1;
  readonly activeSessionId: string;
  readonly activeSessionType?: PlaygroundScope;
  readonly sessions: readonly PlaygroundSession[];
  readonly messages: readonly PlaygroundMessage[];
}

export interface PlaygroundStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function createDefaultPlaygroundState(workingDirectory = ''): PlaygroundState {
  const runConfig = (safetyMode: SandboxSafetyMode): SandboxAgentRunConfig => ({
    ...DEFAULT_SANDBOX_AGENT_RUN_CONFIG,
    workingDirectory,
    safetyMode,
  });
  const sessions: PlaygroundSession[] = [
    { id: 'sandbox-user', name: '快速试验', type: 'private', unread: 0, runConfig: runConfig('workspace-write') },
    { id: 'sandbox-group', name: '群组作用域', type: 'group', unread: 0, runConfig: runConfig('workspace-write') },
    { id: 'sandbox-channel', name: '频道作用域', type: 'channel', unread: 0, runConfig: runConfig('read-only') },
  ];
  return Object.freeze({
    version: 1,
    activeSessionId: sessions[0]!.id,
    activeSessionType: sessions[0]!.type,
    sessions,
    messages: [],
  });
}

export function loadPlaygroundState(
  storage: PlaygroundStorage | undefined = browserStorage(),
): PlaygroundState {
  const fallback = createDefaultPlaygroundState();
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(PLAYGROUND_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.version !== 1) return fallback;
    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions.map(parseSession).filter((item): item is PlaygroundSession => Boolean(item))
      : [];
    if (sessions.length === 0) return fallback;
    const sessionKeys = new Set(sessions.map(sessionIdentity));
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages.map(parseMessage).filter((item): item is PlaygroundMessage => (
          item !== undefined && sessionKeys.has(sessionIdentity({ id: item.channelId, type: item.channelType }))
        ))
      : [];
    const requestedActive = typeof parsed.activeSessionId === 'string'
      ? sessions.find((session) => session.id === parsed.activeSessionId && (
          parsed.activeSessionType === undefined || session.type === parsed.activeSessionType
        ))
      : undefined;
    const activeSession = requestedActive ?? sessions[0]!;
    return Object.freeze({
      version: 1,
      activeSessionId: activeSession.id,
      activeSessionType: activeSession.type,
      sessions,
      messages,
    });
  } catch {
    return fallback;
  }
}

export function savePlaygroundState(
  state: Omit<PlaygroundState, 'version'>,
  storage: PlaygroundStorage | undefined = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    const sessions = state.sessions;
    const sessionKeys = new Set(sessions.map(sessionIdentity));
    const activeSession = sessions.find((session) => session.id === state.activeSessionId && (
      state.activeSessionType === undefined || session.type === state.activeSessionType
    )) ?? sessions[0];
    storage.setItem(PLAYGROUND_STORAGE_KEY, JSON.stringify({
      version: 1,
      activeSessionId: activeSession?.id ?? '',
      activeSessionType: activeSession?.type,
      sessions,
      messages: state.messages.filter((message) => sessionKeys.has(sessionIdentity({
        id: message.channelId,
        type: message.channelType,
      }))),
    } satisfies PlaygroundState));
    return true;
  } catch {
    return false;
  }
}

function parseSession(value: unknown): PlaygroundSession | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || !item.id.trim() || typeof item.name !== 'string') return undefined;
  if (item.type !== 'private' && item.type !== 'group' && item.type !== 'channel') return undefined;
  return {
    id: item.id.slice(0, 256),
    name: item.name.trim().slice(0, 120) || '未命名试验',
    type: item.type,
    unread: Number.isSafeInteger(item.unread) && Number(item.unread) > 0 ? Number(item.unread) : 0,
    runConfig: normalizeSandboxAgentRunConfig(item.runConfig) ?? DEFAULT_SANDBOX_AGENT_RUN_CONFIG,
  };
}

function parseMessage(value: unknown): PlaygroundMessage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || typeof item.channelId !== 'string' || !Array.isArray(item.content)) return undefined;
  if (item.type !== 'sent' && item.type !== 'received') return undefined;
  if (item.channelType !== 'private' && item.channelType !== 'group' && item.channelType !== 'channel') return undefined;
  const historyEvent = item.historyEvent && typeof item.historyEvent === 'object' && !Array.isArray(item.historyEvent)
    ? item.historyEvent as Record<string, unknown> : undefined;
  return {
    id: item.id.slice(0, 256),
    type: item.type,
    channelType: item.channelType,
    channelId: item.channelId.slice(0, 256),
    channelName: typeof item.channelName === 'string' ? item.channelName.slice(0, 120) : '',
    senderId: typeof item.senderId === 'string' ? item.senderId.slice(0, 256) : '',
    senderName: typeof item.senderName === 'string' ? item.senderName.slice(0, 120) : '',
    content: item.content as MessageSegment[],
    timestamp: Number.isFinite(item.timestamp) ? Number(item.timestamp) : Date.now(),
    ...(item.interactionResolved === true ? { interactionResolved: true } : {}),
    ...(hasPlaygroundKeyboard(item.content as MessageSegment[]) ? { interactionReadOnly: true } : {}),
    ...(Number.isSafeInteger(item.historySequence) && Number(item.historySequence) > 0 ? { historySequence: Number(item.historySequence) } : {}),
    ...(Number.isSafeInteger(item.historyCreatedSequence) && Number(item.historyCreatedSequence) > 0
      ? { historyCreatedSequence: Number(item.historyCreatedSequence) } : {}),
    ...((historyEvent?.type === 'message.created' || historyEvent?.type === 'message.updated')
      && Number.isSafeInteger(historyEvent.sequence) && Number(historyEvent.sequence) > 0
      ? { historyEvent: { type: historyEvent.type, sequence: Number(historyEvent.sequence) } } : {}),
    ...(item.recalled === true ? { recalled: true } : {}),
    ...(typeof item.recalledMessageId === 'string' ? { recalledMessageId: item.recalledMessageId } : {}),
    ...(Number.isSafeInteger(item.revision) && Number(item.revision) > 0 ? { revision: Number(item.revision) } : {}),
    ...(typeof item.streaming === 'boolean' ? { streaming: item.streaming } : {}),
    ...(parseReactions(item.reactions)),
  };
}

const MAX_REACTIONS = 32;

function parseReactions(value: unknown): { reactions?: readonly PlaygroundReaction[] } {
  if (!Array.isArray(value)) return {};
  const reactions = value.flatMap((item): PlaygroundReaction[] => item && typeof item === 'object'
    && typeof item.id === 'string' && item.id && typeof item.emoji === 'string' && item.emoji
    ? [{ id: item.id.slice(0, 256), emoji: item.emoji.slice(0, 64) }] : []).slice(0, MAX_REACTIONS);
  return reactions.length > 0 ? { reactions } : {};
}

type SceneRef = Pick<PlaygroundSession, 'id' | 'type'>;

function inScene(message: PlaygroundMessage, scene: SceneRef, messageId: string): boolean {
  return message.id === messageId && message.channelType === scene.type && message.channelId === scene.id;
}

/** ADR 0064 P1b: the Bot recalled a message in this scene (its own or, as an admin, someone else's). */
export function recallPlaygroundMessage(messages: readonly PlaygroundMessage[], scene: SceneRef, messageId: string): PlaygroundMessage[] {
  return messages.map((message) => inScene(message, scene, messageId) ? { ...message, recalled: true, streaming: false } : message);
}

/** ADR 0064 P1b: a reaction was added to or removed from a message in this scene. */
export function reactPlaygroundMessage(
  messages: readonly PlaygroundMessage[],
  scene: SceneRef,
  change: Readonly<{ messageId: string; reactionId: string; emoji?: string; op: 'add' | 'remove' }>,
): PlaygroundMessage[] {
  return messages.map((message) => {
    if (!inScene(message, scene, change.messageId)) return message;
    const current = (message.reactions ?? []).filter((reaction) => reaction.id !== change.reactionId);
    const reactions = change.op === 'add' && change.emoji
      ? [...current, { id: change.reactionId, emoji: change.emoji }].slice(-MAX_REACTIONS)
      : current;
    const { reactions: _previous, ...rest } = message;
    return reactions.length > 0 ? { ...rest, reactions } : rest;
  });
}

export function hasPlaygroundKeyboard(content: readonly MessageSegment[]): boolean {
  return content.some(segment => segment?.type === 'keyboard' || (segment?.type === 'forward'
    && Array.isArray(segment.data?.entries) && segment.data.entries.some((entry: { segments?: MessageSegment[] }) =>
      Array.isArray(entry?.segments) && hasPlaygroundKeyboard(entry.segments))));
}

/** Retire only controls previously issued by the current authoritative prompt reader. */
export function retirePlaygroundInteractions(
  current: readonly PlaygroundMessage[],
  scene: Pick<PlaygroundSession, 'id' | 'type'>,
  retiredSegments: readonly MessageSegment[],
): PlaygroundMessage[] {
  const retired = new Set(keyboardPayloads(retiredSegments));
  return current.map(message => message.type === 'received' && message.channelType === scene.type && message.channelId === scene.id
    && message.interactionReadOnly !== true && keyboardPayloads(message.content).some(payload => retired.has(payload))
    ? { ...message, interactionReadOnly: true } : message);
}

function keyboardPayloads(segments: readonly MessageSegment[]): string[] {
  const payloads: string[] = [];
  for (const segment of segments) {
    if (segment?.type === 'keyboard' && Array.isArray(segment.data?.rows)) {
      for (const row of segment.data.rows) {
        if (!Array.isArray(row)) continue;
        for (const button of row) if (typeof button?.payload === 'string') payloads.push(button.payload);
      }
    } else if (segment?.type === 'forward') {
      if (Array.isArray(segment.data?.entries)) {
        for (const entry of segment.data.entries) if (Array.isArray(entry?.segments)) payloads.push(...keyboardPayloads(entry.segments));
      }
      if (Array.isArray(segment.data?.messages)) {
        for (const batch of segment.data.messages) if (Array.isArray(batch)) payloads.push(...keyboardPayloads(batch));
      }
    }
  }
  return payloads;
}

function browserStorage(): PlaygroundStorage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

function sessionIdentity(value: Pick<PlaygroundSession, 'id' | 'type'>): string {
  return `${value.type}\0${value.id}`;
}

/** Socket echoes replace their local optimistic row, without crossing scenes or authors. */
export function mergePlaygroundMessage(
  messages: readonly PlaygroundMessage[],
  incoming: PlaygroundMessage,
): PlaygroundMessage[] {
  if (messages.some(message => message.recalledMessageId === incoming.id
    && message.channelType === incoming.channelType && message.channelId === incoming.channelId)) return [...messages];
  const index = messages.findIndex(message => message.id === incoming.id
    && message.channelType === incoming.channelType && message.channelId === incoming.channelId
    && message.type === incoming.type);
  if (index < 0) return [...messages, incoming];
  const existing = messages[index]!;
  if (existing.recalled || existing.revision !== undefined && (incoming.revision ?? 0) <= existing.revision) return [...messages];
  return messages.map((message, offset) => offset === index ? { ...message, ...incoming,
    historyEvent: incoming.historyEvent,
    ...(incoming.revision === undefined ? {} : { timestamp: message.timestamp }),
  } : message);
}

/**
 * The action segment of a button click. Like a platform callback it carries the button's own id
 * and its payload separately (#1250 `sandbox-action-button-id-dropped`); a button without an id
 * falls back to its payload.
 */
export function sandboxActionSegment(payload: string, buttonId?: string): MessageSegment {
  return { type: 'action', data: { id: buttonId || payload, payload } };
}

/** A click on `cardId`: remembered as submitted, and any earlier feedback is cleared. */
export function markPlaygroundActionSubmitted(
  messages: readonly PlaygroundMessage[], scene: SceneRef, cardId: string, payload: string,
): PlaygroundMessage[] {
  return messages.map((message) => {
    if (!inScene(message, scene, cardId) || message.type !== 'received') return message;
    const { actionFeedback: _cleared, ...rest } = message;
    return { ...rest, interactionResolved: true,
      submittedActions: [...new Set([...(message.submittedActions ?? []), payload])] };
  });
}

/**
 * Shows `feedback` next to `cardId`. With `unlessRepliedSince`, a quiet notice is dropped when the
 * Bot has posted anything in the scene since the click (the click did get an answer).
 */
export function setPlaygroundActionFeedback(
  messages: readonly PlaygroundMessage[], scene: SceneRef, cardId: string, feedback: PlaygroundActionFeedback,
  unlessRepliedSince?: number,
): PlaygroundMessage[] {
  if (unlessRepliedSince !== undefined && messages.some((message) => message.type === 'received'
    && message.channelType === scene.type && message.channelId === scene.id && message.id !== cardId
    && message.timestamp >= unlessRepliedSince)) return [...messages];
  return messages.map((message) => inScene(message, scene, cardId) ? { ...message, actionFeedback: feedback } : message);
}
