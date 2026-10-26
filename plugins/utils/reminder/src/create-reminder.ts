import { resolveLocale } from 'zhin.js/i18n';
import { reminderMessages as t } from './i18n.js';
import type { CommandContext } from 'zhin.js/command';
import type { ReminderConfig } from './config.js';
import { reminderActor } from './caller.js';
import { reminderServiceToken } from './runtime.js';
import { ReminderInputError } from './service.js';
import { ReminderTimeInputError, parseNaturalReminderTime, formatReminderTime } from './natural-time.js';

const STEP_TIMEOUT = 60_000;
const FLOW_TIMEOUT = 3 * STEP_TIMEOUT;
class ReminderCreationCancelled extends Error {}
class ReminderCreationDeadline extends Error {}
class ReminderPreviewDeliveryError extends Error {}

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
    const checkCancel = (value: string) => {
      if (value.trim().toLowerCase() === (locale === 'en' ? 'cancel' : '取消')) throw new ReminderCreationCancelled();
    };
    const ask = async (stage: 'time' | 'body' | 'confirmation', title: string, description: string, maxLength: number): Promise<string> => {
      checkDeadline();
      const stepDeadline = steps.get(stage) ?? Date.now() + STEP_TIMEOUT;
      steps.set(stage, stepDeadline);
      const remaining = Math.min(deadline, stepDeadline) - Date.now();
      if (remaining <= 0) throw new ReminderCreationDeadline();
      const answer = (await interaction.ask({ type: 'text', title, description,
        tip: t(locale, 'answerTip'), maxLength,
        timeout: remaining, timeoutText, signal: context.signal,
      })).trim();
      checkDeadline(); checkCancel(answer); return answer;
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
    const account = `${target.endpoint.adapter} / ${target.endpoint.id.replaceAll('\0', ' / ')}`;
    const preview = `${t(locale, 'preview', { time: formatReminderTime(parsed.at, parsed.timezone), scene, account, text })}\n${checkExisting}`;
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
      const answer = await ask('confirmation', t(locale, 'askConfirm'), [confirmError, t(locale, 'confirmHelp')].filter(Boolean).join('\n'), 500);
      if (answer.toLowerCase() === (locale === 'en' ? 'confirm' : '确认')) break;
      confirmError = t(locale, 'confirmInvalid');
    }
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
      || error instanceof Error && ['UserInteractionTimeoutError', 'UserInteractionSupersededError', 'AbortError'].includes(error.name)) return undefined;
    if (error instanceof Error && /(?:retired|inactive generation|scope has ended)/iu.test(error.message)) return undefined;
    // Core reports ask timeouts itself; this deadline can instead expire during preview delivery.
    if (error instanceof ReminderCreationDeadline) return timeoutText;
    if (error instanceof ReminderPreviewDeliveryError || error instanceof Error && error.name === 'UserInteractionDeliveryError') return t(locale, 'previewFailed');
    throw error;
  }
}
