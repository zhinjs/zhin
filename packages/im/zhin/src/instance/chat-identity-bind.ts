/**
 * ADR 0060 §2.4 / §5.2: binding a chat identity to a Console user with a one-time code.
 *
 * - The Console user asks for a code (`chat-identities.bind-code.create`, permission
 *   `self.chat-identity`): 8 symbols, valid 10 minutes, single use; a new code replaces the user's
 *   previous one. The code is shown only to that user.
 * - The identity's holder sends `绑定 <码>` / `bind <code>` to the bot in a **private** chat: that
 *   proves control of the identity. In a group a correct code is revoked at once (bystanders saw
 *   it, Q8). Adapters whose capability profile marks a local simulation (`runtime.sandbox`: the
 *   client picks the sender id) never accept codes.
 * - Five wrong codes from one identity within 10 minutes lock that identity out for the rest of
 *   the window.
 * - Audited as `chat-identities.bind` (`link_method: code`); logs and the audit carry only the
 *   first 8 hex digits of the code's SHA-256.
 */
import { randomInt, timingSafeEqual } from 'node:crypto';
import { commandFeatureId, defineCommand, type CommandContext } from '@zhin.js/command';
import { createMessages, type Locale, type SnapshotReader } from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import type { ChatIdentity } from '@zhin.js/core';
import { chatOwnerClaimCodeHash } from './chat-owner-claim.js';
import { chatRoleMigrationAdapterKinds, type ChatRoleMigrationAdapterKind } from './chat-role-migration.js';
import type { ChatBindOutcome, ChatPeople } from './chat-people.js';
import { ChatRoleStorageUnavailableError } from './chat-roles.js';
import { featureChatActor, featureChatTokens } from './feature-self-service.js';

export const CHAT_BIND_CODE_TTL_MS = 10 * 60_000;
export const CHAT_BIND_MAX_FAILURES = 5;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

const normalizeCode = (text: string) => text.toUpperCase().replace(/[\s-]/gu, '');

function sameCode(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface OpenCode {
  readonly code: string;
  readonly consoleUserId: string;
  readonly consoleDisplayName?: string;
  /** The creator held global `iam.manage` when asking (binding may then carry roles). */
  readonly canManageGlobal: boolean;
  readonly expiresAt: number;
}

export type ChatBindAttemptOutcome =
  | ChatBindOutcome
  | 'invalid'
  | 'not-private'
  | 'simulated'
  | 'locked'
  | 'unpersisted';

export interface ChatBindAttempt {
  readonly code: string;
  readonly identity: ChatIdentity;
  readonly kind: 'private' | 'group' | 'channel';
  readonly adapterKind: ChatRoleMigrationAdapterKind;
}

export class ChatIdentityBindCodes {
  readonly #people: ChatPeople;
  readonly #now: () => number;
  readonly #code: () => string;
  readonly #codes = new Map<string, OpenCode>();
  readonly #failures = new Map<string, { count: number; since: number }>();

  constructor(options: Readonly<{ people: ChatPeople; now?: () => number; code?: () => string }>) {
    this.#people = options.people;
    this.#now = options.now ?? Date.now;
    this.#code = options.code ?? (() => {
      let code = '';
      for (let index = 0; index < CODE_LENGTH; index += 1) code += ALPHABET[randomInt(ALPHABET.length)];
      return code;
    });
  }

  #sweep(): void {
    const now = this.#now();
    for (const [user, open] of this.#codes) if (open.expiresAt <= now) this.#codes.delete(user);
  }

  /** A fresh code for the Console user (replaces the previous one). */
  create(input: Readonly<{ consoleUserId: string; consoleDisplayName?: string; canManageGlobal: boolean }>): Readonly<{ code: string; expiresAt: number }> {
    this.#sweep();
    const code = this.#code();
    const expiresAt = this.#now() + CHAT_BIND_CODE_TTL_MS;
    this.#codes.set(input.consoleUserId, Object.freeze({ code, consoleUserId: input.consoleUserId,
      ...(input.consoleDisplayName ? { consoleDisplayName: input.consoleDisplayName } : {}), canManageGlobal: input.canManageGlobal, expiresAt }));
    return Object.freeze({ code, expiresAt });
  }

  /** Expiry of the user's open code. */
  pending(consoleUserId: string): number | undefined {
    this.#sweep();
    return this.#codes.get(consoleUserId)?.expiresAt;
  }

  /** Drops the user's open code (the Console user was removed). */
  revoke(consoleUserId: string): void { this.#codes.delete(consoleUserId); }

  #find(code: string): OpenCode | undefined {
    for (const open of this.#codes.values()) if (sameCode(open.code, code)) return open;
    return undefined;
  }

  async attempt(attempt: ChatBindAttempt): Promise<ChatBindAttemptOutcome> {
    this.#sweep();
    const code = normalizeCode(attempt.code);
    const open = this.#find(code);
    if (attempt.kind !== 'private') {
      // Bystanders saw a correct code: revoke it.
      if (open) this.#codes.delete(open.consoleUserId);
      return 'not-private';
    }
    if (attempt.adapterKind !== 'platform') return 'simulated';
    const key = `${attempt.identity.adapter}\u0000${attempt.identity.userId}`;
    const now = this.#now();
    const failures = this.#failures.get(key);
    if (failures && now - failures.since >= CHAT_BIND_CODE_TTL_MS) this.#failures.delete(key);
    if ((this.#failures.get(key)?.count ?? 0) >= CHAT_BIND_MAX_FAILURES) return 'locked';
    if (!open) {
      const current = this.#failures.get(key) ?? { count: 0, since: now };
      current.count += 1;
      this.#failures.set(key, current);
      if (this.#failures.size > 10_000) this.#failures.delete(this.#failures.keys().next().value!);
      return 'invalid';
    }
    // Single use: consumed before the write.
    this.#codes.delete(open.consoleUserId);
    try {
      const result = await this.#people.bindByCode({ consoleUserId: open.consoleUserId,
        ...(open.consoleDisplayName ? { consoleDisplayName: open.consoleDisplayName } : {}),
        identity: attempt.identity, canManageGlobal: open.canManageGlobal, codeHash: chatOwnerClaimCodeHash(code) });
      return result.outcome;
    } catch (error) {
      if (error instanceof ChatRoleStorageUnavailableError) return 'unpersisted';
      throw error;
    }
  }
}

const messages = createMessages({
  description: { 'zh-CN': '私聊发送 Console 给出的绑定码，把你的聊天身份绑定到 Console 账号', en: 'Bind your chat identity to a Console account with the code the Console shows (private chat)' },
  usage: { 'zh-CN': '用法：绑定 <绑定码>（在 Console「把聊天身份绑定到我」获取，只接受私聊）', en: 'Usage: bind <code> (get it from the Console, "Bind my chat identity"; private chat only)' },
  notPrivate: { 'zh-CN': '绑定只接受私聊。若刚才发送的是有效绑定码，它已作废，请在 Console 重新获取并私聊机器人发送。', en: 'Binding is accepted in private chats only. If that was a valid code it has been revoked; get a new one in the Console and send it privately.' },
  simulated: { 'zh-CN': '这个适配器上不接受绑定（模拟适配器的发言者 id 可由客户端自选）。', en: 'Binding is not accepted on this adapter (a simulation lets clients choose the sender id).' },
  invalid: { 'zh-CN': '绑定码不正确或已过期。', en: 'The code is wrong or has expired.' },
  locked: { 'zh-CN': '错误次数过多，请 10 分钟后再试。', en: 'Too many wrong codes; try again in 10 minutes.' },
  unpersisted: { 'zh-CN': '未保存：聊天身份需要关系型项目数据库（sqlite / mysql / pg）。', en: 'Not saved: chat identities need a relational project database (sqlite / mysql / pg).' },
  bound: { 'zh-CN': '已绑定：你的聊天身份（{identity}）已关联到 Console 账号。', en: 'Bound: your chat identity ({identity}) is now linked to the Console account.' },
  unchanged: { 'zh-CN': '这个聊天身份已经绑定到该 Console 账号。', en: 'This chat identity is already bound to that Console account.' },
  ownedElsewhere: { 'zh-CN': '未绑定：这个聊天身份已属于另一个人（已关联其他 Console 账号或其他身份）。请联系主人在 Console「聊天成员」页处理。', en: 'Not bound: this chat identity already belongs to another person. Ask the owner to resolve it in the Console.' },
  needsAdmin: { 'zh-CN': '未绑定：绑定会把聊天角色带到另一个身份上，需要持有全局 iam.manage 的 Console 用户生成绑定码，或由主人在 Console 归并。', en: 'Not bound: binding would carry chat roles to another identity; a Console user with global iam.manage must create the code, or the owner merges in the Console.' },
  unknownConversation: { 'zh-CN': '无法识别当前会话。', en: 'This conversation cannot be identified.' },
  failed: { 'zh-CN': '绑定失败：{error}', en: 'Binding failed: {error}' },
});

/** Runs one `绑定` / `bind` invocation and returns the reply text (normal send chain). */
export async function executeIdentityBind(
  input: Readonly<{ code: string | undefined; actor: ReturnType<typeof featureChatActor>; adapterKind: ChatRoleMigrationAdapterKind; locale: Locale }>,
  codes: ChatIdentityBindCodes,
): Promise<string> {
  const { locale, actor } = input;
  if (!actor) return messages(locale, 'unknownConversation');
  if (!input.code) return messages(locale, 'usage');
  let outcome: ChatBindAttemptOutcome;
  try {
    outcome = await codes.attempt({ code: input.code, identity: actor.identity, kind: actor.kind, adapterKind: input.adapterKind });
  } catch (error) {
    return messages(locale, 'failed', { error: (error as Error).message });
  }
  switch (outcome) {
    case 'bound': return messages(locale, 'bound', { identity: `${actor.identity.adapter}:${actor.identity.userId}` });
    case 'unchanged': return messages(locale, 'unchanged');
    case 'owned-elsewhere': return messages(locale, 'ownedElsewhere');
    case 'needs-admin': return messages(locale, 'needsAdmin');
    case 'not-private': return messages(locale, 'notPrivate');
    case 'simulated': return messages(locale, 'simulated');
    case 'locked': return messages(locale, 'locked');
    case 'unpersisted': return messages(locale, 'unpersisted');
    default: return messages(locale, 'invalid');
  }
}

/** Root command `bind` (alias `绑定`); installed whenever commands are. */
export function installChatIdentityBind(options: Readonly<{ codes: ChatIdentityBindCodes; snapshots: SnapshotReader }>): RootResourceInstaller {
  return context => {
    if (!context.hasFeature?.(commandFeatureId)) return;
    context.addFeature(commandFeatureId, 'bind', defineCommand({
      description: messages('zh-CN', 'description'), descriptionI18n: { en: messages('en', 'description') },
      alias: ['绑定'], options: {},
      execute: (command: CommandContext) => {
        const lease = options.snapshots.acquire();
        let actor: ReturnType<typeof featureChatActor>;
        let adapterKind: ChatRoleMigrationAdapterKind;
        try {
          actor = featureChatActor(lease.value, command.input);
          adapterKind = actor ? chatRoleMigrationAdapterKinds(lease.value)(actor.identity.adapter) : undefined;
        } finally { lease.release(); }
        const first = featureChatTokens(command).find((token): token is string => typeof token === 'string');
        return executeIdentityBind({ code: first, actor, adapterKind, locale: command.locale }, options.codes);
      },
    }));
  };
}
