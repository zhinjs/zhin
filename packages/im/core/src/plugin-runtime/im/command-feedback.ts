import type { CommandDispatchResult, CommandExecutionLimit, CommandIndex, CommandMenuPage, CommandValidationIssue } from '@zhin.js/command';
import { readOperationInputResources } from '@zhin.js/feature-kit';
import type { ConversationRef } from '@zhin.js/im-contract';
import { Fragment, jsx } from '@zhin.js/jsx';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { createToken, createMessages, resolveLocale, type CapabilityId, type Locale, type PluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { Message, MessageSenderRef, SendContent } from './contracts.js';
import { resolveOutboundInteractivePolicy, resolveOutboundMarkdownPolicy, resolveOutboundSupportedSegments } from './outbound-segments.js';

interface CommandFeedbackIdentity {
  readonly command?: string;
  /** The command's owner, not the author of the replacement reply. */
  readonly owner?: PluginId;
}

/** Execution facts are read-only; formatting cannot change admission or permission decisions. */
export type CommandFeedback = CommandFeedbackIdentity & (
  | { readonly status: 'invalid'; readonly issues: readonly CommandValidationIssue[]; readonly help?: string }
  | { readonly status: 'denied' }
  | { readonly status: 'limited'; readonly limit?: CommandExecutionLimit }
);

/** A presentation context deliberately without message bodies, sending methods or executors. */
export interface CommandFeedbackContext {
  readonly locale: Locale;
  readonly conversation: ConversationRef;
  readonly sender?: MessageSenderRef;
  readonly clientAdapter?: string;
  readonly generation: number;
}

/** Return undefined to retain the built-in feedback. Exceptions also fall back to it. */
export type CommandFeedbackRenderer = (
  feedback: CommandFeedback,
  context: CommandFeedbackContext,
) => SendContent | undefined | Promise<SendContent | undefined>;

/** Explicitly provide this resource in Root setup; descendant bindings are not selected. */
export const commandFeedbackToken = createToken<CommandFeedbackRenderer>('zhin.im.command-feedback');

const logger = getLogger('command');

function feedbackFrom(result: CommandDispatchResult): CommandFeedback | undefined {
  const identity = { command: result.command, owner: result.owner };
  if (result.status === 'invalid') return Object.freeze({ ...identity, status: 'invalid',
    issues: Object.freeze((result.issues ?? []).map(issue => Object.freeze({ ...issue }))), help: result.help });
  if (result.status === 'denied') return Object.freeze({ ...identity, status: 'denied' });
  if (result.status === 'limited') return Object.freeze({ ...identity, status: 'limited',
    ...(result.limit ? { limit: Object.freeze({ ...result.limit }) } : {}) });
  return undefined;
}

const feedbackMessages = createMessages({
  denied: { 'zh-CN': '没有权限执行此指令。', en: 'You do not have permission to run this command.' },
  cooldown: { 'zh-CN': '此指令仍在冷却，请稍后再试。', en: 'This command is on cooldown. Try again later.' },
  wait: { 'zh-CN': '此指令仍在冷却，约 {seconds} 秒后再试。', en: 'This command is on cooldown. Try again in about {seconds} seconds.' },
  busy: { 'zh-CN': '你的上一条同类指令仍在处理中，请等待执行完成，避免重复触发。', en: 'Your previous command is still running. Wait for it to finish before trying again.' },
  capacity: { 'zh-CN': '当前繁忙，本次指令未被接纳，请稍后再试。', en: 'The service is busy. This command was not accepted; try again later.' },
  identity: { 'zh-CN': '当前缺少可信身份或有效执行上下文，本次指令未被接纳。请管理员检查适配器及当前运行状态。', en: 'This command was not accepted because a trusted identity or valid execution context is missing. Ask an administrator to check the adapter and runtime.' },
});

function defaultFeedback(feedback: CommandFeedback, locale: Locale): string {
  if (feedback.status === 'invalid') {
    return [...feedback.issues.map(issue => issue.message), feedback.help].filter(Boolean).join('\n');
  }
  if (feedback.status === 'denied') return feedbackMessages(locale, 'denied');
  const reason = feedback.limit?.reason;
  const waitMs = feedback.limit?.retryAfterMs;
  return reason === 'cooldown'
    ? typeof waitMs === 'number' && waitMs > 0
      ? feedbackMessages(locale, 'wait', { seconds: Math.ceil(waitMs / 1000) }) : feedbackMessages(locale, 'cooldown')
    : reason === 'busy' ? feedbackMessages(locale, 'busy')
    : reason === 'capacity' ? feedbackMessages(locale, 'capacity')
    : feedbackMessages(locale, 'identity');
}

/** @internal Resolve once from the operation snapshot; never redispatch or send from here. */
export async function renderCommandFeedback(
  result: CommandDispatchResult,
  message: Message,
  snapshot: RuntimeSnapshot,
): Promise<{ readonly content: SendContent; readonly owner?: PluginId } | undefined> {
  const feedback = feedbackFrom(result);
  if (!feedback) return undefined;
  const renderer = snapshot.resources.get(snapshot.root)?.get(commandFeedbackToken.id);
  if (typeof renderer === 'function') {
    const conversation = Object.freeze({
      endpoint: Object.freeze({ id: message.conversation.endpoint.id, adapter: message.conversation.endpoint.adapter }),
      kind: message.conversation.kind, id: message.conversation.id,
      ...(message.conversation.parent ? { parent: Object.freeze({
        kind: message.conversation.parent.kind, id: message.conversation.parent.id,
      }) } : {}),
      ...(message.conversation.threadId !== undefined ? { threadId: message.conversation.threadId } : {}),
    });
    const context: CommandFeedbackContext = Object.freeze({ conversation, locale: resolveLocale(message.locale),
      ...(message.sender ? { sender: Object.freeze({ id: message.sender.id,
        ...(message.sender.name !== undefined ? { name: message.sender.name } : {}),
        ...(message.sender.roles ? { roles: Object.freeze([...message.sender.roles]) } : {}) }) } : {}),
      ...(message.clientAdapter !== undefined ? { clientAdapter: message.clientAdapter } : {}),
      generation: snapshot.generation });
    try {
      const content = await (renderer as CommandFeedbackRenderer)(feedback, context);
      if (content !== undefined) return { content, owner: snapshot.root };
    } catch {
      // Renderer failures contain user-controlled data; record only the failure category.
      logger.warn(formatCompact({ op: 'command_feedback_error', generation: snapshot.generation, status: feedback.status }));
    }
  }
  return { content: defaultFeedback(feedback, resolveLocale(message.locale)), owner: result.owner };
}

export interface CommandMenuPresentationInput {
  readonly page: CommandMenuPage;
  readonly conversation: ConversationRef;
  readonly generation: number;
}

/** Root-selected menu content. `undefined` retains the built-in presentation. */
export type CommandMenuPresenter = (
  input: CommandMenuPresentationInput,
) => SendContent | undefined | Promise<SendContent | undefined>;

export const commandMenuPresentationToken = createToken<CommandMenuPresenter>(
  'zhin.command-menu-presentation',
  'Root-selected command menu presentation; framework pagination remains unchanged',
);

/** The current Root owns both the selected presenter and the resulting content. */
export async function presentCommandMenu(
  page: CommandMenuPage,
  fallback: SendContent,
  snapshot: RuntimeSnapshot,
  conversation: ConversationRef,
): Promise<SendContent> {
  const presenter = snapshot.resources.get(snapshot.root)?.get(commandMenuPresentationToken.id) as CommandMenuPresenter | undefined;
  if (!presenter) return fallback;
  try {
    const view: ConversationRef = Object.freeze({
      endpoint: Object.freeze({ id: conversation.endpoint.id, adapter: conversation.endpoint.adapter }),
      kind: conversation.kind, id: conversation.id,
      ...(conversation.parent ? { parent: Object.freeze({ kind: conversation.parent.kind, id: conversation.parent.id }) } : {}),
      ...(conversation.threadId !== undefined ? { threadId: conversation.threadId } : {}),
    });
    const content = await presenter(Object.freeze({ page, conversation: view, generation: snapshot.generation }));
    return content === undefined ? fallback : content;
  } catch {
    // A presentation failure must not expose content, re-run commands or cause a second send.
    logger.warn(formatCompact({ op: 'command_menu_presentation', status: 'fallback', reason: 'presenter_failed', generation: snapshot.generation }));
    return fallback;
  }
}

const menuMessages = createMessages({
  page: { 'zh-CN': '**指令菜单** · 第 {page}/{pages} 页', en: '**Command menu** · Page {page}/{pages}' },
  previous: { 'zh-CN': '上一页', en: 'Previous' },
  next: { 'zh-CN': '下一页', en: 'Next' },
});

/** Rendering dependencies for one menu response; callbacks retain the same generation. */
export interface CommandMenuReplyContext {
  readonly commands: CommandIndex;
  readonly snapshot: RuntimeSnapshot;
  readonly conversation: ConversationRef;
  readonly prefix: string;
}

/** IM-only presentation: Command remains independent of JSX, adapters and callback registries. */
export async function commandMenuReply(result: CommandDispatchResult, { commands, snapshot, conversation, prefix }: CommandMenuReplyContext): Promise<SendContent> {
  // Only validated menus carry this metadata; other command return values stay opaque.
  const menu = result.menu;
  if (!menu) return result.value as SendContent;
  const content = await presentCommandMenu(menu, result.value as SendContent, snapshot, conversation);
  if (menu.pages <= 1) return content;
  const endpoint = conversation.endpoint.id as CapabilityId;
  const supported = resolveOutboundSupportedSegments(endpoint, snapshot);
  if (resolveOutboundMarkdownPolicy(endpoint, snapshot) !== 'native'
    || resolveOutboundInteractivePolicy(endpoint, snapshot) !== 'native'
    || supported && (!supported.includes('markdown') || !supported.includes('keyboard'))) return content;

  const button = (page: number, label: string, disabled: boolean) => jsx('button', {
    label, disabled, style: disabled ? 'secondary' : 'primary',
    onClick: async (message: Message): Promise<SendContent> => {
      if (disabled) return [];
      const input = `${menu.keyword}${menu.pluginKey ? ` ${menu.pluginKey}` : ''} --page ${page}`;
      const next = await commands.dispatch({ input: input, source: message, commandPrefix: prefix, snapshot: snapshot, locale: menu.locale, operation: readOperationInputResources(message, snapshot) });
      return commandMenuReply(next, { commands: commands, snapshot: snapshot, conversation: message.conversation, prefix: prefix });
    },
  });
  return [content,
    { type: 'markdown', data: { content: menuMessages(menu.locale, 'page', { page: menu.page, pages: menu.pages }) } },
    jsx(Fragment, { children: [
      button(menu.page - 1, menuMessages(menu.locale, 'previous'), menu.page === 1),
      button(menu.page + 1, menuMessages(menu.locale, 'next'), menu.page === menu.pages),
    ] }),
  ];
}
