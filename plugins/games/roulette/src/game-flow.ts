import {
  GameSessionConflictError,
  SessionRevisionConflictError,
  channelKey,
  type GameMessageLike,
} from '@zhin.js/game-kit';
import type { RouletteConfig } from './config.js';
import { RouletteRuleError, loserOf, type RouletteState } from './engine.js';
import type { RouletteSessionRow } from './models.js';
import type { MutePenaltyPort, PenaltyConversation } from './mute-penalty.js';
import { ROULETTE_HELP, type RouletteCommandAction } from './roulette-actions.js';
import {
  playerFromMessage,
  stateOf,
  type RouletteAction,
  type RouletteActionResult,
  type EndpointIdentity,
  type RouletteServices,
} from './session-service.js';
import {
  describeAbort,
  describeClick,
  describeEnding,
  describeLobby,
  describeRoundStart,
  describeStatus,
} from './view.js';

/** Everything one action needs, resolved from the current runtime generation. */
export interface RouletteFlow {
  readonly services: RouletteServices;
  readonly config: RouletteConfig;
  readonly penalty: MutePenaltyPort;
}

/** Who sent the action, from the runtime message. */
export interface RouletteActor {
  readonly message: GameMessageLike;
  readonly endpoint: EndpointIdentity;
  readonly roles: readonly string[];
}

export interface ExpiredSessionNotice {
  readonly session: RouletteSessionRow;
  readonly text: string;
}

const DEADLINE_ACTOR = 'deadline';
const MANAGER_ROLES: readonly string[] = ['master', 'trusted'];
const NO_GAME_TEXT = '本群没有进行中的轮盘，发送「轮盘 开局」创建一局。';

export async function runRouletteAction(
  flow: RouletteFlow,
  actor: RouletteActor,
  action: RouletteCommandAction,
): Promise<string> {
  const message = actor.message;
  if (action === 'help') return ROULETTE_HELP;
  if (message.$channel.type === 'private') return '轮盘需要多人参与，请在群聊里玩。';
  if (action === 'penalty-on' || action === 'penalty-off' || action === 'penalty-status') {
    return handlePenaltySetting(flow, actor, action);
  }

  const notices: string[] = [];
  let session = await flow.services.sessions.getActiveByChannel(channelKey(message));
  if (session && isOverdue(session, Date.now())) {
    const expired = await expireSession(flow, session);
    if (expired) notices.push(expired);
    session = null;
  }
  const reply = await handleGameAction(flow, actor, action, session);
  return [...notices, reply].join('\n\n');
}

/** Called by the deadline schedule; each returned notice still has to be delivered. */
export async function expireOverdueSessions(
  flow: RouletteFlow,
  now: number,
  onNotice?: (notice: ExpiredSessionNotice) => Promise<void> | void,
): Promise<readonly ExpiredSessionNotice[]> {
  const overdue = await flow.services.sessions.listOverdue(now);
  const notices: ExpiredSessionNotice[] = [];
  for (const session of overdue) {
    try {
      const text = await expireSession(flow, session);
      if (!text) continue;
      const notice = { session, text };
      notices.push(notice);
      // Announce as soon as the result is stored, so a later failure cannot drop it.
      if (onNotice) await onNotice(notice);
    } catch (error) {
      // The session stays active when anything before the commit failed; the next sweep retries it.
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[roulette] 处理超时对局 ${session.id} 失败，下次扫描重试：${reason}`);
    }
  }
  return notices;
}

async function handleGameAction(
  flow: RouletteFlow,
  actor: RouletteActor,
  action: RouletteCommandAction,
  session: RouletteSessionRow | null,
): Promise<string> {
  const message = actor.message;
  if (action === 'open') return openLobby(flow, actor, session);
  if (!session) return NO_GAME_TEXT;
  if (action === 'status') return describeStatus(stateOf(session), flow.config);
  if (action === 'cancel' && !mayCancel(session, message, actor.roles)) {
    return '只有开局的人或机器人管理员可以取消本局。';
  }
  const gameAction = toGameAction(action, message);
  if (!gameAction) return NO_GAME_TEXT;
  try {
    const result = await flow.services.sessions.applyAction(
      session,
      message.$sender.id,
      gameAction,
      flow.config,
    );
    return describeResult(flow, gameAction, result, message);
  } catch (error) {
    if (error instanceof RouletteRuleError) return error.message;
    if (error instanceof GameSessionConflictError) return error.message;
    if (error instanceof SessionRevisionConflictError) return '对局状态刚刚变了，请再发一次。';
    throw error;
  }
}

async function openLobby(
  flow: RouletteFlow,
  actor: RouletteActor,
  session: RouletteSessionRow | null,
): Promise<string> {
  if (session) {
    return `本群已经有一局轮盘了。\n${describeStatus(stateOf(session), flow.config)}`;
  }
  try {
    const created = await flow.services.sessions.createLobby(actor.message, actor.endpoint, flow.config);
    return describeLobby(stateOf(created), flow.config);
  } catch (error) {
    if (error instanceof GameSessionConflictError) return error.message;
    throw error;
  }
}

async function describeResult(
  flow: RouletteFlow,
  action: RouletteAction,
  result: RouletteActionResult,
  message: GameMessageLike,
): Promise<string> {
  const state = result.state;
  if (!result.applied) return describeStatus(state, flow.config);
  if (state.phase === 'finished') return finishText(flow, result.session, state);
  if (state.phase === 'aborted') return describeAbort(state);
  if (action.type === 'start') return describeRoundStart(state, flow.config);
  if (action.type === 'fire') {
    return describeClick(playerFromMessage(message), state, flow.config);
  }
  if (action.type === 'leave') {
    return `${playerFromMessage(message).name} 离开了。\n${describeLobby(state, flow.config)}`;
  }
  return describeLobby(state, flow.config);
}

async function expireSession(flow: RouletteFlow, session: RouletteSessionRow): Promise<string> {
  // Read everything that can fail before the state transition is committed: once the
  // session is stored as finished it is no longer overdue and would never be retried.
  const penaltyEnabled = stateOf(session).phase === 'playing'
    ? await flow.services.settings.isMutePenaltyEnabled(session.channel_key)
    : false;
  try {
    const result = await flow.services.sessions.applyAction(
      session,
      DEADLINE_ACTOR,
      { type: 'expire' },
      flow.config,
    );
    if (!result.applied) return '';
    if (result.state.phase === 'finished') return finishText(flow, result.session, result.state, penaltyEnabled);
    return describeAbort(result.state);
  } catch (error) {
    // A player acted on the session in the meantime; the next sweep re-reads it.
    if (error instanceof SessionRevisionConflictError) return '';
    throw error;
  }
}

async function finishText(
  flow: RouletteFlow,
  session: RouletteSessionRow,
  state: RouletteState,
  penaltyEnabled?: boolean,
): Promise<string> {
  const penalty = await applyLoserPenalty(flow, session, state, penaltyEnabled);
  return [describeEnding(state), penalty].filter(Boolean).join('\n');
}

/** Mute the loser only when this group opted in and the Endpoint declares muting. */
async function applyLoserPenalty(
  flow: RouletteFlow,
  session: RouletteSessionRow,
  state: RouletteState,
  penaltyEnabled?: boolean,
): Promise<string> {
  const loser = loserOf(state);
  if (!loser) return '';
  const enabled = penaltyEnabled
    ?? await flow.services.settings.isMutePenaltyEnabled(session.channel_key);
  if (!enabled) return '';
  const conversation = conversationOfSession(session);
  if (flow.penalty.support(conversation) !== 'supported') {
    return '（本群开启了禁言惩罚，但当前平台无法禁言，本局只计分。）';
  }
  try {
    await flow.penalty.mute(conversation, loser.id, flow.config.muteSeconds);
    return `🔇 ${loser.name} 被禁言 ${flow.config.muteSeconds} 秒。`;
  } catch {
    return '（禁言没有成功，可能是机器人没有群管理权限；本局只计分。）';
  }
}

async function handlePenaltySetting(
  flow: RouletteFlow,
  actor: RouletteActor,
  action: 'penalty-on' | 'penalty-off' | 'penalty-status',
): Promise<string> {
  const message = actor.message;
  if (message.$channel.type !== 'group') return '禁言惩罚只能在群聊里设置。';
  const key = channelKey(message);
  const settings = flow.services.settings;
  const support = flow.penalty.support(conversationOfActor(actor));
  if (action === 'penalty-status') {
    const enabled = await settings.isMutePenaltyEnabled(key);
    return describePenaltyStatus(enabled, support === 'supported', flow.config);
  }
  if (!isManager(actor.roles)) return '只有机器人主人或受信任用户可以修改禁言惩罚。';
  if (action === 'penalty-off') {
    await settings.setMutePenalty(key, false, message.$sender.id);
    return '已关闭禁言惩罚，本群轮盘只计分。';
  }
  if (support !== 'supported') {
    return '当前平台不支持禁言，禁言惩罚没有开启；本群轮盘只计分。';
  }
  await settings.setMutePenalty(key, true, message.$sender.id);
  return `已开启禁言惩罚：每局输家会被禁言 ${flow.config.muteSeconds} 秒（需要机器人有群管理权限）。`;
}

function describePenaltyStatus(enabled: boolean, supported: boolean, config: RouletteConfig): string {
  const platform = supported ? '当前平台支持禁言。' : '当前平台不支持禁言，只能计分。';
  if (!enabled) return `本群禁言惩罚：关闭。${platform}`;
  return `本群禁言惩罚：开启，输家禁言 ${config.muteSeconds} 秒。${platform}`;
}

function toGameAction(action: RouletteCommandAction, message: GameMessageLike): RouletteAction | null {
  if (action === 'join') return { type: 'join', player: playerFromMessage(message) };
  if (action === 'start') return { type: 'start' };
  if (action === 'fire') return { type: 'fire' };
  if (action === 'leave') return { type: 'leave' };
  if (action === 'cancel') return { type: 'cancel' };
  return null;
}

function mayCancel(
  session: RouletteSessionRow,
  message: GameMessageLike,
  senderRoles: readonly string[],
): boolean {
  if (stateOf(session).hostId === message.$sender.id) return true;
  return isManager(senderRoles);
}

function isManager(senderRoles: readonly string[]): boolean {
  return senderRoles.some((role) => MANAGER_ROLES.includes(role));
}

function isOverdue(session: RouletteSessionRow, now: number): boolean {
  return session.deadline_at > 0 && session.deadline_at <= now;
}

export function conversationOfSession(session: RouletteSessionRow): PenaltyConversation {
  return {
    endpointAdapter: session.endpoint_adapter,
    endpointId: session.endpoint_id,
    kind: session.channel_type,
    id: session.channel_id,
  };
}

function conversationOfActor(actor: RouletteActor): PenaltyConversation {
  return {
    endpointAdapter: actor.endpoint.adapter,
    endpointId: actor.endpoint.id,
    kind: actor.message.$channel.type,
    id: actor.message.$channel.id,
  };
}
