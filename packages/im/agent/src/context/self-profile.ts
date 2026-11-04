import type { TurnContextView } from './turn-envelope.js';

/** Runtime account identity belongs to this turn, never to a shared Agent binding. */
export function turnAgentNickname(turn: TurnContextView | undefined, fallback?: string): string | undefined {
  if (turn?.origin.kind !== 'im') return fallback;
  const bot = turn.input?.contextState?.bot;
  const nickname = bot?.profile?.values.nickname;
  if (typeof nickname === 'string' && nickname.trim()) return nickname;
  return bot?.name?.trim() || fallback;
}

/** Preserve names as one scalar even when a platform returns control characters. */
export function promptNickname(nickname: string): string {
  return JSON.stringify(nickname).slice(1, -1);
}

export function hasNicknameSlot(text: string | undefined): boolean {
  return !!text && /\{\{\s*nickname\s*\}\}/u.test(text);
}
