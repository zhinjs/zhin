/**
 * #1250 `interaction-prompt-swallows-messages` (ADR 0061 decision 11, revised): when a reply leaves
 * a pending prompt. The cancel words themselves live in `confirm-words.ts` (第 74 批，唯一词表):
 * every locale accepts them — a zh-CN user typing `cancel` and an en user typing `取消` both leave.
 * Only the base cancel words count here (`取消` / `退出` / `算了` / `cancel` / `quit` / `exit`);
 * yes/no answers such as `no` or `不` stay answers of the prompt. Kept apart from
 * `user-interaction.ts` so it never becomes public API.
 */
import type { UserInteractionRequest } from '@zhin.js/im-contract';
import { isCancelWord } from './confirm-words.js';

/**
 * Prompt types that accept a cancel word. A `text` prompt only meets one when its validation
 * (`minLength`, `pattern`, …) rejects it: a text prompt without rules still takes `取消` as its answer.
 */
const CANCELLABLE = new Set<UserInteractionRequest['type']>(['select', 'multiselect', 'number', 'list', 'text']);

/**
 * Prompt types whose answer parser would take a lone cancel word as data: a `list` reads `取消` as
 * the one-item list `['取消']` (a boolean list as `[false]`). For these a reply that is exactly a
 * cancel word cancels before it is parsed; a cancel word inside a multi-item reply stays an item.
 */
const CANCEL_FIRST = new Set<UserInteractionRequest['type']>(['list']);

/**
 * Whether `raw` cancels `request`. Only called after `raw` failed to parse as an answer, so an
 * option labelled `取消` still selects that option. `confirm` maps cancel words to `false` itself.
 */
export function isInteractionCancelReply(request: UserInteractionRequest, raw: string, action = false): boolean {
  if (action || !CANCELLABLE.has(request.type)) return false;
  return isCancelWord(raw);
}

/**
 * Whether `raw` cancels `request` before it is parsed at all (see {@link CANCEL_FIRST}): the whole
 * reply is one cancel word and the prompt type would otherwise read it as data.
 */
export function isInteractionCancelFirst(request: UserInteractionRequest, raw: string, action = false): boolean {
  if (action || !CANCEL_FIRST.has(request.type)) return false;
  return isCancelWord(raw);
}
