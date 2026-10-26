import { messages as t } from './i18n.js';
import { createDeliveryTarget, databaseHostToken, type Token } from 'zhin.js';
import type { GroupSuiteConfig } from './config.js';
import type { ConversationInput } from './conversation-scope.js';
import { requireConversation } from './conversation-scope.js';
import { keywordStore } from './keyword-store.js';
import { resolveGroupSuiteRuntime } from './runtime-state.js';

export const KEYWORD_STORAGE_REQUIREMENT = '关键词管理需要 Database Host 的持久状态服务；请配置数据库，或显式设置 ephemeralKeywords: true 使用临时词库';
class KeywordStorageRequirementError extends Error {}
const MAX_KEYWORD_BYTES = 64 * 1024;

type KeywordRows = readonly (readonly [string, string])[];
interface KeywordContext {
  readonly locale?: import('zhin.js/i18n').Locale;
  readonly config: Readonly<Partial<GroupSuiteConfig>>;
  use<T>(token: Token<T>): T;
}

/** Persistent owner + exact conversation state; volatile storage requires an explicit opt-in. */
export function keywords(input: ConversationInput | undefined, context: KeywordContext) {
  const target = requireConversation(input ?? {});
  if (target.kind !== 'group') throw new Error('Keywords require a group conversation');
  if (context.config.ephemeralKeywords === true) {
    const store = keywordStore({ conversation: target }, resolveGroupSuiteRuntime(context));
    return {
      read: async () => [...store.entries()] as KeywordRows,
      update: async (updater: (current: Map<string, string>) => void) => {
        const next = new Map(store);
        updater(next);
        assertLimit(next, context.locale ?? input?.locale);
        store.clear();
        for (const [key, value] of next) store.set(key, value);
      },
    };
  }
  const hostState = (() => {
    try { return context.use(databaseHostToken).state; }
    catch (cause) { throw new KeywordStorageRequirementError(t(context.locale ?? input?.locale, 'keywordStorage'), { cause }); }
  })();
  const state = hostState.forConversation(createDeliveryTarget({ conversation: target }));
  return {
    read: async () => (await state.get<KeywordRows>('keywords')) ?? [],
    update: async (updater: (current: Map<string, string>) => void) => {
      await state.update<KeywordRows>('keywords', current => {
        const next = new Map(current ?? []);
        updater(next);
        assertLimit(next, context.locale ?? input?.locale);
        return [...next.entries()];
      });
    },
  };
}

/** Management commands surface a storage requirement instead of inventing an empty dictionary. */
export function keywordsForCommand(input: ConversationInput | undefined, context: KeywordContext) {
  try { return keywords(input, context); }
  catch (error) {
    if (error instanceof KeywordStorageRequirementError) return error.message;
    throw error;
  }
}

function assertLimit(store: Map<string, string>, locale?: import('zhin.js/i18n').Locale): void {
  if (store.size > 200) throw new Error(t(locale, 'keywordLimit'));
  if (new TextEncoder().encode(JSON.stringify([...store.entries()])).byteLength >= MAX_KEYWORD_BYTES) {
    throw new Error(t(locale, 'keywordSize'));
  }
  for (const [keyword, reply] of store) {
    if (!keyword || keyword.length > 200 || !reply || reply.length > 2000) {
      throw new Error(t(locale, 'keywordLength'));
    }
  }
}
