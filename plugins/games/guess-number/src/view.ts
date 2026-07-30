import { buildChoiceKeyboard } from '@zhin.js/game-kit';
import type { SendContent } from '@zhin.js/core';
import type { GuessSessionRow } from './models.js';

export const GUESS_PREFIX = 'guess';

export function buildGuessView(
  session: GuessSessionRow,
  eventLines: readonly string[] = [],
  channelType?: string,
): SendContent {
  const terminal = session.status !== 'active';
  const left = Math.max(0, session.max_attempts - session.attempts);
  const lines = [
    '🔢 **猜数字**',
    '',
    terminal
      ? `答案：**${session.secret}** · 共猜 ${session.attempts} 次`
      : `范围：**${session.range_min} ~ ${session.range_max}**`,
  ];

  if (eventLines.length > 0) lines.push('', ...eventLines);

  if (terminal) {
    if (session.status === 'won') lines.push('', '🎉 **猜对了！**');
    else if (session.status === 'lost') lines.push('', '💀 **机会用完了。**');
    else lines.push('', '🏳️ 本局已结束。');
  } else {
    lines.push(
      `机会：**${left}** 次 · 已猜 ${session.attempts} 次`,
      '',
      '直接回复范围内的整数。',
    );
  }

  return buildChoiceKeyboard({
    gamePrefix: GUESS_PREFIX,
    sessionId: session.id,
    narrative: lines.join('\n'),
    choices: terminal
      ? [{
          id: 'restart',
          label: '🔄 再来一局',
          style: 'primary',
          keepEnabledWhenTerminal: true,
        }]
      : [{ id: 'quit', label: '🏳️ 放弃', style: 'danger' }],
    terminal,
    interactionProfile: terminal ? 'terminal' : 'gameplay',
    channelType,
  });
}
