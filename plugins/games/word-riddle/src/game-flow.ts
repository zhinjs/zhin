import { createMessages, resolveLocale } from 'zhin.js/i18n';
import { channelKey, type GamePlayer, type GameReply } from '@zhin.js/game-kit';
import {
  answersFor,
  checkAnswer,
  getRiddleById,
  normalizeAnswer,
  RIDDLE_PREFIX,
  typeLabel,
} from './engine.js';
import type { RiddleSessionRow } from './models.js';
import type { RiddleType } from './riddles-catalog.js';
import { riddleHint } from './riddle-provider.js';
import {
  currentRiddleId,
  parseQueue,
  type SessionService,
} from './session-service.js';
import { buildRiddleView, MAX_WRONG } from './view.js';

/**
 * Plugin Runtime: render the board as text. Interactive in-place board editing
 * (the old Adapter.editMessage path) is not part of the runtime flow; commands
 * and the text middleware return fresh text each turn.
 */
function renderView(
  message: GamePlayer,
  session: RiddleSessionRow,
  eventLines: string[] = [],
): GameReply {
  return buildRiddleView(session, eventLines, message.target.kind);
}

async function advanceQuestion(
  services: SessionService,
  session: RiddleSessionRow,
): Promise<RiddleSessionRow> {
  const queue = parseQueue(session.queue);
  const nextIndex = session.index + 1;
  if (nextIndex >= queue.length) {
    await services.updateSession(session.id, { index: nextIndex, status: 'completed', wrong_count: 0 });
  } else {
    await services.updateSession(session.id, { index: nextIndex, wrong_count: 0 });
  }
  return (await services.getById(session.id))!;
}

export async function startGame(
  services: SessionService,
  message: GamePlayer,
  mode: RiddleType,
): Promise<GameReply | undefined> {
  return services.runInScope({ scope: channelKey(message), run: async () => {
    const ch = channelKey(message);
    const active = await services.getActiveByChannel(ch);
    const locale = resolveLocale(active ? active.locale : message.locale);
    if (active) {
      if (active.player_id === message.sender.id) {
        return messages(locale, 'text1', { p0: typeLabel(active.mode as RiddleType, locale) });
      }
      return messages(locale, 'text2', { p0: active.player_name });
    }

    const session = await services.createSession(message, mode);
    return renderView(message, session);
  } });
}

export async function continueGame(
  services: SessionService,
  message: GamePlayer,
): Promise<GameReply> {
  return services.runInScope({ scope: channelKey(message), run: async () => {
    const session = await services.getActiveForUser(
      channelKey(message),
      message.sender.id,
    );
    const locale = resolveLocale(session ? session.locale : message.locale);
    if (!session) return messages(locale, 'text3');
    return renderView(message, session);
  } });
}

export async function processAnswerText(
  services: SessionService,
  message: GamePlayer,
  raw: string,
): Promise<GameReply | null> {
  return services.runInScope({ scope: channelKey(message), run: async () => {
    const ch = channelKey(message);
    const session = await services.getActiveForUser(ch, message.sender.id);
    const locale = resolveLocale(session ? session.locale : message.locale);
    if (!session || session.status !== 'active') return null;

    const riddleId = currentRiddleId(session);
    const entry = riddleId ? getRiddleById(riddleId) : undefined;
    if (!entry) return null;

    // 格式不合规（字数与答案不符）只提示、不扣失误：避免闲聊（「好的」「谢谢」）被累计判负
    const normalized = normalizeAnswer(raw);
    if (!answersFor(entry).some((a) => a.length === normalized.length)) {
      return messages(locale, 'text4', { p0: entry.answer.length });
    }

    if (checkAnswer(entry, raw)) {
      const streak = session.streak + 1;
      const best = Math.max(session.best_streak, streak);
      await services.updateSession(session.id, {
        score: session.score + 10 + Math.min(streak, 5),
        streak,
        best_streak: best,
        wrong_count: 0,
      });
      const after = await advanceQuestion(services, (await services.getById(session.id))!);
      const explain = entry.explanation ? `\n📖 ${entry.explanation}` : '';
      return renderView(message, after, [
        messages(locale, 'text5', { p0: entry.answer, p1: explain }),
        messages(locale, 'text6', { p0: 10 + Math.min(streak, 5) }),
      ]);
    }

    const wrong = session.wrong_count + 1;
    if (wrong >= MAX_WRONG) {
      await services.updateSession(session.id, { wrong_count: wrong, streak: 0 });
      const after = await advanceQuestion(services, (await services.getById(session.id))!);
      return renderView(message, after, [
        messages(locale, 'text7', { p0: entry.answer }),
        messages(locale, 'text8'),
      ]);
    }

    await services.updateSession(session.id, { wrong_count: wrong, streak: 0 });
    const updated = (await services.getById(session.id))!;
    return renderView(message, updated, [messages(locale, 'text9')]);
  } });
}

export async function handleChoice(
  services: SessionService,
  message: GamePlayer,
  sessionId: string,
  choiceId: string,
): Promise<GameReply | null> {
  return services.runInScope({ scope: channelKey(message), run: async () => {
    const session = await services.getById(sessionId);
    const locale = resolveLocale(session ? session.locale : message.locale);
    if (!session) return messages(locale, 'text10');
    if (session.player_id !== message.sender.id) return messages(locale, 'text11');

    if (choiceId === 'restart_char') {
      await services.updateSession(session.id, { status: 'aborted' });
      return (await startGame(services, message, 'char')) ?? null;
    }
    if (choiceId === 'restart_idiom') {
      await services.updateSession(session.id, { status: 'aborted' });
      return (await startGame(services, message, 'idiom')) ?? null;
    }

    if (session.status !== 'active') return messages(locale, 'text12');

    const riddleId = currentRiddleId(session);
    const entry = riddleId ? getRiddleById(riddleId) : undefined;
    if (!entry) return messages(locale, 'text13');

    if (choiceId === 'hint') {
      // #1250: the hint reveals real information and costs a few points instead of the streak.
      // Points cannot go below zero, so a round also has a hint budget: at score 0 hints would
      // otherwise be free and unlimited.
      if (session.hints_used >= HINTS_PER_ROUND) {
        return messages(locale, 'hintsExhausted', { p0: HINTS_PER_ROUND });
      }
      const revealed = riddleHint(entry);
      const hint = revealed.kind === 'first'
        ? messages(locale, 'hintFirst', { p0: revealed.char })
        : messages(locale, 'hintChoices', { p0: revealed.choices.join(messages(locale, 'separator')) });
      const penalty = Math.min(HINT_PENALTY, session.score);
      await services.updateSession(session.id, { hints_used: session.hints_used + 1, score: session.score - penalty });
      const updated = (await services.getById(session.id))!;
      return renderView(message, updated, [
        messages(locale, 'text15', { p0: hint }),
        ...(penalty > 0 ? [messages(locale, 'hintPenalty', { p0: penalty })] : []),
        messages(locale, 'hintsLeft', { p0: HINTS_PER_ROUND - updated.hints_used, p1: HINTS_PER_ROUND }),
      ]);
    }

    if (choiceId === 'skip') {
      await services.updateSession(session.id, { streak: 0 });
      const after = await advanceQuestion(services, session);
      return renderView(message, after, [
        messages(locale, 'text17', { p0: entry.answer }),
      ]);
    }

    if (choiceId === 'quit') return endRound(services, session);

    return messages(locale, 'text19');
  } });
}

/**
 * Ends the player's round (#1250): reveals the current answer and sums up the round. Callers hold
 * the channel scope already (the `quit` button and the `riddle quit` command).
 */
export async function endRound(services: SessionService, session: RiddleSessionRow): Promise<string> {
  const locale = resolveLocale(session.locale);
  await services.updateSession(session.id, { status: 'aborted' });
  const riddleId = currentRiddleId(session);
  const entry = riddleId ? getRiddleById(riddleId) : undefined;
  const total = parseQueue(session.queue).length;
  return [
    messages(locale, 'text18'),
    ...(entry && session.status === 'active' ? [messages(locale, 'quitAnswer', { p0: entry.answer })] : []),
    messages(locale, 'quitSummary', { p0: Math.min(session.index, total), p1: total, p2: session.score, p3: session.best_streak }),
  ].join('\n');
}

export { RIDDLE_PREFIX };

/** Points one hint costs (never below zero). */
const HINT_PENALTY = 3;
/** Hints per round, whatever the score (#1250): keeps hints scarce when there are no points to pay. */
export const HINTS_PER_ROUND = 3;

const messages = createMessages({
  hintFirst: { 'zh-CN': "第 1 个字是「{p0}」", en: "The first character is 「{p0}」" },
  hintChoices: { 'zh-CN': "答案是这几个字之一：{p0}", en: "The answer is one of: {p0}" },
  separator: { 'zh-CN': "、", en: ", " },
  hintsLeft: { 'zh-CN': "本局还可提示 {p0}/{p1} 次", en: "Hints left this round: {p0}/{p1}" },
  hintsExhausted: { 'zh-CN': "本局的 {p0} 次提示已经用完，直接作答或回复「跳过」。", en: "All {p0} hints of this round are used. Answer, or reply 跳过 (skip)." },
  hintPenalty: { 'zh-CN': "（使用提示 -{p0} 分）", en: "(Hint used: -{p0} points)" },
  quitAnswer: { 'zh-CN': "本题答案：**{p0}**", en: "Answer to this riddle: **{p0}**" },
  quitSummary: { 'zh-CN': "本局成绩：已答 {p0}/{p1} 题 · 得分 **{p2}** · 最佳连击 {p3}", en: "This round: {p0}/{p1} answered · Score **{p2}** · Best streak {p3}" },
  text1: { 'zh-CN': "你已有进行中的猜谜（{p0}），请使用当前对局的操作入口继续。", en: "You already have an active riddle game ({p0}). Continue using its controls." },
  text2: { 'zh-CN': "本频道 {p0} 正在猜谜。", en: "{p0} is solving riddles in this channel." },
  text3: { 'zh-CN': "你没有进行中的猜谜。", en: "You have no active riddle game." },
  text4: { 'zh-CN': "本题答案应为 {p0} 个字（这条不算失误）。", en: "The answer has {p0} characters (this does not count as a mistake)." },
  text5: { 'zh-CN': "✅ 正确！答案：**{p0}**{p1}", en: "✅ Correct! Answer: **{p0}**{p1}" },
  text6: { 'zh-CN': "+{p0} 分", en: "+{p0} points" },
  text7: { 'zh-CN': "❌ 本题答案：**{p0}**", en: "❌ Answer: **{p0}**" },
  text8: { 'zh-CN': "失误过多，自动下一题。", en: "Too many mistakes. Moving to the next riddle." },
  text9: { 'zh-CN': "❌ 不对，再想想！", en: "❌ Not quite. Try again!" },
  text10: { 'zh-CN': "会话不存在。", en: "This game no longer exists." },
  text11: { 'zh-CN': "这是别人的猜谜。", en: "This riddle game belongs to another player." },
  text12: { 'zh-CN': "本轮已结束。", en: "This round has ended." },
  text13: { 'zh-CN': "题目丢失。", en: "The riddle is unavailable." },
  text15: { 'zh-CN': "💡 提示：{p0}", en: "💡 Hint: {p0}" },
  text17: { 'zh-CN': "⏭️ 跳过，答案：**{p0}**", en: "⏭️ Skipped. Answer: **{p0}**" },
  text18: { 'zh-CN': "已结束猜谜。", en: "The riddle game has ended." },
  text19: { 'zh-CN': "未知操作。", en: "Unknown action." },
});
