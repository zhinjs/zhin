import { createMessages, type Locale } from 'zhin.js/i18n';
/**
 * Pure Russian roulette rules. No I/O, no clock and no randomness: callers pass
 * the bullet position in, so every transition is deterministic and testable.
 */

export const ROULETTE_STATE_VERSION = 1;

export type RoulettePhase = 'lobby' | 'playing' | 'finished' | 'aborted';

export type RouletteEndReason =
  | 'shot'
  | 'turn-timeout'
  | 'forfeit'
  | 'cancelled'
  | 'lobby-expired'
  | 'lobby-empty';

export interface RoulettePlayer {
  readonly id: string;
  readonly name: string;
}

export interface RouletteState {
  readonly schemaVersion: typeof ROULETTE_STATE_VERSION;
  readonly phase: RoulettePhase;
  readonly hostId: string;
  readonly players: readonly RoulettePlayer[];
  readonly chamberCount: number;
  /** Zero-based chamber holding the bullet; -1 until the round starts. */
  readonly bulletChamber: number;
  /** Trigger pulls so far; the next pull fires chamber `pullsMade`. */
  readonly pullsMade: number;
  /** Index into `players` of whoever must pull next. */
  readonly turnIndex: number;
  readonly loserId?: string;
  readonly endReason?: RouletteEndReason;
}

export interface RouletteTableRules {
  readonly chamberCount: number;
  readonly maxPlayers: number;
}

export const MIN_ROULETTE_PLAYERS = 2;

export type TriggerOutcome = 'click' | 'bang';

export interface TriggerResult {
  readonly state: RouletteState;
  readonly outcome: TriggerOutcome;
  readonly shooter: RoulettePlayer;
}

/** A rule violation the player should read, e.g. firing out of turn. */
export class RouletteRuleError extends Error {
  constructor(readonly code: RouletteRuleCode, readonly parameters: Readonly<Record<string, string | number>> = {}) {
    super(ruleMessages('zh-CN', code, parameters));
    this.name = 'RouletteRuleError';
  }

  format(locale?: Locale): string { return ruleMessages(locale, this.code, this.parameters); }
}

export function createLobby(host: RoulettePlayer, rules: RouletteTableRules): RouletteState {
  return {
    schemaVersion: ROULETTE_STATE_VERSION,
    phase: 'lobby',
    hostId: host.id,
    players: [host],
    chamberCount: rules.chamberCount,
    bulletChamber: -1,
    pullsMade: 0,
    turnIndex: 0,
  };
}

export function joinLobby(
  state: RouletteState,
  player: RoulettePlayer,
  rules: RouletteTableRules,
): RouletteState {
  requirePhase(state, 'lobby', 'cannotJoin');
  if (findPlayer(state, player.id)) {
    throw new RouletteRuleError('alreadyJoined');
  }
  if (state.players.length >= rules.maxPlayers) {
    throw new RouletteRuleError('full', { max: rules.maxPlayers });
  }
  return { ...state, players: [...state.players, player] };
}

export function startRound(
  state: RouletteState,
  actorId: string,
  bulletChamber: number,
): RouletteState {
  requirePhase(state, 'lobby', 'started');
  if (actorId !== state.hostId) {
    throw new RouletteRuleError('hostOnly');
  }
  if (state.players.length < MIN_ROULETTE_PLAYERS) {
    throw new RouletteRuleError('minimum', { min: MIN_ROULETTE_PLAYERS });
  }
  if (!Number.isInteger(bulletChamber) || bulletChamber < 0 || bulletChamber >= state.chamberCount) {
    throw new RangeError(`bulletChamber must be within 0..${state.chamberCount - 1}`);
  }
  return {
    ...state,
    phase: 'playing',
    bulletChamber,
    pullsMade: 0,
    turnIndex: 0,
  };
}

export function pullTrigger(state: RouletteState, actorId: string): TriggerResult {
  requirePhase(state, 'playing', 'notStarted');
  const shooter = currentPlayer(state);
  if (!shooter) throw new RouletteRuleError('noPlayer');
  if (shooter.id !== actorId) {
    throw new RouletteRuleError('notTurn', { name: shooter.name });
  }
  const firedChamber = state.pullsMade;
  const pullsMade = state.pullsMade + 1;
  if (firedChamber === state.bulletChamber) {
    const finished = finishWithLoser({ ...state, pullsMade }, shooter.id, 'shot');
    return { state: finished, outcome: 'bang', shooter };
  }
  const turnIndex = (state.turnIndex + 1) % state.players.length;
  return { state: { ...state, pullsMade, turnIndex }, outcome: 'click', shooter };
}

/**
 * Leaving the lobby just removes the player. Leaving a running round is a
 * forfeit: the leaver loses, so nobody can dodge the bullet by walking away.
 */
export function leaveGame(state: RouletteState, playerId: string): RouletteState {
  const leaver = findPlayer(state, playerId);
  if (!leaver) throw new RouletteRuleError('notJoined');
  if (state.phase === 'playing') {
    return finishWithLoser(state, playerId, 'forfeit');
  }
  requirePhase(state, 'lobby', 'ended');
  const players = state.players.filter((player) => player.id !== playerId);
  const nextHost = players[0];
  if (!nextHost) {
    return { ...state, players, phase: 'aborted', endReason: 'lobby-empty' };
  }
  const hostId = state.hostId === playerId ? nextHost.id : state.hostId;
  return { ...state, players, hostId };
}

/** The player on turn ran out of time: treated like a shot, they lose. */
export function expireTurn(state: RouletteState): RouletteState {
  requirePhase(state, 'playing', 'notStarted');
  const late = currentPlayer(state);
  if (!late) throw new RouletteRuleError('noPlayer');
  return finishWithLoser(state, late.id, 'turn-timeout');
}

export function expireLobby(state: RouletteState): RouletteState {
  requirePhase(state, 'lobby', 'started');
  return { ...state, phase: 'aborted', endReason: 'lobby-expired' };
}

export function cancelGame(state: RouletteState): RouletteState {
  if (!isOpen(state)) throw new RouletteRuleError('ended');
  return { ...state, phase: 'aborted', endReason: 'cancelled' };
}

export function isOpen(state: RouletteState): boolean {
  return state.phase === 'lobby' || state.phase === 'playing';
}

export function currentPlayer(state: RouletteState): RoulettePlayer | undefined {
  if (state.phase !== 'playing') return undefined;
  return state.players[state.turnIndex];
}

export function findPlayer(state: RouletteState, playerId: string): RoulettePlayer | undefined {
  return state.players.find((player) => player.id === playerId);
}

export function loserOf(state: RouletteState): RoulettePlayer | undefined {
  if (!state.loserId) return undefined;
  return findPlayer(state, state.loserId);
}

export function survivorsOf(state: RouletteState): readonly RoulettePlayer[] {
  return state.players.filter((player) => player.id !== state.loserId);
}

export function remainingChambers(state: RouletteState): number {
  return state.chamberCount - state.pullsMade;
}

export function decodeRouletteState(json: string): RouletteState {
  const parsed: unknown = JSON.parse(json);
  if (!isRouletteState(parsed)) {
    throw new TypeError('Stored roulette state is malformed');
  }
  return parsed;
}

function finishWithLoser(
  state: RouletteState,
  loserId: string,
  endReason: RouletteEndReason,
): RouletteState {
  return { ...state, phase: 'finished', loserId, endReason };
}

function requirePhase(state: RouletteState, phase: RoulettePhase, code: RouletteRuleCode): void {
  if (state.phase !== phase) throw new RouletteRuleError(code);
}

function isRouletteState(value: unknown): value is RouletteState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<RouletteState>;
  return state.schemaVersion === ROULETTE_STATE_VERSION
    && typeof state.phase === 'string'
    && typeof state.hostId === 'string'
    && Array.isArray(state.players)
    && typeof state.chamberCount === 'number'
    && typeof state.bulletChamber === 'number'
    && typeof state.pullsMade === 'number'
    && typeof state.turnIndex === 'number';
}

const ruleCatalog = {
  cannotJoin: { 'zh-CN': "对局已经开始，不能再加入了。", en: "The game has started; you can no longer join." },
  alreadyJoined: { 'zh-CN': "你已经在这局轮盘里了。", en: "You are already in this game." },
  full: { 'zh-CN': "人数已满（最多 {max} 人）。", en: "The table is full (maximum {max} players)." },
  started: { 'zh-CN': "对局已经开始了。", en: "The game has already started." },
  hostOnly: { 'zh-CN': "只有开局的人可以开始。", en: "Only the host may start the game." },
  minimum: { 'zh-CN': "至少需要 {min} 名玩家才能开始。", en: "At least {min} players are required." },
  notStarted: { 'zh-CN': "对局还没开始。", en: "The game has not started." },
  noPlayer: { 'zh-CN': "对局没有可以开枪的玩家。", en: "There is no player who can pull the trigger." },
  notTurn: { 'zh-CN': "还没轮到你，现在轮到 {name}。", en: "It is not your turn. {name} plays next." },
  notJoined: { 'zh-CN': "你不在这局轮盘里。", en: "You are not in this game." },
  ended: { 'zh-CN': "对局已经结束。", en: "The game has ended." },
} as const;
type RouletteRuleCode = keyof typeof ruleCatalog;
const ruleMessages = createMessages(ruleCatalog);
