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
  readonly recalled?: boolean;
  readonly recalledMessageId?: string;
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
    ...(item.recalled === true ? { recalled: true } : {}),
    ...(typeof item.recalledMessageId === 'string' ? { recalledMessageId: item.recalledMessageId } : {}),
  };
}

export function hasPlaygroundKeyboard(content: readonly MessageSegment[]): boolean {
  return content.some(segment => segment?.type === 'keyboard' || (segment?.type === 'forward'
    && Array.isArray(segment.data?.entries) && segment.data.entries.some((entry: { segments?: MessageSegment[] }) =>
      Array.isArray(entry?.segments) && hasPlaygroundKeyboard(entry.segments))));
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
  const index = messages.findIndex(message => message.id === incoming.id
    && message.channelType === incoming.channelType && message.channelId === incoming.channelId
    && message.type === incoming.type);
  return index < 0 ? [...messages, incoming]
    : messages.map((message, offset) => offset === index ? { ...message, ...incoming } : message);
}
