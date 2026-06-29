import { buildChoiceKeyboard } from '@zhin.js/game-shared';
import type { SendContent } from 'zhin.js';
import type { RpsSessionRow } from './models.js';
import { MOVE_LABELS, RPS_PREFIX, WIN_TARGET, type RpsMove } from './engine.js';

export function buildRpsView(
  session: RpsSessionRow,
  lastRound?: { player: RpsMove; bot: RpsMove; result: 0 | 1 | 2 },
  channelType?: string,
): SendContent {
  const terminal = session.status !== 'active';
  const lines = [
    '✊✋✌️ **猜拳对决**',
    '',
    `比分 · 你 **${session.player_wins}** : **${session.bot_wins}** 机器人（先 ${WIN_TARGET} 胜）`,
  ];

  if (lastRound) {
    lines.push('');
    lines.push(`你出 ${MOVE_LABELS[lastRound.player]}，机器人出 ${MOVE_LABELS[lastRound.bot]}`);
    lines.push(
      lastRound.result === 0
        ? '🤝 平局！'
        : lastRound.result === 1
          ? '🎉 你赢了这一局！'
          : '😅 机器人赢了这一局。',
    );
  }

  if (terminal) {
    lines.push('');
    if (session.status === 'won') lines.push('🏆 **你赢得比赛！**');
    else if (session.status === 'lost') lines.push('💀 **机器人赢得比赛。**');
  } else if (!lastRound) {
    lines.push('', '出拳吧！');
  } else {
    lines.push('', '继续出拳：');
  }

  const choices = terminal
    ? [{ id: 'restart', label: '🔄 再来一局', style: 'primary' as const, keepEnabledWhenTerminal: true }]
    : (['rock', 'paper', 'scissors'] as RpsMove[]).map((m) => ({
        id: m,
        label: MOVE_LABELS[m],
        style: 'secondary' as const,
      }));

  return buildChoiceKeyboard({
    gamePrefix: RPS_PREFIX,
    sessionId: session.id,
    narrative: lines.join('\n'),
    choices,
    terminal,
    buttonsPerRow: 3,
    fallbackHint: '回复数字出拳（1石头 2布 3剪刀）',
    interactionProfile: terminal ? 'terminal' : 'gameplay',
    channelType,
  });
}
