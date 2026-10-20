import type { RouletteConfig } from './config.js';
import {
  MIN_ROULETTE_PLAYERS,
  currentPlayer,
  loserOf,
  remainingChambers,
  survivorsOf,
  type RoulettePlayer,
  type RouletteState,
} from './engine.js';

export const ROULETTE_TITLE = '🔫 俄罗斯轮盘';

export function describeLobby(state: RouletteState, config: RouletteConfig): string {
  const host = state.players.find((player) => player.id === state.hostId);
  const lines = [
    `${ROULETTE_TITLE} · 等待玩家（${state.players.length}/${config.maxPlayers}）`,
    `玩家：${listNames(state.players)}`,
    `发送「轮盘 加入」上桌；${host?.name ?? '房主'} 发送「轮盘 开始」开局（至少 ${MIN_ROULETTE_PLAYERS} 人）。`,
    `${config.lobbyTimeoutSeconds} 秒内没有开始会自动解散。`,
  ];
  return lines.join('\n');
}

export function describeRoundStart(state: RouletteState, config: RouletteConfig): string {
  const order = state.players.map((player, index) => `${index + 1}. ${player.name}`);
  const lines = [
    `${ROULETTE_TITLE} · 开局！${state.chamberCount} 个弹巢里装了 1 发子弹，已转好弹巢。`,
    '开枪顺序：',
    ...order,
    describeTurn(state, config),
  ];
  return lines.join('\n');
}

export function describeTurn(state: RouletteState, config: RouletteConfig): string {
  const shooter = currentPlayer(state);
  if (!shooter) return '';
  return `👉 轮到 ${shooter.name}：发送「开枪」，${config.turnTimeoutSeconds} 秒内不开枪判负。`
    + `（剩余 ${remainingChambers(state)} 个弹巢）`;
}

export function describeClick(shooter: RoulettePlayer, state: RouletteState, config: RouletteConfig): string {
  return [`咔哒……${shooter.name} 的这一枪是空膛。`, describeTurn(state, config)].join('\n');
}

export function describeEnding(state: RouletteState): string {
  const loser = loserOf(state);
  if (!loser) return describeAbort(state);
  const headline = endingHeadline(state, loser);
  const survivors = survivorsOf(state);
  return [
    headline,
    `🏆 幸存：${listNames(survivors)}（各 +1 胜）`,
    '发送「排行 轮盘」查看本群排行。',
  ].join('\n');
}

export function describeAbort(state: RouletteState): string {
  if (state.endReason === 'lobby-expired') return `${ROULETTE_TITLE} 长时间没有开始，已自动解散。`;
  if (state.endReason === 'lobby-empty') return `${ROULETTE_TITLE} 所有人都离开了，已解散。`;
  return `${ROULETTE_TITLE} 已取消，本局不计分。`;
}

export function describeStatus(state: RouletteState, config: RouletteConfig): string {
  if (state.phase === 'lobby') return describeLobby(state, config);
  const lines = [
    `${ROULETTE_TITLE} · 进行中，已开 ${state.pullsMade} 枪`,
    `玩家：${listNames(state.players)}`,
    describeTurn(state, config),
  ];
  return lines.join('\n');
}

function endingHeadline(state: RouletteState, loser: RoulettePlayer): string {
  if (state.endReason === 'turn-timeout') return `⌛ ${loser.name} 超时没有开枪，判负！`;
  if (state.endReason === 'forfeit') return `🏳️ ${loser.name} 中途离场，判负！`;
  return `💥 砰！${loser.name} 中弹出局（第 ${state.pullsMade} 枪）。`;
}

function listNames(players: readonly RoulettePlayer[]): string {
  if (players.length === 0) return '无';
  return players.map((player) => player.name).join('、');
}
