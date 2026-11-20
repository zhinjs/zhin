import { isCancelWord } from 'zhin.js';
import { resolveLocale } from 'zhin.js/i18n';
import { reminderMessages as t } from './i18n.js';
import type { CommandContext } from 'zhin.js/command';
import type { ReminderConfig } from './config.js';
import { reminderActor } from './caller.js';
import { reminderAccountName } from './task-ref.js';
import { reminderServiceToken } from './runtime.js';
import { ReminderInputError } from './service.js';
import { ReminderTimeInputError, parseNaturalReminderTime, formatReminderTime } from './natural-time.js';

const STEP_TIMEOUT = 60_000;
const FLOW_TIMEOUT = 3 * STEP_TIMEOUT;
class ReminderCreationCancelled extends Error {}
class ReminderCreationDeadline extends Error {}

/** Personal reminder entry: no persistence is touched before explicit confirmation. */
export async function createPersonalReminder(
  context: CommandContext<ReminderConfig>,
  parameters: Readonly<{ when?: string; text?: string }>,
): Promise<string | undefined> {
  const locale = resolveLocale(context.locale);
  const createCommand = context.formatCommand('remind create');
  const listCommand = context.formatCommand('remind list');
  const restart = createCommand ? t(locale, 'restartCommand', { command: createCommand }) : t(locale, 'restart');
  const timeoutText = `${t(locale, 'flowTimeout')} ${restart}`;
  const checkExisting = listCommand ? t(locale, 'checkCommand', { command: listCommand }) : t(locale, 'checkNoCommand');
  if (!context.input?.sender?.id || !context.interaction || !context.input.$replyFrom && !context.input.$reply) return t(locale, 'needsChat');
  const deadline = Date.now() + FLOW_TIMEOUT;
  let creating = false;
  try {
    const actor = reminderActor(context.input, locale);
    const interaction = context.interaction;
    const timezone = context.config.timezone;
    const steps = new Map<string, number>();
    const commandHeads = ['create', 'after', 'at', 'every', 'list', 'cancel'].map(name => context.formatCommand(`remind ${name}`)).filter((value): value is string => !!value);
    const isCommand = (value: string) => commandHeads.some(head => value === head || value.startsWith(`${head} `));
    const checkDeadline = () => {
      context.signal.throwIfAborted();
      if (Date.now() >= deadline) throw new ReminderCreationDeadline();
    };
    // #1250 第 74 批：取消词中英文都认（`取消` / `退出` / `算了` / `cancel` / `quit` / `exit`），不分会话语言。
    const checkCancel = (value: string) => {
      if (isCancelWord(value)) throw new ReminderCreationCancelled();
    };
    const stepRemaining = (stage: 'time' | 'body' | 'confirmation') => {
      checkDeadline();
      const stepDeadline = steps.get(stage) ?? Date.now() + STEP_TIMEOUT;
      steps.set(stage, stepDeadline);
      const remaining = Math.min(deadline, stepDeadline) - Date.now();
      if (remaining <= 0) throw new ReminderCreationDeadline();
      return remaining;
    };
    const ask = async (stage: 'time' | 'body', title: string, description: string, maxLength: number): Promise<string> => {
      const remaining = stepRemaining(stage);
      // ADR 0061 P5: only the person who started the reminder answers; an invalid answer re-sends
      // the prompt at most once (Core), so chatting meanwhile is not answered with the whole prompt again.
      const reply = (await interaction.ask({ type: 'text', title, description,
        tip: t(locale, 'answerTip'), maxLength, answeredBy: 'target',
        timeout: remaining, timeoutText, signal: context.signal,
      })).trim();
      checkDeadline(); checkCancel(reply); return reply;
    };
    let expression = parameters.when?.trim();
    if (expression) checkCancel(expression);
    let parsed: ReturnType<typeof parseNaturalReminderTime> | undefined;
    let timeError = '';
    while (!parsed) {
      checkDeadline();
      if (!expression) expression = await ask('time', t(locale, 'askWhen'), [timeError, t(locale, 'whenHelp', { timezone })].filter(Boolean).join('\n'), 200);
      try {
        parsed = parseNaturalReminderTime(expression, { now: Date.now(), timezone, locale });
      }
      catch (error) {
        if (!(error instanceof ReminderTimeInputError)) throw error;
        timeError = error.message; expression = undefined;
      }
    }
    let text = parameters.text?.trim();
    if (text) checkCancel(text);
    let textError = '';
    while (!text || text.length > 500 || isCommand(text)) {
      if (text) textError = isCommand(text) ? t(locale, 'bodyCommand') : t(locale, 'bodyLimit');
      text = await ask('body', t(locale, 'askBody'), [textError, t(locale, 'bodyHelp')].filter(Boolean).join('\n'), 500);
    }
    const target = actor.target;
    const scene = `${target.kind} ${target.id}${target.parent ? `; ${t(locale, 'parent')} ${target.parent.kind} ${target.parent.id}` : ''}${target.threadId ? `; ${t(locale, 'thread')} ${target.threadId}` : ''}`;
    // #1250: the account's name, not its internal adapter / capability IDs.
    const account = reminderAccountName(context.input, target.endpoint);
    // #1250 (reminder-confirm-text-only): the preview is the confirmation prompt itself — one message,
    // so other chat cannot land between them — and Core's `confirm` type gives 确认 / 取消 buttons
    // where the platform has them and numbered text options elsewhere. Values from the sender or the
    // platform are code, so the prompt's Markdown never interprets them (shown verbatim on both).
    const preview = t(locale, 'preview', { time: formatReminderTime(parsed.at, parsed.timezone),
      scene: markdownCode(scene), account: markdownCode(account), text: markdownFence(text) });
    // ADR 0061 P5: only the person who started the reminder answers; anything that is not an
    // explicit confirmation or cancellation keeps the prompt waiting (re-sent at most once by Core).
    const confirmed = await interaction.ask({ type: 'confirm', title: t(locale, 'askConfirm'),
      description: `${preview}\n\n${checkExisting}`, tip: t(locale, 'confirmHelp'), answeredBy: 'target',
      invalidText: t(locale, 'confirmInvalid'), timeout: stepRemaining('confirmation'), timeoutText, signal: context.signal,
    });
    if (!confirmed) throw new ReminderCreationCancelled();
    checkDeadline();
    if (parsed.at <= Date.now()) return `${t(locale, 'expired')} ${restart}`;
    const service = context.use(reminderServiceToken);
    creating = true;
    const task = await service.add(actor, text, parsed.at, null);
    return `${t(locale, 'personalCreated')}\n${service.describe(task, locale)}`;
  } catch (error) {
    if (error instanceof ReminderCreationCancelled) return t(locale, 'flowCancelled');
    if (error instanceof ReminderInputError) return t(locale, 'notCreated', { error: error.message });
    if (creating) return checkExisting;
    if (context.signal.aborted
      || error instanceof Error && ['UserInteractionTimeoutError', 'UserInteractionSupersededError', 'UserInteractionCancelledError', 'AbortError'].includes(error.name)) return undefined;
    if (error instanceof Error && /(?:retired|inactive generation|scope has ended)/iu.test(error.message)) return undefined;
    // Core reports ask timeouts itself; this deadline can instead expire during preview delivery.
    if (error instanceof ReminderCreationDeadline) return timeoutText;
    if (error instanceof Error && error.name === 'UserInteractionDeliveryError') return t(locale, 'previewFailed');
    throw error;
  }
}

/** Inline code that no backtick run in `value` can close (CommonMark), kept verbatim in text fallback. */
function markdownCode(value: string): string {
  const fence = '`'.repeat(longestBacktickRun(value) + 1);
  const padded = value.startsWith('`') || value.endsWith('`') ? ` ${value} ` : value;
  return `${fence}${padded}${fence}`;
}

/** A fenced block no line of `value` can close: multi-line reminder text stays literal. */
function markdownFence(value: string): string {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(value) + 1));
  return `${fence}\n${value}\n${fence}`;
}

function longestBacktickRun(value: string): number {
  let longest = 0;
  for (const run of value.match(/`+/gu) ?? []) longest = Math.max(longest, run.length);
  return longest;
}
