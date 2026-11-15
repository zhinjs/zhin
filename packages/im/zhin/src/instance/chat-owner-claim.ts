/**
 * ADR 0060 §3.3: the claim code — the first global `owner` without a Console.
 *
 * - Active only while no global `owner` grant exists and grants can be saved (relational project
 *   database). The code is written only to `.zhin/chat-owner-claim.json` (mode 0600, read by
 *   `zhin status`) — never into the log (SystemLog is readable in the Console with `status.view`),
 *   never into chat, never into the Console. The log names the hash prefix only. Whoever reads the
 *   file can already read the host's files; project file routes refuse dot directories.
 * - One-time: a successful claim, any global owner granted elsewhere, or the instance exiting ends
 *   it; every start rotates it. Five wrong attempts rotate it as well, but one sender counts for
 *   at most {@link CHAT_OWNER_CLAIM_MAX_SENDER_FAILURES} of them per window: after that its
 *   attempts are refused (`locked`) without being counted, so no single sender can keep rotating it.
 * - Accepted only in a private chat (ADR 0060 Q8) on a real platform adapter, where the bare form
 *   `认领 <码>` / `claim <code>` works without the adapter's command prefix (#1250; the prefixed command
 *   still works): a correct code sent
 *   in a group is burnt and rotated (bystanders saw it); adapters whose capability profile marks a
 *   local simulation (`runtime.sandbox`, clients pick their own sender id) never accept it.
 * - Audited as `chat-roles.claim`; the audit and logs of attempts carry only the first 8 hex digits
 *   of the code's SHA-256, never the code.
 * - Kept out of chat (#1250): {@link createChatOwnerClaimGuard} takes every claim-shaped message
 *   (`matchChatOwnerClaimText`: keyword first, then exactly one token) at the start of inbound, with or
 *   without a prefix and whether or not a command matches — only while a code is open (in any
 *   conversation). Such a message is never recorded, logged, traced or handed to the
 *   Agent; it gets the claim reply (usage, refusal or result) only.
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { rmSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { commandFeatureId, defineCommand, type CommandContext } from '@zhin.js/command';
import { matchChatOwnerClaimText } from '@zhin.js/kernel';
import { createMessages, type Locale, type SnapshotReader } from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import type { ChatIdentity } from '@zhin.js/core';
import type { InboundSecretGuard, Message } from '@zhin.js/core/runtime';
import type { InstanceChatRoleService } from './chat-roles.js';
import {
  chatRoleMigrationAdapterKinds, type ChatRoleAudit, type ChatRoleMigrationAdapterKind, type ChatRoleMigrationLogger,
} from './chat-role-migration.js';
import { featureChatActor, featureChatTokens } from './feature-self-service.js';

/** Read by `zhin status` (`basic/cli`, which cannot import this module: keep the path in sync). */
export const CHAT_OWNER_CLAIM_FILE = join('.zhin', 'chat-owner-claim.json');
/** Wrong attempts before a code is rotated. */
export const CHAT_OWNER_CLAIM_MAX_FAILURES = 5;
/** Wrong attempts one sender may make per window; more are refused without counting. */
export const CHAT_OWNER_CLAIM_MAX_SENDER_FAILURES = 2;
/** Window of the per-sender limit. */
export const CHAT_OWNER_CLAIM_SENDER_WINDOW_MS = 10 * 60_000;
/** 32 symbols without 0 / O / 1 / I: 8 symbols = 40 bits. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export function generateChatOwnerClaimCode(): string {
  let code = '';
  for (let index = 0; index < CODE_LENGTH; index += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** First 8 hex digits of the code's SHA-256 (what logs and the audit may carry). */
export function chatOwnerClaimCodeHash(code: string): string {
  return createHash('sha256').update(code).digest('hex').slice(0, 8);
}

const normalizeCode = (text: string) => text.toUpperCase().replace(/[\s-]/gu, '');

function sameCode(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Whether any global `owner` grant exists. */
export function hasGlobalOwner(roles: Pick<InstanceChatRoleService, 'store'>): boolean {
  return roles.store.list().some(entry => entry.level === 'global' && entry.role === 'owner');
}

export type ChatOwnerClaimOutcome =
  /** A global owner exists, or claims are not open (no relational database). */
  | 'inactive'
  /** Not a private chat (a correct code was burnt). */
  | 'not-private'
  /** A local simulation adapter, or an adapter whose kind is unknown. */
  | 'simulated'
  | 'invalid'
  /** This sender made too many wrong attempts in the window. */
  | 'locked'
  | 'unpersisted'
  | 'claimed';

export interface ChatOwnerClaimAttempt {
  readonly code: string;
  readonly identity: ChatIdentity;
  readonly kind: 'private' | 'group' | 'channel';
  readonly adapterKind: ChatRoleMigrationAdapterKind;
}

export interface ChatOwnerClaimOptions {
  readonly roles: InstanceChatRoleService;
  /** Where `.zhin/chat-owner-claim.json` is written; omitted: log only (tests). */
  readonly projectRoot?: string;
  readonly logger: ChatRoleMigrationLogger;
  readonly audit?: () => ChatRoleAudit | undefined;
  readonly code?: () => string;
  readonly now?: () => number;
  readonly pid?: number;
}

/** Process-wide claim state; {@link refresh} after the role store loaded. */
export class ChatOwnerClaim {
  readonly #options: ChatOwnerClaimOptions;
  #code: string | undefined;
  #failures = 0;
  /** Wrong attempts per sender identity in the current window. */
  readonly #senderFailures = new Map<string, { count: number; since: number }>();
  #unsubscribe: (() => void) | undefined;
  #exitHook: (() => void) | undefined;

  constructor(options: ChatOwnerClaimOptions) { this.#options = options; }

  get active(): boolean { return this.#code !== undefined; }

  get #file(): string | undefined {
    return this.#options.projectRoot ? join(this.#options.projectRoot, CHAT_OWNER_CLAIM_FILE) : undefined;
  }

  /** Opens a claim when no global owner exists (rotating nothing that is already open), closes it otherwise. */
  async refresh(): Promise<void> {
    this.#unsubscribe ??= this.#options.roles.store.subscribe(change => {
      // Merges and splits never change whether a global owner exists.
      if (!('level' in change) || change.level !== 'global') return;
      void this.refresh().catch(() => undefined);
    });
    if (hasGlobalOwner(this.#options.roles) || !this.#options.roles.store.persistent) {
      await this.close();
      return;
    }
    if (!this.#code) await this.rotate();
  }

  /** A fresh code (logged and written for `zhin status`); the previous one stops working. */
  async rotate(): Promise<void> {
    const code = (this.#options.code ?? generateChatOwnerClaimCode)();
    this.#code = code;
    this.#failures = 0;
    const file = this.#file;
    // Never the code itself: the log reaches SystemLog and `GET /logs`.
    this.#options.logger.warn(`聊天角色：还没有全局 owner（聊天主人）。认领码见 zhin status（或本机 ${CHAT_OWNER_CLAIM_FILE}），`
      + `哈希前缀 ${chatOwnerClaimCodeHash(code)}；在私聊中直接向机器人发送「认领 <码>」（不需要命令前缀）即成为全局 owner。认领码一次性，实例重启后轮换。`
      + '也可以在 Console「聊天角色」页授予全局 owner。'
      + ` (No global chat owner yet: the claim code is shown by zhin status; hash prefix ${chatOwnerClaimCodeHash(code)}.)`);
    if (!file) return;
    try {
      await mkdir(dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify({ version: 1, code, pid: this.#options.pid ?? process.pid,
        createdAt: (this.#options.now ?? Date.now)() })}\n`, { encoding: 'utf8', mode: 0o600 });
      await rename(temp, file);
      if (!this.#exitHook) {
        this.#exitHook = () => { try { rmSync(file, { force: true }); } catch { /* best effort */ } };
        process.once('exit', this.#exitHook);
      }
    } catch (error) {
      this.#options.logger.warn(`聊天角色：认领码未能写入 ${CHAT_OWNER_CLAIM_FILE}（${(error as Error).message}），本次无法认领；`
        + '请在 Console「聊天角色」页授予全局 owner，或修复目录权限后重启实例。');
    }
  }

  /** Ends the claim and removes the local file. */
  async close(): Promise<void> {
    this.#code = undefined;
    this.#failures = 0;
    this.#senderFailures.clear();
    const file = this.#file;
    if (file) await rm(file, { force: true }).catch(() => undefined);
    if (this.#exitHook) { process.removeListener('exit', this.#exitHook); this.#exitHook = undefined; }
  }

  /** Stops listening and removes the local file. */
  async dispose(): Promise<void> {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    await this.close();
  }

  #audit(attempt: ChatOwnerClaimAttempt, outcome: 'ok' | 'denied' | 'error', reason: string, code: string): void {
    try {
      this.#options.audit?.()?.({ actor: `chat:${attempt.identity.adapter}:${attempt.identity.userId}`, action: 'chat-roles.claim',
        target: 'global:', outcome, detail: Object.freeze({ reason, codeHash: chatOwnerClaimCodeHash(code) }) });
    } catch { /* audit never breaks a claim */ }
  }

  async attempt(attempt: ChatOwnerClaimAttempt): Promise<ChatOwnerClaimOutcome> {
    const current = this.#code;
    if (!current || hasGlobalOwner(this.#options.roles)) return 'inactive';
    const code = normalizeCode(attempt.code);
    const correct = sameCode(code, current);
    if (attempt.kind !== 'private') {
      this.#audit(attempt, 'denied', 'not-private', code);
      // Bystanders saw a correct code: burn it.
      if (correct) await this.rotate();
      return 'not-private';
    }
    if (attempt.adapterKind !== 'platform') {
      this.#audit(attempt, 'denied', 'simulated', code);
      return 'simulated';
    }
    const sender = `${attempt.identity.adapter}\u0000${attempt.identity.userId}`;
    const now = (this.#options.now ?? Date.now)();
    const senderFailures = this.#senderFailures.get(sender);
    if (senderFailures && now - senderFailures.since >= CHAT_OWNER_CLAIM_SENDER_WINDOW_MS) this.#senderFailures.delete(sender);
    if ((this.#senderFailures.get(sender)?.count ?? 0) >= CHAT_OWNER_CLAIM_MAX_SENDER_FAILURES) {
      this.#audit(attempt, 'denied', 'locked', code);
      return 'locked';
    }
    if (!correct) {
      const current = this.#senderFailures.get(sender) ?? { count: 0, since: now };
      current.count += 1;
      this.#senderFailures.set(sender, current);
      if (this.#senderFailures.size > 10_000) this.#senderFailures.delete(this.#senderFailures.keys().next().value!);
      this.#failures += 1;
      this.#audit(attempt, 'denied', 'invalid', code);
      if (this.#failures >= CHAT_OWNER_CLAIM_MAX_FAILURES) await this.rotate();
      return 'invalid';
    }
    if (!this.#options.roles.store.persistent) return 'unpersisted';
    // One-time: consumed before the write, so a concurrent second claim finds nothing.
    this.#code = undefined;
    try {
      await this.#options.roles.store.grant({ level: 'global', key: '', ...attempt.identity, role: 'owner',
        grantedBy: `claim:${attempt.identity.adapter}:${attempt.identity.userId}`.slice(0, 256) });
    } catch (error) {
      this.#audit(attempt, 'error', 'grant-failed', code);
      await this.rotate();
      throw error;
    }
    this.#audit(attempt, 'ok', 'claimed', code);
    await this.close();
    return 'claimed';
  }
}

const messages = createMessages({
  description: { 'zh-CN': '尚无聊天主人时，私聊发送认领码成为全局 owner', en: 'Become the global chat owner with the claim code (private chat, only while there is none)' },
  usage: { 'zh-CN': '用法：在私聊中直接发送「认领 <认领码>」（不需要命令前缀；码见 zhin status）', en: 'Usage: send 「claim <code>」 to the bot in a private chat (no command prefix needed; zhin status shows the code)' },
  inactive: { 'zh-CN': '当前不接受认领：本机器人已有主人，或认领未开启。请联系主人在 Console「聊天角色」页授予角色。', en: 'Claims are closed: this bot already has an owner, or claims are not open. Ask the owner to grant you a role in the Console (Chat roles).' },
  notPrivate: { 'zh-CN': '认领只接受私聊：请在私聊中直接向机器人发送「认领 <码>」。若刚才发送的是有效认领码，它已作废，新码见 zhin status。', en: 'Claims are accepted in private chats only: send 「claim <code>」 to the bot privately. If that was a valid code it has been revoked; zhin status shows the new one.' },
  simulated: { 'zh-CN': '这个适配器上不接受认领（模拟适配器的发言者 id 可由客户端自选）。请在真实平台私聊机器人。', en: 'Claims are not accepted on this adapter (a simulation lets clients choose the sender id). Message the bot privately on a real platform.' },
  invalid: { 'zh-CN': '认领码不正确或已失效。', en: 'The claim code is wrong or no longer valid.' },
  locked: { 'zh-CN': '错误次数过多，请 10 分钟后再试。', en: 'Too many wrong codes; try again in 10 minutes.' },
  unpersisted: { 'zh-CN': '未保存：聊天角色需要关系型项目数据库（sqlite / mysql / pg）。', en: 'Not saved: chat roles need a relational project database (sqlite / mysql / pg).' },
  claimed: { 'zh-CN': '认领成功：你（{identity}）现在是本机器人的全局 owner，认领码已失效。', en: 'Claimed: you ({identity}) are now the global owner of this bot; the code no longer works.' },
  unknownConversation: { 'zh-CN': '无法识别当前会话。', en: 'This conversation cannot be identified.' },
  failed: { 'zh-CN': '认领失败：{error}', en: 'Claim failed: {error}' },
});

/** Runs one `认领` / `claim` invocation and returns the reply text (normal send chain). */
export async function executeOwnerClaim(
  input: Readonly<{ code: string | undefined; actor: ReturnType<typeof featureChatActor>; adapterKind: ChatRoleMigrationAdapterKind; locale: Locale }>,
  claim: ChatOwnerClaim,
): Promise<string> {
  const { locale, actor } = input;
  if (!claim.active) return messages(locale, 'inactive');
  if (!actor) return messages(locale, 'unknownConversation');
  if (!input.code) return messages(locale, 'usage');
  let outcome: ChatOwnerClaimOutcome;
  try {
    outcome = await claim.attempt({ code: input.code, identity: actor.identity, kind: actor.kind, adapterKind: input.adapterKind });
  } catch (error) {
    return messages(locale, 'failed', { error: (error as Error).message });
  }
  switch (outcome) {
    case 'claimed': return messages(locale, 'claimed', { identity: `${actor.identity.adapter}:${actor.identity.userId}` });
    case 'not-private': return messages(locale, 'notPrivate');
    case 'simulated': return messages(locale, 'simulated');
    case 'invalid': return messages(locale, 'invalid');
    case 'locked': return messages(locale, 'locked');
    case 'unpersisted': return messages(locale, 'unpersisted');
    default: return messages(locale, 'inactive');
  }
}

/** Root command `claim` (alias `认领`); installed whenever commands are, replies by itself when closed. */
export function installChatOwnerClaim(options: Readonly<{ claim: ChatOwnerClaim; snapshots: SnapshotReader }>): RootResourceInstaller {
  return context => {
    if (!context.hasFeature?.(commandFeatureId)) return;
    context.addFeature(commandFeatureId, 'claim', defineCommand({
      description: messages('zh-CN', 'description'), descriptionI18n: { en: messages('en', 'description') },
      alias: ['认领'], options: {},
      execute: (command: CommandContext) => {
        const lease = options.snapshots.acquire();
        let actor: ReturnType<typeof featureChatActor>;
        let adapterKind: ChatRoleMigrationAdapterKind;
        try {
          actor = featureChatActor(lease.value, command.input);
          adapterKind = actor ? chatRoleMigrationAdapterKinds(lease.value)(actor.identity.adapter) : undefined;
        } finally { lease.release(); }
        const first = featureChatTokens(command).find((token): token is string => typeof token === 'string');
        return executeOwnerClaim({ code: first, actor, adapterKind, locale: command.locale }, options.claim);
      },
    }));
  };
}

/**
 * #1250: takes claim-shaped messages (`认领 <码>` / `claim <code>`, prefixed or not) before anything records,
 * logs or routes them, so a code never reaches the Agent, the conversation history or a trace. While a code
 * is open this applies in every conversation (a correct code sent in a group is still burnt); once a
 * global owner exists (or claims are not open) nothing is taken: such text goes to commands or the Agent
 * as usual, and only the writer-side backstop masks the token.
 */
export function createChatOwnerClaimGuard(options: Readonly<{ claim: ChatOwnerClaim }>): InboundSecretGuard {
  const guard: InboundSecretGuard = {
    match: ({ text, prefix, snapshot }) => {
      const found = matchChatOwnerClaimText(text, prefix);
      // Only while a code is open: afterwards there is nothing to leak, and such text is ordinary chat.
      if (!found || !options.claim.active) return undefined;
      return Object.freeze({
        name: 'claim',
        redacted: `${found.keyword} ***`,
        handle: (message: Message) => {
          const actor = featureChatActor(snapshot, message);
          const adapterKind = actor ? chatRoleMigrationAdapterKinds(snapshot)(actor.identity.adapter) : undefined;
          return executeOwnerClaim({ code: found.code, actor, adapterKind, locale: message.locale }, options.claim);
        },
      });
    },
  };
  return Object.freeze(guard);
}
