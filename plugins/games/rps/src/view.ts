import { createMessages } from 'zhin.js/i18n';
import { buildChoiceKeyboard } from '@zhin.js/game-kit';
import type { SendContent } from '@zhin.js/core/runtime';
import type { RpsSessionRow } from './models.js';
import { moveLabel, RPS_PREFIX, WIN_TARGET, type RpsMove } from './engine.js';

export function buildRpsView(
  session: RpsSessionRow,
  lastRound?: { player: RpsMove; bot: RpsMove; result: 0 | 1 | 2 },
  channelType?: string,
): SendContent {
  const terminal = session.status !== 'active';
  const lines = [
    messages(session.locale ?? undefined, 'text1'),
    '',
    messages(session.locale ?? undefined, 'text2', { p0: session.player_wins, p1: session.bot_wins, p2: WIN_TARGET }),
  ];

  if (lastRound) {
    lines.push('');
    lines.push(messages(session.locale ?? undefined, 'text3', { p0: moveLabel(lastRound.player, session.locale), p1: moveLabel(lastRound.bot, session.locale) }));
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
  } else if (!lastRound) {
    lines.push('', messages(session.locale ?? undefined, 'text10'));
  } else {
    lines.push('', messages(session.locale ?? undefined, 'text11'));
  }

  const choices = terminal
    ? [{ id: 'restart', label: messages(session.locale ?? undefined, 'text12'), style: 'primary' as const, keepEnabledWhenTerminal: true }]
    : [
        ...(['rock', 'paper', 'scissors'] as RpsMove[]).map((m) => ({
          id: m,
          label: moveLabel(m, session.locale),
          style: 'secondary' as const,
        })),
        { id: 'quit', label: messages(session.locale ?? undefined, 'text13'), style: 'danger' as const },
      ];

  return buildChoiceKeyboard({
    gamePrefix: RPS_PREFIX,
    sessionId: session.id,
    narrative: lines.join('\n'),
    choices,
    terminal,
    buttonsPerRow: 3,
    fallbackHint: messages(session.locale ?? undefined, 'text14'),
    interactionProfile: terminal ? 'terminal' : 'gameplay',
    channelType,
  });
}

const messages = createMessages({
  text1: { 'zh-CN': "✊✋✌️ **猜拳对决**", en: "✊✋✌️ **Rock Paper Scissors**" },
  text2: { 'zh-CN': "比分 · 你 **{p0}** : **{p1}** 机器人（先 {p2} 胜）", en: "Score · You **{p0}** : **{p1}** Bot (first to {p2} wins)" },
  text3: { 'zh-CN': "你出 {p0}，机器人出 {p1}", en: "You played {p0}; the bot played {p1}" },
  text4: { 'zh-CN': "🤝 平局！", en: "🤝 Draw!" },
  text5: { 'zh-CN': "🎉 你赢了这一局！", en: "🎉 You won this round!" },
  text6: { 'zh-CN': "😅 机器人赢了这一局。", en: "😅 The bot won this round." },
  text7: { 'zh-CN': "🏆 **你赢得比赛！**", en: "🏆 **You won the match!**" },
  text8: { 'zh-CN': "💀 **机器人赢得比赛。**", en: "💀 **The bot won the match.**" },
  text9: { 'zh-CN': "🏳️ **本局已放弃。**", en: "🏳️ **You quit this match.**" },
  text10: { 'zh-CN': "出拳吧！", en: "Choose your move!" },
  text11: { 'zh-CN': "继续出拳：", en: "Choose your next move:" },
  text12: { 'zh-CN': "🔄 再来一局", en: "🔄 Play again" },
  text13: { 'zh-CN': "🏳️ 放弃", en: "🏳️ Quit" },
  text14: { 'zh-CN': "回复数字：1石头 2布 3剪刀 4放弃", en: "Reply with a number: 1 Rock · 2 Paper · 3 Scissors · 4 Quit" },
});
