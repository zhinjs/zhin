import { createMessages } from 'zhin.js/i18n';
import { buildChoiceKeyboard } from '@zhin.js/game-kit';
import type { SendContent } from '@zhin.js/core/runtime';
import type { ChainSessionRow } from './models.js';
import { CHAIN_PREFIX, getGloss, idiomCount, modeLabel, promptLine } from './engine.js';

const MAX_WRONG = 3;

function sessionMode(session: ChainSessionRow): 'char' | 'pinyin' {
  return session.match_mode === 'char' ? 'char' : 'pinyin';
}

export function buildChainView(
  session: ChainSessionRow,
  eventLines: string[] = [],
  channelType?: string,
): SendContent {
  const terminal = session.status !== 'active';
  const mode = sessionMode(session);
  const lines = [
    messages(session.locale ?? undefined, 'text1', { p0: modeLabel(mode, session.locale ?? undefined) }),
    '',
    messages(session.locale ?? undefined, 'text2', { p0: idiomCount(), p1: session.player_score, p2: session.bot_score, p3: session.streak, p4: session.best_streak }),
  ];

  if (session.last_idiom) {
    const gloss = getGloss(session.last_idiom);
    lines.push('', messages(session.locale ?? undefined, 'text3', { p0: session.last_idiom }) + (gloss ? `（${gloss}）` : ''));
    lines.push(promptLine(session.last_idiom, mode, session.locale ?? undefined));
  }

  if (session.wrong_count > 0 && session.status === 'active') {
    lines.push(messages(session.locale ?? undefined, 'text4', { p0: session.wrong_count, p1: MAX_WRONG }));
  }

  if (eventLines.length) {
    lines.push('', ...eventLines);
  }

  if (terminal) {
    lines.push('');
    if (session.status === 'won') lines.push(messages(session.locale ?? undefined, 'text5'));
    else if (session.status === 'lost') lines.push(messages(session.locale ?? undefined, 'text6'));
  } else {
    lines.push('', messages(session.locale ?? undefined, 'text7'));
  }

  const choices = terminal
    ? [{ id: 'restart', label: messages(session.locale ?? undefined, 'text8'), style: 'primary' as const, keepEnabledWhenTerminal: true }]
    : [
        { id: 'hint', label: messages(session.locale ?? undefined, 'text9'), style: 'secondary' as const },
        { id: 'skip', label: messages(session.locale ?? undefined, 'text10'), style: 'secondary' as const },
        { id: 'quit', label: messages(session.locale ?? undefined, 'text11'), style: 'danger' as const },
      ];

  return buildChoiceKeyboard({
    gamePrefix: CHAIN_PREFIX,
    sessionId: session.id,
    narrative: lines.join('\n'),
    choices,
    terminal,
    buttonsPerRow: 3,
    fallbackHint: messages(session.locale ?? undefined, 'text12'),
    interactionProfile: terminal ? 'terminal' : 'gameplay',
    channelType,
  });
}

export { MAX_WRONG };

const messages = createMessages({
  text1: { 'zh-CN': "📜 **成语接龙** · {p0}", en: "📜 **Chinese Idiom Chain** · {p0}" },
  text2: { 'zh-CN': "词库 **{p0}** 条 · 局分 {p1}:{p2} · 连击 **{p3}**（最佳 {p4}）", en: "Dictionary **{p0}** entries · Score {p1}:{p2} · Streak **{p3}** (best {p4})" },
  text3: { 'zh-CN': "上一句：**{p0}**", en: "Last idiom: **{p0}**" },
  text4: { 'zh-CN': "⚠️ 失误 {p0}/{p1}", en: "⚠️ Mistakes: {p0}/{p1}" },
  text5: { 'zh-CN': "🏆 **你赢了本局！** 机器人接不上啦。", en: "🏆 **You won!** The bot has no next idiom." },
  text6: { 'zh-CN': "💀 **机器人获胜。** 点击「再来一局」重新开始。", en: "💀 **The bot won.** Choose “Play again” to start again." },
  text7: { 'zh-CN': "直接回复四字成语，或点下方按钮：", en: "Reply with a four-character Chinese idiom, or choose an option:" },
  text8: { 'zh-CN': "🔄 再来一局", en: "🔄 Play again" },
  text9: { 'zh-CN': "💡 提示", en: "💡 Hint" },
  text10: { 'zh-CN': "⏭️ 跳过", en: "⏭️ Skip" },
  text11: { 'zh-CN': "🏳️ 认输", en: "🏳️ Concede" },
  text12: { 'zh-CN': "回复成语，或 1提示 2跳过 3认输", en: "Reply with an idiom, or 1 Hint · 2 Skip · 3 Concede" },
});
