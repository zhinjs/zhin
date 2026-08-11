import type { SendContent } from '@zhin.js/core/runtime';
import {
  buildChoiceKeyboard,
  type ChoiceOption,
} from '@zhin.js/game-kit';
import { activePlayer, type DungeonState } from './engine.js';
import type { DungeonSessionRow } from './models.js';

export const DUNGEON_PREFIX = 'dungeon';

export function dungeonSessionToken(session: DungeonSessionRow): string {
  return `${session.id}@${session.revision}`;
}

export function parseDungeonSessionToken(
  token: string,
): { sessionId: string; revision: number } | null {
  const match = /^(.+)@(\d+)$/.exec(token);
  if (!match?.[1] || match[2] === undefined) return null;
  return { sessionId: match[1], revision: Number(match[2]) };
}

export function choicesForState(state: Readonly<DungeonState>): ChoiceOption[] {
  if (state.phase === 'completed') {
    return [{
      id: 'restart',
      label: '再来一局',
      style: 'primary',
      keepEnabledWhenTerminal: true,
    }];
  }
  if (state.phase === 'lobby') {
    return [
      { id: 'join', label: '加入队伍', style: 'secondary' },
      { id: 'ready', label: '准备/取消', style: 'secondary' },
      { id: 'start', label: '开始远征', style: 'primary' },
      { id: 'abort', label: '解散队伍', style: 'danger' },
    ];
  }
  if (state.phase === 'combat') {
    return [
      { id: 'attack', label: '攻击', style: 'primary' },
      { id: 'defend', label: '防御', style: 'secondary' },
      { id: 'potion', label: '药水', style: 'secondary' },
      { id: 'abort', label: '结束远征', style: 'danger' },
    ];
  }
  return [
    { id: 'explore', label: '探索下一房间', style: 'primary' },
    { id: 'potion', label: '使用药水', style: 'secondary' },
    { id: 'abort', label: '结束远征', style: 'danger' },
  ];
}

export function buildDungeonView(
  session: DungeonSessionRow,
  state: Readonly<DungeonState>,
  channelType?: string,
): SendContent {
  const current = activePlayer(state);
  const lines = [
    `地牢远征 · 第 ${state.floor}/${3} 层 · 房间 ${state.room}/${4}`,
    `状态：${phaseLabel(state)}`,
    '',
    ...state.players.map((player, index) => {
      const turn = current?.id === player.id && state.phase !== 'lobby' ? ' <- 当前回合' : '';
      const ready = state.phase === 'lobby' ? player.ready ? ' [已准备]' : ' [未准备]' : '';
      return `${index + 1}. ${player.name}${ready} HP ${player.hp}/${player.maxHp}`
        + ` · 药水 ${player.potions} · 金币 ${player.gold}${turn}`;
    }),
  ];
  if (state.enemy) {
    lines.push(
      '',
      `${state.enemy.boss ? '守层者' : '敌人'}：${state.enemy.name}`,
      `HP ${state.enemy.hp}/${state.enemy.maxHp} · 攻击 ${state.enemy.attack}`,
    );
  }
  lines.push('', '最近事件：', ...state.log.slice(-4).map((line) => `- ${line}`));
  if (state.phase === 'completed') {
    lines.push(
      '',
      state.result === 'victory'
        ? '远征胜利，地牢已被征服。'
        : state.result === 'aborted'
          ? '本次远征由队长结束。'
          : '远征失败，队伍全员倒下。',
    );
  }

  const choices = choicesForState(state);
  return buildChoiceKeyboard({
    gamePrefix: DUNGEON_PREFIX,
    sessionId: dungeonSessionToken(session),
    narrative: lines.join('\n'),
    choices,
    terminal: state.phase === 'completed',
    buttonsPerRow: 2,
    fallbackHint: choices.map((choice, index) =>
      `${index + 1} ${choice.label}`).join(' · '),
    interactionProfile: state.phase === 'completed' ? 'terminal' : 'gameplay',
    channelType,
  });
}

function phaseLabel(state: Readonly<DungeonState>): string {
  if (state.phase === 'lobby') return '等待队员';
  if (state.phase === 'exploring') return '探索中';
  if (state.phase === 'combat') return '战斗中';
  if (state.result === 'victory') return '胜利';
  if (state.result === 'aborted') return '已结束';
  return '失败';
}
