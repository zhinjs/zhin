import type { MessageBase } from '@zhin.js/core/runtime';
import { conversationKey } from './conversation-scope.js';
import type { GroupSuiteRuntime } from './runtime-state.js';

export function addKeyword(keyword: string, reply: string, store: Map<string, string>): void {
  store.set(keyword, reply);
}

export function removeKeyword(keyword: string, store: Map<string, string>): boolean {
  return store.delete(keyword);
}

export function listKeywords(store: Map<string, string>): Array<[string, string]> {
  return Array.from(store.entries());
}

export function matchKeyword(text: string, store: Map<string, string>): string | null {
  for (const [keyword, reply] of store) {
    if (text.includes(keyword)) return reply;
  }
  return null;
}

/** Owner is already isolated by the Resource; canonical endpoint and group form the inner scope. */
export function keywordStore(
  input: Pick<MessageBase, 'conversation'> | undefined,
  runtime: GroupSuiteRuntime,
): Map<string, string> {
  const conversation = input?.conversation;
  if (conversation?.kind !== 'group' || !conversation.id || !conversation.endpoint.id) {
    throw new Error('Keywords require a group conversation with an endpoint');
  }
  const key = conversationKey(conversation);
  let store = runtime.keywords.get(key);
  if (!store) {
    store = new Map();
    runtime.keywords.set(key, store);
  }
  return store;
}
