import { createMessages, resolveLocale, type Locale } from 'zhin.js/i18n';
import { gameCommandHint, GameSessionConflictError, SessionRevisionConflictError, channelKey, type GameMessageLike } from '@zhin.js/game-kit';
import type { RouletteConfig } from './config.js';
import { RouletteRuleError, loserOf, type RouletteState } from './engine.js';
import type { RouletteSessionRow } from './models.js';
import type { MutePenaltyPort, PenaltyConversation } from './mute-penalty.js';
import { getRouletteHelp, type RouletteCommandAction } from './roulette-actions.js';
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
const MANAGER_ROLES: readonly string[] = ['master', 'trusted', 'owner', 'admin'];
function noGame(message: GameMessageLike): string { return messages(message.locale, 'noGame') + gameCommandHint(message, 'roulette', 'open'); }

export async function runRouletteAction(
  flow: RouletteFlow,
  actor: RouletteActor,
  action: RouletteCommandAction,
): Promise<string> {
  const message = actor.message;
  const locale = resolveLocale(message.locale);
  if (action === 'help') return getRouletteHelp(message);
  if (message.$channel.type === 'private') return messages(locale, 'text1');
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
  const locale = resolveLocale(session ? session.locale : message.locale);
  if (action === 'open') return openLobby(flow, actor, session);
  if (!session) return noGame(message);
  if (action === 'status') return describeStatus(stateOf(session), flow.config, { ...message, locale });
  if (action === 'cancel' && !mayCancel(session, message, actor.roles)) {
    return messages(locale, 'text2');
  }
  const gameAction = toGameAction(action, message);
  if (!gameAction) return noGame(message);
  try {
    const result = await flow.services.sessions.applyAction(
      session,
      message.$sender.id,
      gameAction,
      flow.config,
    );
    return describeResult(flow, gameAction, result, message);
  } catch (error) {
    if (error instanceof RouletteRuleError) return error.format(locale);
    if (error instanceof GameSessionConflictError) return error.format(locale);
    if (error instanceof SessionRevisionConflictError) return messages(locale, 'text3');
    throw error;
  }
}

async function openLobby(
  flow: RouletteFlow,
  actor: RouletteActor,
  session: RouletteSessionRow | null,
): Promise<string> {
  const locale = resolveLocale(session ? session.locale : actor.message.locale);
  if (session) {
    return messages(locale, 'text4', { p0: describeStatus(stateOf(session), flow.config, { ...actor.message, locale }) });
  }
  try {
    const created = await flow.services.sessions.createLobby(actor.message, actor.endpoint, flow.config);
    return describeLobby(stateOf(created), flow.config, { ...actor.message, locale });
  } catch (error) {
    if (error instanceof GameSessionConflictError) return error.format(locale);
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
  const locale = resolveLocale(result.session.locale);
  const presentation = { ...message, locale };
  if (!result.applied) return describeStatus(state, flow.config, presentation);
  if (state.phase === 'finished') return finishText(flow, result.session, state);
  if (state.phase === 'aborted') return describeAbort(state, presentation);
  if (action.type === 'start') return describeRoundStart(state, flow.config, presentation);
  if (action.type === 'fire') {
    return describeClick(playerFromMessage(message), state, flow.config, presentation);
  }
  if (action.type === 'leave') {
    return messages(locale, 'text5', { p0: playerFromMessage(message).name, p1: describeLobby(state, flow.config, presentation) });
  }
  return describeLobby(state, flow.config, presentation);
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
    return describeAbort(result.state, { locale: resolveLocale(result.session.locale) });
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
  return [describeEnding(state, { locale: resolveLocale(session.locale) }), penalty].filter(Boolean).join('\n');
}

/** Mute the loser only when this group opted in and the Endpoint declares muting. */
async function applyLoserPenalty(
  flow: RouletteFlow,
  session: RouletteSessionRow,
  state: RouletteState,
  penaltyEnabled?: boolean,
): Promise<string> {
  const locale = resolveLocale(session.locale);
  const loser = loserOf(state);
  if (!loser) return '';
  const enabled = penaltyEnabled
    ?? await flow.services.settings.isMutePenaltyEnabled(session.channel_key);
  if (!enabled) return '';
  const conversation = conversationOfSession(session);
  if (flow.penalty.support(conversation) !== 'supported') {
    return messages(locale, 'text6');
  }
  try {
    await flow.penalty.mute(conversation, loser.id, flow.config.muteSeconds);
    return messages(locale, 'text7', { p0: loser.name, p1: flow.config.muteSeconds });
  } catch {
    return messages(locale, 'text8');
  }
}

async function handlePenaltySetting(
  flow: RouletteFlow,
  actor: RouletteActor,
  action: 'penalty-on' | 'penalty-off' | 'penalty-status',
): Promise<string> {
  const message = actor.message;
  const locale = resolveLocale(message.locale);
  if (message.$channel.type !== 'group') return messages(locale, 'text9');
  const key = channelKey(message);
  const settings = flow.services.settings;
  const support = flow.penalty.support(conversationOfActor(actor));
  if (action === 'penalty-status') {
    const enabled = await settings.isMutePenaltyEnabled(key);
    return describePenaltyStatus(enabled, support === 'supported', flow.config, locale);
  }
  if (!isManager(actor.roles)) return messages(locale, 'text10');
  if (action === 'penalty-off') {
    await settings.setMutePenalty(key, false, message.$sender.id);
    return messages(locale, 'text11');
  }
  if (support !== 'supported') {
    return messages(locale, 'text12');
  }
  await settings.setMutePenalty(key, true, message.$sender.id);
  return messages(locale, 'text13', { p0: flow.config.muteSeconds });
}

function describePenaltyStatus(enabled: boolean, supported: boolean, config: RouletteConfig, locale?: Locale): string {
  const platform = supported ? messages(locale, 'text14') : messages(locale, 'text15');
  if (!enabled) return messages(locale, 'text16', { p0: platform });
  return messages(locale, 'text17', { p0: config.muteSeconds, p1: platform });
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

const messages = createMessages({
  noGame: { 'zh-CN': '本群没有进行中的轮盘。', en: 'This group has no active roulette game.' },
  text1: { 'zh-CN': "轮盘需要多人参与，请在群聊里玩。", en: "Roulette needs multiple players. Please play in a group chat." },
  text2: { 'zh-CN': "只有开局的人、群主、群管理员或机器人管理员可以取消本局。", en: "Only the host, group owner, group admin or bot administrator may cancel this game." },
  text3: { 'zh-CN': "对局状态刚刚变了，请再发一次。", en: "The game state just changed. Please try again." },
  text4: { 'zh-CN': "本群已经有一局轮盘了。\n{p0}", en: "This group already has a roulette game.\n{p0}" },
  text5: { 'zh-CN': "{p0} 离开了。\n{p1}", en: "{p0} left.\n{p1}" },
  text6: { 'zh-CN': "（本群开启了禁言惩罚，但当前平台无法禁言，本局只计分。）", en: "(Mute penalties are enabled, but this platform cannot mute players. Only scores were recorded.)" },
  text7: { 'zh-CN': "🔇 {p0} 被禁言 {p1} 秒。", en: "🔇 {p0} was muted for {p1} seconds." },
  text8: { 'zh-CN': "（禁言没有成功，可能是机器人没有群管理权限；本局只计分。）", en: "(Muting failed, possibly because the bot lacks group management permission. Only scores were recorded.)" },
  text9: { 'zh-CN': "禁言惩罚只能在群聊里设置。", en: "Mute penalties can only be configured in a group chat." },
  text10: { 'zh-CN': "只有群主、群管理员、机器人主人或受信任用户可以修改禁言惩罚。", en: "Only the group owner, group admin, bot owner or a trusted user may change mute penalties." },
  text11: { 'zh-CN': "已关闭禁言惩罚，本群轮盘只计分。", en: "Mute penalties are disabled. This group now records scores only." },
  text12: { 'zh-CN': "当前平台不支持禁言，禁言惩罚没有开启；本群轮盘只计分。", en: "This platform does not support muting. Mute penalties remain disabled; only scores are recorded." },
  text13: { 'zh-CN': "已开启禁言惩罚：每局输家会被禁言 {p0} 秒（需要机器人有群管理权限）。", en: "Mute penalties enabled: each loser is muted for {p0} seconds (the bot needs group management permission)." },
  text14: { 'zh-CN': "当前平台支持禁言。", en: "This platform supports muting." },
  text15: { 'zh-CN': "当前平台不支持禁言，只能计分。", en: "This platform does not support muting; only scores are recorded." },
  text16: { 'zh-CN': "本群禁言惩罚：关闭。{p0}", en: "Group mute penalty: off. {p0}" },
  text17: { 'zh-CN': "本群禁言惩罚：开启，输家禁言 {p0} 秒。{p1}", en: "Group mute penalty: on, the loser is muted for {p0} seconds. {p1}" },
});
