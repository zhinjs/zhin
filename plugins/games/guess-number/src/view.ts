import { createMessages } from 'zhin.js/i18n';
import { buildChoiceKeyboard } from '@zhin.js/game-kit';
import type { SendContent } from '@zhin.js/core/runtime';
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
    messages(session.locale ?? undefined, 'text1'),
    '',
    terminal
      ? messages(session.locale ?? undefined, 'text2', { p0: session.secret, p1: session.attempts })
      : messages(session.locale ?? undefined, 'text3', { p0: session.range_min, p1: session.range_max }),
  ];

  if (eventLines.length > 0) lines.push('', ...eventLines);

  if (terminal) {
    if (session.status === 'won') lines.push('', messages(session.locale ?? undefined, 'text4'));
    else if (session.status === 'lost') lines.push('', messages(session.locale ?? undefined, 'text5'));
    else lines.push('', messages(session.locale ?? undefined, 'text6'));
  } else {
    lines.push(
      messages(session.locale ?? undefined, 'text7', { p0: left, p1: session.attempts }),
      '',
      messages(session.locale ?? undefined, 'text8'),
    );
  }

  return buildChoiceKeyboard({
    gamePrefix: GUESS_PREFIX,
    sessionId: session.id,
    narrative: lines.join('\n'),
    choices: terminal
      ? [{
          id: 'restart',
          label: messages(session.locale ?? undefined, 'text9'),
          style: 'primary',
          keepEnabledWhenTerminal: true,
        }]
      : [{ id: 'quit', label: messages(session.locale ?? undefined, 'text10'), style: 'danger' }],
    terminal,
    interactionProfile: terminal ? 'terminal' : 'gameplay',
    channelType,
  });
}

const messages = createMessages({
  text1: { 'zh-CN': "🔢 **猜数字**", en: "🔢 **Guess the Number**" },
  text2: { 'zh-CN': "答案：**{p0}** · 共猜 {p1} 次", en: "Answer: **{p0}** · {p1} guesses" },
  text3: { 'zh-CN': "范围：**{p0} ~ {p1}**", en: "Range: **{p0} ~ {p1}**" },
  text4: { 'zh-CN': "🎉 **猜对了！**", en: "🎉 **Correct!**" },
  text5: { 'zh-CN': "💀 **机会用完了。**", en: "💀 **No guesses left.**" },
  text6: { 'zh-CN': "🏳️ 本局已结束。", en: "🏳️ This game has ended." },
  text7: { 'zh-CN': "机会：**{p0}** 次 · 已猜 {p1} 次", en: "Guesses remaining: **{p0}** · Used: {p1}" },
  text8: { 'zh-CN': "直接回复范围内的整数。", en: "Reply with an integer in the range." },
  text9: { 'zh-CN': "🔄 再来一局", en: "🔄 Play again" },
  text10: { 'zh-CN': "🏳️ 放弃", en: "🏳️ Quit" },
});
