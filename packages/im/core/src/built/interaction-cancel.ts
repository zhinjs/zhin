/**
 * #1250 `interaction-prompt-swallows-messages` (ADR 0061 decision 11, revised): the words that leave
 * a pending prompt. Shared by every locale — a zh-CN user typing `cancel` and an en user typing
 * `取消` both leave. Kept apart from `user-interaction.ts` so it never becomes public API.
 */
import type { UserInteractionRequest } from '@zhin.js/im-contract';

/** Cancel words every prompt accepts besides its own answers. */
export const SHARED_CANCEL_VALUES: ReadonlySet<string> = new Set(['取消', '退出', 'cancel', 'exit', 'quit']);

/** Prompt types that accept a cancel word (a `text` prompt takes any text as its answer). */
const CANCELLABLE = new Set<UserInteractionRequest['type']>(['select', 'multiselect', 'number', 'list']);

/**
 * Whether `raw` cancels `request`. Only called after `raw` failed to parse as an answer, so an
 * option labelled `取消` still selects that option. `confirm` maps cancel words to `false` itself.
 */
export function isInteractionCancelReply(request: UserInteractionRequest, raw: string, action = false): boolean {
  if (action || !CANCELLABLE.has(request.type)) return false;
  return SHARED_CANCEL_VALUES.has(raw.trim().toLocaleLowerCase());
}
