import type { CommandContext } from 'zhin.js/command';
import type { ReminderConfig } from './config.js';
import { reminderActor } from './caller.js';
import { reminderServiceToken } from './runtime.js';
import { ReminderInputError } from './service.js';
import { ReminderTimeInputError, parseNaturalReminderTime, formatReminderTime } from './natural-time.js';

const STEP_TIMEOUT = 60_000;
const FLOW_TIMEOUT = 3 * STEP_TIMEOUT;
const TIMEOUT_TEXT = '提醒输入超时，未创建提醒；请重新执行 remind create。';
class ReminderCreationCancelled extends Error {}
class ReminderCreationDeadline extends Error {}
class ReminderPreviewDeliveryError extends Error {}

/** Personal reminder entry: no persistence is touched before explicit confirmation. */
export async function createPersonalReminder(
  context: CommandContext<ReminderConfig>,
  parameters: Readonly<{ when?: string; text?: string }>,
): Promise<string | undefined> {
  if (!context.input?.sender?.id || !context.interaction || !context.input.$replyFrom && !context.input.$reply) return '请在真实聊天会话中使用此指令；需要发送者身份和交互能力，未创建提醒。';
  const deadline = Date.now() + FLOW_TIMEOUT;
  let creating = false;
  try {
    const actor = reminderActor(context.input);
    const interaction = context.interaction;
    const timezone = context.config.timezone;
    const steps = new Map<string, number>();
    const invocationHead = /^(.*?remind)\s+create(?:\s|$)/iu.exec(context.input.content.trim())?.[1];
    const isCommand = (value: string) => /^[!/#.]?remind\s+(?:create|after|at|every|list|cancel)(?:\s|$)/iu.test(value)
      || !!invocationHead && value.startsWith(`${invocationHead} `);
    const checkDeadline = () => {
      context.signal.throwIfAborted();
      if (Date.now() >= deadline) throw new ReminderCreationDeadline();
    };
    const checkCancel = (value: string) => {
      if (/^(?:取消|cancel)$/iu.test(value.trim())) throw new ReminderCreationCancelled();
    };
    const ask = async (stage: 'time' | 'body' | 'confirmation', title: string, description: string, maxLength: number): Promise<string> => {
      checkDeadline();
      const stepDeadline = steps.get(stage) ?? Date.now() + STEP_TIMEOUT;
      steps.set(stage, stepDeadline);
      const remaining = Math.min(deadline, stepDeadline) - Date.now();
      if (remaining <= 0) throw new ReminderCreationDeadline();
      const answer = (await interaction.ask({ type: 'text', title, description,
        tip: '直接回复内容，不加命令前缀；输入“取消”或 cancel 可退出。', maxLength,
        timeout: remaining, timeoutText: TIMEOUT_TEXT, signal: context.signal,
      })).trim();
      checkDeadline(); checkCancel(answer); return answer;
    };
    let expression = parameters.when?.trim();
    if (expression) checkCancel(expression);
    let parsed: ReturnType<typeof parseNaturalReminderTime> | undefined;
    let timeError = '';
    while (!parsed) {
      checkDeadline();
      if (!expression) expression = await ask('time', '什么时候提醒你？', [timeError, `按 ${timezone} 解析，例如“10分钟后”或“明天上午九点”；也可使用带 offset 的 ISO 时间。`].filter(Boolean).join('\n'), 200);
      try { parsed = parseNaturalReminderTime(expression, { now: Date.now(), timezone }); }
      catch (error) {
        if (!(error instanceof ReminderTimeInputError)) throw error;
        timeError = error.message; expression = undefined;
      }
    }
    let text = parameters.text?.trim();
    if (text) checkCancel(text);
    let textError = '';
    while (!text || text.length > 500 || isCommand(text)) {
      if (text) textError = isCommand(text) ? '当前正在补全提醒；请直接回复正文，或先取消后重新发指令。' : '提醒正文须为 1–500 个字符。';
      text = await ask('body', '提醒你做什么？', [textError, '请输入纯文字提醒正文（1–500 字）。'].filter(Boolean).join('\n'), 500);
    }
    const target = actor.target;
    const scene = `${target.kind} ${target.id}${target.parent ? `；父容器 ${target.parent.kind} ${target.parent.id}` : ''}${target.threadId ? `；话题 ${target.threadId}` : ''}`;
    const account = `${target.endpoint.adapter} / ${target.endpoint.id.replaceAll('\0', ' / ')}`;
    const preview = `时间：${formatReminderTime(parsed.at, parsed.timezone)}\n原会话：${scene}\n账号：${account}\n正文（原样显示）：\n${text}\n\n请等待下一条确认提示，再输入“确认”创建；不会更换目标会话。\n若确认后未收到创建结果，请先在原会话用 remind list 核对，不要直接重复创建。`;
    checkDeadline();
    // Canonical text avoids interpreting reminder content as Markdown/HTML in the prompt renderer.
    const previewContent = { type: 'text', data: { text: preview } };
    const receipt = context.input.$reply
      ? await context.input.$reply(previewContent)
      : await context.input.$replyFrom!(context.owner.id, previewContent);
    checkDeadline();
    if (!receipt || typeof receipt !== 'object' || !('status' in receipt) || receipt.status !== 'sent') throw new ReminderPreviewDeliveryError();
    let confirmError = '';
    while (true) {
      const answer = await ask('confirmation', '确认创建这条提醒？', [confirmError, '请核对上一条预览的时间、时区、正文和原会话；仅输入“确认”才创建。'].filter(Boolean).join('\n'), 500);
      if (answer === '确认') break;
      confirmError = '未创建提醒。请明确输入“确认”，或输入“取消”退出。';
    }
    checkDeadline();
    if (parsed.at <= Date.now()) return '提醒时间已过，未创建提醒。请重新执行 remind create 并选择未来时间；不会自动顺延。';
    const service = context.use(reminderServiceToken);
    creating = true;
    const task = await service.add(actor, text, parsed.at, null);
    return `已创建个人提醒\n${service.describe(task)}`;
  } catch (error) {
    if (error instanceof ReminderCreationCancelled) return '已取消，未创建提醒。';
    if (error instanceof ReminderInputError) return `未创建提醒：${error.message}`;
    if (creating) return '提醒创建结果未能确认，请先使用 remind list 核对；不要直接重复创建。';
    if (context.signal.aborted
      || error instanceof Error && ['UserInteractionTimeoutError', 'UserInteractionSupersededError', 'AbortError'].includes(error.name)) return undefined;
    if (error instanceof Error && /(?:retired|inactive generation|scope has ended)/iu.test(error.message)) return undefined;
    // Core reports ask timeouts itself; this deadline can instead expire during preview delivery.
    if (error instanceof ReminderCreationDeadline) return TIMEOUT_TEXT;
    if (error instanceof ReminderPreviewDeliveryError || error instanceof Error && error.name === 'UserInteractionDeliveryError') return '提示消息未能确认送达，未创建提醒；请核对会话后重新执行，不会自动重发。';
    throw error;
  }
}
