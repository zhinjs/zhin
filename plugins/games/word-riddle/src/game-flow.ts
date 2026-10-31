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
      const hint = entry.hint ?? messages(locale, 'text14', { p0: entry.answer.length });
      await services.updateSession(session.id, { hints_used: session.hints_used + 1, streak: 0 });
      const updated = (await services.getById(session.id))!;
      return renderView(message, updated, [
        messages(locale, 'text15', { p0: hint }),
        messages(locale, 'text16'),
      ]);
    }

    if (choiceId === 'skip') {
      await services.updateSession(session.id, { streak: 0 });
      const after = await advanceQuestion(services, session);
      return renderView(message, after, [
        messages(locale, 'text17', { p0: entry.answer }),
      ]);
    }

    if (choiceId === 'quit') {
      await services.updateSession(session.id, { status: 'aborted' });
      return messages(locale, 'text18');
    }

    return messages(locale, 'text19');
  } });
}

export { RIDDLE_PREFIX };

const messages = createMessages({
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
  text14: { 'zh-CN': "答案共 {p0} 个字", en: "The answer has {p0} characters" },
  text15: { 'zh-CN': "💡 提示：{p0}", en: "💡 Hint: {p0}" },
  text16: { 'zh-CN': "（连击清零）", en: "(Streak reset)" },
  text17: { 'zh-CN': "⏭️ 跳过，答案：**{p0}**", en: "⏭️ Skipped. Answer: **{p0}**" },
  text18: { 'zh-CN': "已结束猜谜。", en: "The riddle game has ended." },
  text19: { 'zh-CN': "未知操作。", en: "Unknown action." },
});
