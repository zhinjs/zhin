import { buildChoiceKeyboard } from '@zhin.js/game-shared';
import type { SendContent } from 'zhin.js';
import type { DiceSessionRow } from './models.js';
import { DICE_PREFIX, diceEmoji, WIN_TARGET } from './engine.js';

export function buildDiceView(
  session: DiceSessionRow,
  lastRound?: { player: number; bot: number; result: 0 | 1 | 2 },
): SendContent {
  const terminal = session.status !== 'active';
  const lines = [
    '🎲 **骰子对决**',
    '',
    `比分 · 你 **${session.player_wins}** : **${session.bot_wins}** 机器人（三局两胜）`,
  ];

  if (lastRound) {
    lines.push('');
    lines.push(`你 ${diceEmoji(lastRound.player)}(${lastRound.player})  vs  机器人 ${diceEmoji(lastRound.bot)}(${lastRound.bot})`);
    lines.push(
      lastRound.result === 0
        ? '🤝 平局，再来！'
        : lastRound.result === 1
          ? '🎉 你赢本局！'
          : '😅 机器人赢本局。',
    );
  }

  if (terminal) {
    lines.push('');
    if (session.status === 'won') lines.push('🏆 **你赢得比赛！**');
    else if (session.status === 'lost') lines.push('💀 **机器人赢得比赛。**');
  } else {
    lines.push('', lastRound ? '点击继续掷骰：' : '点击掷骰开始！');
  }

  const choices = terminal
    ? [{ id: 'restart', label: '🔄 再来一局', style: 'primary' as const }]
    : [{ id: 'roll', label: '🎲 掷骰', style: 'primary' as const }];

  return buildChoiceKeyboard({
    gamePrefix: DICE_PREFIX,
    sessionId: session.id,
    narrative: lines.join('\n'),
    choices,
    terminal,
    fallbackHint: '回复 1 掷骰',
  });
}
