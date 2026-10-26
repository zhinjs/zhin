import { createMessages } from 'zhin.js/i18n';
import { buildChoiceKeyboard } from '@zhin.js/game-kit';
import type { SendContent } from '@zhin.js/core/runtime';
import type { DiceSessionRow } from './models.js';
import { DICE_PREFIX, diceEmoji, WIN_TARGET } from './engine.js';

export function buildDiceView(
  session: DiceSessionRow,
  lastRound?: { player: number; bot: number; result: 0 | 1 | 2 },
  channelType?: string,
): SendContent {
  const terminal = session.status !== 'active';
  const lines = [
    messages(session.locale ?? undefined, 'text1'),
    '',
    messages(session.locale ?? undefined, 'text2', { p0: session.player_wins, p1: session.bot_wins }),
  ];

  if (lastRound) {
    lines.push('');
    lines.push(messages(session.locale ?? undefined, 'text3', { p0: diceEmoji(lastRound.player), p1: lastRound.player, p2: diceEmoji(lastRound.bot), p3: lastRound.bot }));
    lines.push(
      lastRound.result === 0
        ? messages(session.locale ?? undefined, 'text4')
        : lastRound.result === 1
          ? messages(session.locale ?? undefined, 'text5')
          : messages(session.locale ?? undefined, 'text6'),
    );
  }

  if (terminal) {
    lines.push('');
    if (session.status === 'won') lines.push(messages(session.locale ?? undefined, 'text7'));
    else if (session.status === 'lost') lines.push(messages(session.locale ?? undefined, 'text8'));
    else lines.push(messages(session.locale ?? undefined, 'text9'));
  } else {
    lines.push('', lastRound ? messages(session.locale ?? undefined, 'text10') : messages(session.locale ?? undefined, 'text11'));
  }

  const choices = terminal
    ? [{ id: 'restart', label: messages(session.locale ?? undefined, 'text12'), style: 'primary' as const, keepEnabledWhenTerminal: true }]
    : [
        { id: 'roll', label: messages(session.locale ?? undefined, 'text13'), style: 'primary' as const },
        { id: 'quit', label: messages(session.locale ?? undefined, 'text14'), style: 'danger' as const },
      ];

  return buildChoiceKeyboard({
    gamePrefix: DICE_PREFIX,
    sessionId: session.id,
    narrative: lines.join('\n'),
    choices,
    terminal,
    fallbackHint: messages(session.locale ?? undefined, 'text15'),
    interactionProfile: terminal ? 'terminal' : 'gameplay',
    channelType,
  });
}

const messages = createMessages({
  text1: { 'zh-CN': "🎲 **骰子对决**", en: "🎲 **Dice Duel**" },
  text2: { 'zh-CN': "比分 · 你 **{p0}** : **{p1}** 机器人（三局两胜）", en: "Score · You **{p0}** : **{p1}** Bot (best of three)" },
  text3: { 'zh-CN': "你 {p0}({p1})  vs  机器人 {p2}({p3})", en: "You {p0}({p1}) vs Bot {p2}({p3})" },
  text4: { 'zh-CN': "🤝 平局，再来！", en: "🤝 Draw — roll again!" },
  text5: { 'zh-CN': "🎉 你赢本局！", en: "🎉 You won this round!" },
  text6: { 'zh-CN': "😅 机器人赢本局。", en: "😅 The bot won this round." },
  text7: { 'zh-CN': "🏆 **你赢得比赛！**", en: "🏆 **You won the match!**" },
  text8: { 'zh-CN': "💀 **机器人赢得比赛。**", en: "💀 **The bot won the match.**" },
  text9: { 'zh-CN': "🏳️ **本局已放弃。**", en: "🏳️ **You quit this match.**" },
  text10: { 'zh-CN': "点击继续掷骰：", en: "Roll again:" },
  text11: { 'zh-CN': "点击掷骰开始！", en: "Roll the dice to start!" },
  text12: { 'zh-CN': "🔄 再来一局", en: "🔄 Play again" },
  text13: { 'zh-CN': "🎲 掷骰", en: "🎲 Roll" },
  text14: { 'zh-CN': "🏳️ 放弃", en: "🏳️ Quit" },
  text15: { 'zh-CN': "回复 1 掷骰 · 2 放弃", en: "Reply 1 to roll · 2 to quit" },
});
