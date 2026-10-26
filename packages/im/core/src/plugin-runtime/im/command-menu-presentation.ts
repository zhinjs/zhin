import type { CommandMenuPage } from '@zhin.js/command';
import type { ConversationRef } from '@zhin.js/im-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { createToken, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { SendContent } from './contracts.js';

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

const logger = getLogger('command');

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
