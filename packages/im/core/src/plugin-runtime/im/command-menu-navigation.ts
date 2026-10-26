import { createMessages } from '@zhin.js/plugin-runtime';
import type { CommandDispatchResult, CommandIndex } from '@zhin.js/command';
import { Fragment, jsx } from '@zhin.js/jsx';
import type { ConversationRef } from '@zhin.js/im-contract';
import type { CapabilityId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { Message, SendContent } from './contracts.js';
import { resolveOutboundInteractivePolicy, resolveOutboundMarkdownPolicy, resolveOutboundSupportedSegments } from './outbound-segments.js';
import { presentCommandMenu } from './command-menu-presentation.js';

const menuMessages = createMessages({
  page: { 'zh-CN': '**指令菜单** · 第 {page}/{pages} 页', en: '**Command menu** · Page {page}/{pages}' },
  previous: { 'zh-CN': '上一页', en: 'Previous' },
  next: { 'zh-CN': '下一页', en: 'Next' },
});

/** IM-only presentation: Command remains independent of JSX, adapters and callback registries. */
export async function commandMenuReply(
  result: CommandDispatchResult,
  commands: CommandIndex,
  snapshot: RuntimeSnapshot,
  conversation: ConversationRef,
  prefix: string,
): Promise<SendContent> {
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
      const next = await commands.dispatch(input, message, undefined, prefix, snapshot, menu.locale);
      return commandMenuReply(next, commands, snapshot, message.conversation, prefix);
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
