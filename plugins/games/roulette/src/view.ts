import { createMessages } from 'zhin.js/i18n';
import type { GamePlayer } from '@zhin.js/game-kit';
import type { RouletteConfig } from './config.js';
import { MIN_ROULETTE_PLAYERS, currentPlayer, loserOf, remainingChambers, survivorsOf,
  type RoulettePlayer, type RouletteState } from './engine.js';

type Presentation = Pick<GamePlayer, 'locale' | 'formatCommand'>;
const messages = createMessages({
  title: { 'zh-CN': '🔫 俄罗斯轮盘', en: '🔫 Russian Roulette' },
  lobby: { 'zh-CN': '{title} · 等待玩家（{count}/{max}）', en: '{title} · Waiting for players ({count}/{max})' },
  players: { 'zh-CN': '玩家：{players}', en: 'Players: {players}' },
  host: { 'zh-CN': '房主', en: 'Host' },
  joinStart: { 'zh-CN': '发送「{join}」上桌；{host} 发送「{start}」开局（至少 {min} 人）。', en: 'Send “{join}” to join. {host}: send “{start}” to start (at least {min} players).' },
  lobbyExpiry: { 'zh-CN': '{seconds} 秒内没有开始会自动解散。', en: 'The lobby closes if the game does not start within {seconds} seconds.' },
  started: { 'zh-CN': '{title} · 开局！{chambers} 个弹巢里装了 1 发子弹，已转好弹巢。', en: '{title} · Started! One bullet in {chambers} chambers. The cylinder has been spun.' },
  order: { 'zh-CN': '开枪顺序：', en: 'Turn order:' },
  turn: { 'zh-CN': '👉 轮到 {name}：{instruction}{seconds} 秒内不开枪判负。（剩余 {chambers} 个弹巢）', en: '👉 {name} to play: {instruction}pull the trigger within {seconds} seconds or lose. ({chambers} chambers remaining)' },
  fire: { 'zh-CN': '发送「{command}」，', en: 'send “{command}”; ' },
  click: { 'zh-CN': '咔哒……{name} 的这一枪是空膛。', en: 'Click… {name} found an empty chamber.' },
  survived: { 'zh-CN': '🏆 幸存：{names}（各 +1 胜）', en: '🏆 Survivors: {names} (+1 win each)' },
  leaderboard: { 'zh-CN': '可在游戏大厅查看本群排行。', en: 'The group leaderboard is available in the game lobby.' },
  expired: { 'zh-CN': '{title} 长时间没有开始，已自动解散。', en: '{title}: the lobby expired before the game started.' },
  empty: { 'zh-CN': '{title} 所有人都离开了，已解散。', en: '{title}: everyone left; the lobby is closed.' },
  aborted: { 'zh-CN': '{title} 已取消，本局不计分。', en: '{title}: cancelled. No scores were recorded.' },
  status: { 'zh-CN': '{title} · 进行中，已开 {pulls} 枪', en: '{title} · In progress, {pulls} trigger pulls' },
  timeout: { 'zh-CN': '⌛ {name} 超时没有开枪，判负！', en: '⌛ {name} ran out of time and loses!' },
  forfeit: { 'zh-CN': '🏳️ {name} 中途离场，判负！', en: '🏳️ {name} left the game and forfeits!' },
  shot: { 'zh-CN': '💥 砰！{name} 中弹出局（第 {pulls} 枪）。', en: '💥 Bang! {name} is out (trigger pull {pulls}).' },
  none: { 'zh-CN': '无', en: 'None' },
});
export const ROULETTE_TITLE = messages('zh-CN', 'title');

export function describeLobby(state: RouletteState, config: RouletteConfig, presentation: Presentation = {}): string {
  const locale = presentation.locale;
  const host = state.players.find(player => player.id === state.hostId);
  const command = presentation.formatCommand?.('roulette');
  return [messages(locale, 'lobby', { title: messages(locale, 'title'), count: state.players.length, max: config.maxPlayers }),
    messages(locale, 'players', { players: listNames(state.players, presentation) }),
    ...(command === undefined ? [] : [messages(locale, 'joinStart', { join: `${command} join`, start: `${command} start`, host: host?.name ?? messages(locale, 'host'), min: MIN_ROULETTE_PLAYERS })]),
    messages(locale, 'lobbyExpiry', { seconds: config.lobbyTimeoutSeconds }),
  ].join('\n');
}

export function describeRoundStart(state: RouletteState, config: RouletteConfig, presentation: Presentation = {}): string {
  return [messages(presentation.locale, 'started', { title: messages(presentation.locale, 'title'), chambers: state.chamberCount }),
    messages(presentation.locale, 'order'), ...state.players.map((player, index) => `${index + 1}. ${player.name}`),
    describeTurn(state, config, presentation),
  ].join('\n');
}

export function describeTurn(state: RouletteState, config: RouletteConfig, presentation: Presentation = {}): string {
  const shooter = currentPlayer(state);
  if (!shooter) return '';
  const command = presentation.formatCommand?.('roulette');
  return messages(presentation.locale, 'turn', { name: shooter.name, seconds: config.turnTimeoutSeconds,
    chambers: remainingChambers(state), instruction: command === undefined ? ''
      : messages(presentation.locale, 'fire', { command: `${command} fire` }) });
}

export function describeClick(shooter: RoulettePlayer, state: RouletteState, config: RouletteConfig, presentation: Presentation = {}): string {
  return [messages(presentation.locale, 'click', { name: shooter.name }), describeTurn(state, config, presentation)].join('\n');
}

export function describeEnding(state: RouletteState, presentation: Presentation = {}): string {
  const loser = loserOf(state);
  if (!loser) return describeAbort(state, presentation);
  const key = state.endReason === 'turn-timeout' ? 'timeout' : state.endReason === 'forfeit' ? 'forfeit' : 'shot';
  return [messages(presentation.locale, key, { name: loser.name, pulls: state.pullsMade }),
    messages(presentation.locale, 'survived', { names: listNames(survivorsOf(state), presentation) }),
    messages(presentation.locale, 'leaderboard'),
  ].join('\n');
}

export function describeAbort(state: RouletteState, presentation: Presentation = {}): string {
  return messages(presentation.locale, state.endReason === 'lobby-expired' ? 'expired' : state.endReason === 'lobby-empty' ? 'empty' : 'aborted',
    { title: messages(presentation.locale, 'title') });
}

export function describeStatus(state: RouletteState, config: RouletteConfig, presentation: Presentation = {}): string {
  if (state.phase === 'lobby') return describeLobby(state, config, presentation);
  return [messages(presentation.locale, 'status', { title: messages(presentation.locale, 'title'), pulls: state.pullsMade }),
    messages(presentation.locale, 'players', { players: listNames(state.players, presentation) }),
    describeTurn(state, config, presentation),
  ].join('\n');
}

function listNames(players: readonly RoulettePlayer[], presentation: Presentation): string {
  return players.length ? players.map(player => player.name).join(presentation.locale === 'en' ? ', ' : '、') : messages(presentation.locale, 'none');
}
