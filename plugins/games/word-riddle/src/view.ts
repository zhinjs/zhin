import { createMessages } from 'zhin.js/i18n';
import { buildChoiceKeyboard } from '@zhin.js/game-kit';
import type { SendContent } from '@zhin.js/core/runtime';
import { getRiddleById, RIDDLE_PREFIX, typeLabel } from './engine.js';
import type { RiddleSessionRow } from './models.js';
import { currentRiddleId, parseQueue } from './session-service.js';

const MAX_WRONG = 3;

export function buildRiddleView(
  session: RiddleSessionRow,
  eventLines: string[] = [],
  channelType?: string,
): SendContent | string {
  const queue = parseQueue(session.queue);
  const terminal = session.status !== 'active';
  const riddleId = currentRiddleId(session);
  const entry = riddleId ? getRiddleById(riddleId) : undefined;

  const lines = [
    `🧩 **${typeLabel(session.mode as 'char' | 'idiom', session.locale ?? undefined)}**`,
    '',
    messages(session.locale ?? undefined, 'text1', { p0: Math.min(session.index + 1, queue.length), p1: queue.length, p2: session.score, p3: session.streak, p4: session.best_streak }),
  ];

  if (terminal) {
    lines.push('', messages(session.locale ?? undefined, 'text2'), messages(session.locale ?? undefined, 'text3', { p0: session.score }));
  } else if (entry) {
    lines.push('', `❓ ${entry.question}`);
    if (session.wrong_count > 0) {
      lines.push(messages(session.locale ?? undefined, 'text4', { p0: session.wrong_count, p1: MAX_WRONG }));
    }
    lines.push('', session.mode === 'char' ? messages(session.locale ?? undefined, 'text5') : messages(session.locale ?? undefined, 'text6'));
  }

  if (eventLines.length) lines.push('', ...eventLines);

  if (!entry && !terminal) return messages(session.locale ?? undefined, 'text7');

  const choices = terminal
    ? [
        { id: 'restart_char', label: messages(session.locale ?? undefined, 'text8'), style: 'primary' as const, keepEnabledWhenTerminal: true },
        { id: 'restart_idiom', label: messages(session.locale ?? undefined, 'text9'), style: 'primary' as const, keepEnabledWhenTerminal: true },
      ]
    : [
        { id: 'hint', label: messages(session.locale ?? undefined, 'text10'), style: 'secondary' as const },
        { id: 'skip', label: messages(session.locale ?? undefined, 'text11'), style: 'secondary' as const },
        { id: 'quit', label: messages(session.locale ?? undefined, 'text12'), style: 'danger' as const },
      ];

  return buildChoiceKeyboard({
    gamePrefix: RIDDLE_PREFIX,
    sessionId: session.id,
    narrative: lines.join('\n'),
    choices,
    terminal,
    buttonsPerRow: terminal ? 2 : 3,
    fallbackHint: messages(session.locale ?? undefined, 'text13'),
    interactionProfile: terminal ? 'terminal' : 'gameplay',
    channelType,
  });
}

export { MAX_WRONG };

const messages = createMessages({
  text1: { 'zh-CN': "进度 {p0}/{p1} · 得分 **{p2}** · 连击 **{p3}**（最佳 {p4}）", en: "Progress {p0}/{p1} · Score **{p2}** · Streak **{p3}** (best {p4})" },
  text2: { 'zh-CN': "🎊 **本轮题目已全部完成！**", en: "🎊 **All riddles completed!**" },
  text3: { 'zh-CN': "最终得分：**{p0}**", en: "Final score: **{p0}**" },
  text4: { 'zh-CN': "⚠️ 本题失误 {p0}/{p1}", en: "⚠️ Mistakes on this riddle: {p0}/{p1}" },
  text5: { 'zh-CN': "请回复一个汉字。", en: "Reply with one Chinese character." },
  text6: { 'zh-CN': "请回复四字成语。", en: "Reply with a four-character Chinese idiom." },
  text7: { 'zh-CN': "题目加载失败，请重新开始。", en: "The riddle could not be loaded. Please start again." },
  text8: { 'zh-CN': "🔤 再来字谜", en: "🔤 More character riddles" },
  text9: { 'zh-CN': "📜 再来成语", en: "📜 More idiom riddles" },
  text10: { 'zh-CN': "💡 提示", en: "💡 Hint" },
  text11: { 'zh-CN': "⏭️ 跳过", en: "⏭️ Skip" },
  text12: { 'zh-CN': "🏳️ 结束", en: "🏳️ End" },
  text13: { 'zh-CN': "回复答案，或 1提示 2跳过 3结束", en: "Reply with your answer, or 1 Hint · 2 Skip · 3 End" },
});
