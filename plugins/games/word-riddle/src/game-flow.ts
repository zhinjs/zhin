import type { Adapter, Message, Plugin } from 'zhin.js';
import {
  checkAnswer,
  getRiddleById,
  RIDDLE_PREFIX,
  typeLabel,
} from './engine.js';
import type { RiddleSessionRow } from './models.js';
import type { RiddleType } from './data/riddles.js';
import {
  currentRiddleId,
  parseQueue,
  type SessionService,
} from './session-service.js';
import { buildRiddleView, MAX_WRONG } from './view.js';

export async function sendOrEditView(
  plugin: Plugin,
  services: SessionService,
  message: Message<any>,
  session: RiddleSessionRow,
  eventLines: string[] = [],
): Promise<void> {
  const content = buildRiddleView(session, eventLines);
  if (typeof content === 'string') {
    await message.$reply?.(content);
    return;
  }

  const adapter = plugin.root.inject(message.$adapter) as Adapter;
  if (session.board_message_id) {
    const msgId = await adapter.editMessage({
      messageId: session.board_message_id,
      context: String(message.$adapter),
      endpoint: message.$endpoint,
      id: message.$channel.id,
      type: message.$channel.type,
      content,
    });
    if (msgId !== session.board_message_id) {
      await services.updateSession(session.id, { board_message_id: msgId });
    }
    return;
  }

  const msgId = await message.$reply?.(content);
  if (msgId) await services.updateSession(session.id, { board_message_id: msgId });
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
  plugin: Plugin,
  services: SessionService,
  message: Message<any>,
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
  await sendOrEditView(plugin, services, message, session);
  return undefined;
}

export async function continueGame(
  plugin: Plugin,
  services: SessionService,
  message: Message<any>,
): Promise<string> {
  const session = await services.getActiveForUser(
    `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`,
    message.$sender.id,
  );
  if (!session) return '你没有进行中的猜谜，发送「猜谜 开始」。';
  await sendOrEditView(plugin, services, message, session);
  return '已刷新猜谜界面。';
}

export async function processAnswerText(
  plugin: Plugin,
  services: SessionService,
  message: Message<any>,
  raw: string,
): Promise<string | null> {
  const ch = `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`;
  const session = await services.getActiveForUser(ch, message.$sender.id);
  if (!session || session.status !== 'active') return null;

  const riddleId = currentRiddleId(session);
  const entry = riddleId ? getRiddleById(riddleId) : undefined;
  if (!entry) return null;

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
    await sendOrEditView(plugin, services, message, after, [
      `✅ 正确！答案：**${entry.answer}**${explain}`,
      `+${10 + Math.min(streak, 5)} 分`,
    ]);
    return null;
  }

  const wrong = session.wrong_count + 1;
  if (wrong >= MAX_WRONG) {
    await services.updateSession(session.id, { wrong_count: wrong, streak: 0 });
    const after = await advanceQuestion(services, (await services.getById(session.id))!);
    await sendOrEditView(plugin, services, message, after, [
      `❌ 本题答案：**${entry.answer}**`,
      '失误过多，自动下一题。',
    ]);
    return null;
  }

  await services.updateSession(session.id, { wrong_count: wrong, streak: 0 });
  const updated = (await services.getById(session.id))!;
  await sendOrEditView(plugin, services, message, updated, ['❌ 不对，再想想！']);
  return null;
}

export async function handleChoice(
  plugin: Plugin,
  services: SessionService,
  message: Message<any>,
  sessionId: string,
  choiceId: string,
): Promise<string | null> {
  const session = await services.getById(sessionId);
  if (!session) return '会话不存在。';
  if (session.player_id !== message.$sender.id) return '这是别人的猜谜。';

  if (choiceId === 'restart_char') {
    await services.updateSession(session.id, { status: 'aborted' });
    return startGame(plugin, services, message, 'char') as unknown as string;
  }
  if (choiceId === 'restart_idiom') {
    await services.updateSession(session.id, { status: 'aborted' });
    return startGame(plugin, services, message, 'idiom') as unknown as string;
  }

  if (session.status !== 'active') return '本轮已结束。';

  const riddleId = currentRiddleId(session);
  const entry = riddleId ? getRiddleById(riddleId) : undefined;
  if (!entry) return '题目丢失。';

  if (choiceId === 'hint') {
    const hint = entry.hint ?? `答案共 ${entry.answer.length} 个字`;
    await services.updateSession(session.id, { hints_used: session.hints_used + 1, streak: 0 });
    const updated = (await services.getById(session.id))!;
    await sendOrEditView(plugin, services, message, updated, [`💡 提示：${hint}`, '（连击清零）']);
    return null;
  }

  if (choiceId === 'skip') {
    await services.updateSession(session.id, { streak: 0 });
    const after = await advanceQuestion(services, session);
    await sendOrEditView(plugin, services, message, after, [`⏭️ 跳过，答案：**${entry.answer}**`]);
    return null;
  }

  if (choiceId === 'quit') {
    await services.updateSession(session.id, { status: 'aborted' });
    return '已结束猜谜。';
  }

  return '未知操作。';
}

export { RIDDLE_PREFIX };
