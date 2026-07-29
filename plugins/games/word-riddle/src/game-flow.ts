import { plainTextFromSendContent, type GameMessageLike } from '@zhin.js/game-kit';
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
  message: GameMessageLike,
  session: RiddleSessionRow,
  eventLines: string[] = [],
): string {
  const content = buildRiddleView(session, eventLines, message.$channel.type);
  return typeof content === 'string' ? content : plainTextFromSendContent(content);
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
  message: GameMessageLike,
  mode: RiddleType,
): Promise<string | undefined> {
  const ch = `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`;
  const active = await services.getActiveByChannel(ch);
  if (active) {
    if (active.player_id === message.$sender.id) {
      return `你已有进行中的猜谜（${typeLabel(active.mode as RiddleType)}），发送「猜谜 继续」刷新。`;
    }
    return `本频道 ${active.player_name} 正在猜谜。`;
  }

  const session = await services.createSession(message, mode);
  return renderView(message, session);
}

export async function continueGame(
  services: SessionService,
  message: GameMessageLike,
): Promise<string> {
  const session = await services.getActiveForUser(
    `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`,
    message.$sender.id,
  );
  if (!session) return '你没有进行中的猜谜，发送「猜谜 开始」。';
  return renderView(message, session);
}

export async function processAnswerText(
  services: SessionService,
  message: GameMessageLike,
  raw: string,
): Promise<string | null> {
  const ch = `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`;
  const session = await services.getActiveForUser(ch, message.$sender.id);
  if (!session || session.status !== 'active') return null;

  const riddleId = currentRiddleId(session);
  const entry = riddleId ? getRiddleById(riddleId) : undefined;
  if (!entry) return null;

  // 格式不合规（字数与答案不符）只提示、不扣失误：避免闲聊（「好的」「谢谢」）被累计判负
  const normalized = normalizeAnswer(raw);
  if (!answersFor(entry).some((a) => a.length === normalized.length)) {
    return `本题答案应为 ${entry.answer.length} 个字（这条不算失误）。`;
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
      `✅ 正确！答案：**${entry.answer}**${explain}`,
      `+${10 + Math.min(streak, 5)} 分`,
    ]);
  }

  const wrong = session.wrong_count + 1;
  if (wrong >= MAX_WRONG) {
    await services.updateSession(session.id, { wrong_count: wrong, streak: 0 });
    const after = await advanceQuestion(services, (await services.getById(session.id))!);
    return renderView(message, after, [
      `❌ 本题答案：**${entry.answer}**`,
      '失误过多，自动下一题。',
    ]);
  }

  await services.updateSession(session.id, { wrong_count: wrong, streak: 0 });
  const updated = (await services.getById(session.id))!;
  return renderView(message, updated, ['❌ 不对，再想想！']);
}

export async function handleChoice(
  services: SessionService,
  message: GameMessageLike,
  sessionId: string,
  choiceId: string,
): Promise<string | null> {
  const session = await services.getById(sessionId);
  if (!session) return '会话不存在。';
  if (session.player_id !== message.$sender.id) return '这是别人的猜谜。';

  if (choiceId === 'restart_char') {
    await services.updateSession(session.id, { status: 'aborted' });
    return (await startGame(services, message, 'char')) ?? null;
  }
  if (choiceId === 'restart_idiom') {
    await services.updateSession(session.id, { status: 'aborted' });
    return (await startGame(services, message, 'idiom')) ?? null;
  }

  if (session.status !== 'active') return '本轮已结束。';

  const riddleId = currentRiddleId(session);
  const entry = riddleId ? getRiddleById(riddleId) : undefined;
  if (!entry) return '题目丢失。';

  if (choiceId === 'hint') {
    const hint = entry.hint ?? `答案共 ${entry.answer.length} 个字`;
    await services.updateSession(session.id, { hints_used: session.hints_used + 1, streak: 0 });
    const updated = (await services.getById(session.id))!;
    return renderView(message, updated, [
      `💡 提示：${hint}`,
      '（连击清零）',
    ]);
  }

  if (choiceId === 'skip') {
    await services.updateSession(session.id, { streak: 0 });
    const after = await advanceQuestion(services, session);
    return renderView(message, after, [
      `⏭️ 跳过，答案：**${entry.answer}**`,
    ]);
  }

  if (choiceId === 'quit') {
    await services.updateSession(session.id, { status: 'aborted' });
    return '已结束猜谜。';
  }

  return '未知操作。';
}

export { RIDDLE_PREFIX };
