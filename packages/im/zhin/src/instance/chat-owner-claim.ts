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
import {
  containsChatOwnerClaimCode, createChatOwnerClaimCodeScanner, foldChatOwnerClaimText, matchChatOwnerClaimText, registerChatOwnerClaimCode,
} from '@zhin.js/kernel';
import { getLogger } from '@zhin.js/logger';
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

/**
 * The one code a claim text stands for (#1250: `认领:码`, `認領 码`, `ｃｌａｉｍ 码`, `认领码`, `AAAA 2222`,
 * trailing punctuation, zero-width characters): folded like `containsChatOwnerClaimCode` compares
 * (`foldChatOwnerClaimText`: NFKC, letter case, and the same gap characters — whitespace, `-`, `\p{Cf}`,
 * `\p{M}` — ignored), then punctuation around it and one leading keyword (`认领`, `认领码`, `claim`)
 * dropped. The whole remainder is compared, so a text compares exactly one candidate however long it is
 * (`认领 码 谢谢` or a long word carrying the code is not one code). Punctuation inside the remainder
 * (`ABCD.2345`) is kept: it separates symbols for the containment check as well, so text that grants
 * always carries the code (#1289 review).
 */
const normalizeCode = (text: string) => foldChatOwnerClaimText(text)
  .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  .replace(/^(?:认领|認領|CLAIM)(?:码|碼|CODE)?/u, '')
  .replace(/^[^\p{L}\p{N}]+/u, '');

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
  /** The text carried the current code but stood for more than one code (`认领 码 谢谢`, a long word): the code was revoked. */
  | 'revoked'
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
  /** Registration of the current code for the writer-side backstop (`redactChatOwnerClaimText`). */
  #unregisterCode: (() => void) | undefined;
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
    this.#unregisterCode?.();
    this.#unregisterCode = registerChatOwnerClaimCode(code);
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
    this.#unregisterCode?.();
    this.#unregisterCode = undefined;
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

  /** Whether `text` carries the current code (however it is written: case, gaps, full-width, zero-width). */
  carries(text: string): boolean {
    const current = this.#code;
    return current !== undefined && containsChatOwnerClaimCode(text, current);
  }

  /** Whether a native event payload carries the current code; see {@link inspectNativeClaimPayload}. */
  inspectNative(payload: unknown): NativeClaimInspection {
    const current = this.#code;
    return current === undefined ? 'clear' : inspectNativeClaimPayload(payload, current);
  }

  /** Revokes the current code when `text` carries it (a message others saw but no claim handled). */
  async revokeIfCarried(text: string): Promise<boolean> {
    if (!this.carries(text)) return false;
    this.#options.logger.warn('聊天角色：认领码出现在一条未处理的消息中（其他机器人发送、会话未就绪等），已作废；新码见 zhin status。');
    await this.rotate();
    return true;
  }

  async attempt(attempt: ChatOwnerClaimAttempt): Promise<ChatOwnerClaimOutcome> {
    const current = this.#code;
    if (!current || hasGlobalOwner(this.#options.roles)) return 'inactive';
    // Only exactly one code grants: one attempt compares one candidate, so the failure limits bound guessing.
    // Text that merely carries the current code (`认领 码 谢谢`, a long word with the code inside) revokes it
    // instead — granting on "contains" would let one message try thousands of candidates (#1289 review).
    const correct = sameCode(normalizeCode(attempt.code), current);
    const carried = !correct && containsChatOwnerClaimCode(attempt.code, current);
    // The audit and logs carry the hash of what was compared: the current code when it matched.
    const code = correct || carried ? current : normalizeCode(attempt.code);
    if (attempt.kind !== 'private') {
      this.#audit(attempt, 'denied', 'not-private', code);
      // Bystanders saw a correct code: burn it.
      if (correct || carried) await this.rotate();
      return 'not-private';
    }
    if (carried) {
      this.#audit(attempt, 'denied', 'revoked', code);
      await this.rotate();
      return 'revoked';
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
  usage: { 'zh-CN': '用法：在私聊中直接发送「认领 <认领码>」（不需要命令前缀；码见 zhin status）。码不对时回复「认领码不正确」并计入错误次数（同一发送者 10 分钟内最多 2 次，之后暂时锁定）。', en: 'Usage: send 「claim <code>」 to the bot in a private chat (no command prefix needed; zhin status shows the code). A wrong code is answered as wrong and counts as a failed attempt (2 per sender in 10 minutes, then locked for a while).' },
  inactive: { 'zh-CN': '当前不接受认领：本机器人已有主人，或认领未开启。请联系主人在 Console「聊天角色」页授予角色。', en: 'Claims are closed: this bot already has an owner, or claims are not open. Ask the owner to grant you a role in the Console (Chat roles).' },
  notPrivate: { 'zh-CN': '认领只接受私聊：请在私聊中直接向机器人发送「认领 <码>」。若刚才发送的是有效认领码，它已作废，新码见 zhin status。', en: 'Claims are accepted in private chats only: send 「claim <code>」 to the bot privately. If that was a valid code it has been revoked; zhin status shows the new one.' },
  simulated: { 'zh-CN': '这个适配器上不接受认领（模拟适配器的发言者 id 可由客户端自选）。请在真实平台私聊机器人。', en: 'Claims are not accepted on this adapter (a simulation lets clients choose the sender id). Message the bot privately on a real platform.' },
  invalid: { 'zh-CN': '认领码不正确或已失效。', en: 'The claim code is wrong or no longer valid.' },
  revoked: { 'zh-CN': '这条消息含有认领码，但不只是一个认领码（多了别的文字），码已作废。新码见 zhin status，请在私聊中只发送「认领 <码>」。', en: 'That message carried the claim code along with other text, so the code was revoked. zhin status shows the new one; send only 「claim <code>」 privately.' },
  locked: { 'zh-CN': '错误次数过多，请 10 分钟后再试。', en: 'Too many wrong codes; try again in 10 minutes.' },
  unpersisted: { 'zh-CN': '未保存：聊天角色需要关系型项目数据库（sqlite / mysql / pg）。', en: 'Not saved: chat roles need a relational project database (sqlite / mysql / pg).' },
  claimed: { 'zh-CN': '认领成功：你（{identity}）现在是本机器人的全局 owner，认领码已失效。', en: 'Claimed: you ({identity}) are now the global owner of this bot; the code no longer works.' },
  unknownConversation: { 'zh-CN': '无法识别当前会话。', en: 'This conversation cannot be identified.' },
  failed: { 'zh-CN': '认领失败：{error}', en: 'Claim failed: {error}' },
});

/**
 * How to claim, for replies and hints: in a private chat, without the command prefix. A message of the
 * claim shape (`认领 <一个词>`) sent privately with a wrong code is answered as wrong and counted
 * ({@link CHAT_OWNER_CLAIM_MAX_SENDER_FAILURES} per sender per window), exactly like the command.
 */
export function formatOwnerClaimUsage(locale: Locale): string {
  return messages(locale, 'usage');
}

/** Runs one `认领` / `claim` invocation and returns the reply text (normal send chain). */
export async function executeOwnerClaim(
  input: Readonly<{ code: string | undefined; actor: ReturnType<typeof featureChatActor>; adapterKind: ChatRoleMigrationAdapterKind; locale: Locale }>,
  claim: ChatOwnerClaim,
): Promise<string> {
  const { locale, actor } = input;
  if (!claim.active) return messages(locale, 'inactive');
  if (!actor) return messages(locale, 'unknownConversation');
  if (!input.code) return formatOwnerClaimUsage(locale);
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
    case 'revoked': return messages(locale, 'revoked');
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
 * #1250: recognizes, before anything records, logs or routes a message, the ones that carry the current
 * claim code — however written (`认领:码`, `認領 码`, `ｃｌａｉｍ 码`, `认领码`, `认领 码 谢谢`, `ABCD 2345`,
 * trailing punctuation; see `containsChatOwnerClaimCode`) — in any conversation, plus in private chats the
 * claim-shaped ones (`认领 <一个词>`) with a wrong code, which are answered and counted. Everything else
 * passes: `claim it` in a group goes to the Agent. Only text that stands for exactly the current
 * code (`normalizeCode`: `认领 <码>`, `认领:码`, the bare code, …) grants; any other text carrying it only revokes it, so one message
 * compares one candidate (#1289 review). Only while a code is open: once a global owner exists
 * (or claims are not open) nothing is taken and such text goes to commands or the Agent as usual.
 */
export function createChatOwnerClaimGuard(options: Readonly<{ claim: ChatOwnerClaim }>): InboundSecretGuard {
  const { claim } = options;
  const guard: InboundSecretGuard = {
    match: ({ text, prefix, conversation, snapshot }) => {
      if (!claim.active) return undefined;
      const carried = claim.carries(text);
      const shaped = matchChatOwnerClaimText(text, prefix);
      if (!carried && !(shaped && conversation.kind === 'private')) return undefined;
      return Object.freeze({
        name: 'claim',
        redacted: `${shaped?.keyword ?? '认领'} ***`,
        handle: (message: Message) => {
          const actor = featureChatActor(snapshot, message);
          const adapterKind = actor ? chatRoleMigrationAdapterKinds(snapshot)(actor.identity.adapter) : undefined;
          return executeOwnerClaim({ code: shaped ? shaped.code : text, actor, adapterKind, locale: message.locale }, claim);
        },
        discard: async () => { await claim.revokeIfCarried(text); },
      });
    },
    inspectNative: payload => {
      const inspection = claim.inspectNative(payload);
      if (inspection === 'exceeded') {
        nativeLogger.debug('聊天角色：认领开放期间，一个原生事件过大或无法完整检查，按含认领码处理（不派发）。'
          + ' (native event too large to inspect while a claim is open: withheld)');
      }
      return inspection !== 'clear';
    },
  };
  return Object.freeze(guard);
}

const nativeLogger = getLogger('instance.chat-owner-claim');

/**
 * What one native-event check reads at most (#1289 review). Beyond it the event counts as carrying
 * the code (`exceeded`, fail closed) instead of the rest going unchecked: a claim is open only until
 * the first owner exists, and withholding an oversized native event for that while is safer than
 * handing a code to native Handlers. Every string up to the budget is checked; nothing is skipped.
 */
export const CHAT_OWNER_CLAIM_NATIVE_LIMITS = Object.freeze({ depth: 32, values: 50_000, chars: 4_000_000 });

export type NativeClaimInspection = 'carried' | 'clear' | 'exceeded';

const utf8 = new TextDecoder('utf-8');

/**
 * Whether a native payload carries `code` (ADR 0060 §3.3): every string, number and byte buffer
 * (decoded as UTF-8) of every array, plain or class object (own enumerable values), Map and Set is
 * read, in order, through one `createChatOwnerClaimCodeScanner` (so a code split across neighbouring
 * strings is found too; each string is folded once, NFKC only when it is not ASCII). A getter that
 * throws, a structure deeper than {@link CHAT_OWNER_CLAIM_NATIVE_LIMITS} or more values or characters
 * than it allows: `exceeded`.
 */
export function inspectNativeClaimPayload(
  payload: unknown, code: string, limits: Readonly<{ depth: number; values: number; chars: number }> = CHAT_OWNER_CLAIM_NATIVE_LIMITS,
): NativeClaimInspection {
  const scanner = createChatOwnerClaimCodeScanner(code);
  const seen = new Set<object>();
  let values = 0;
  let chars = 0;
  const stack: [unknown, number][] = [[payload, 0]];
  while (stack.length > 0) {
    const [value, depth] = stack.pop()!;
    let text: string | undefined;
    if (typeof value === 'string') text = value;
    else if (typeof value === 'number' || typeof value === 'bigint') text = String(value);
    else if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      if (chars + value.byteLength > limits.chars) return 'exceeded';
      text = utf8.decode(value);
    }
    if (text !== undefined) {
      values += 1;
      chars += text.length;
      if (values > limits.values || chars > limits.chars) return 'exceeded';
      if (scanner.feed(text)) return 'carried';
      continue;
    }
    // Booleans, symbols, functions, null and undefined carry no text.
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    if (depth >= limits.depth) return 'exceeded';
    seen.add(value);
    values += 1;
    if (values > limits.values) return 'exceeded';
    let children: unknown[];
    try {
      children = value instanceof Map ? [...value].flat()
        : value instanceof Set ? [...value]
          : Array.isArray(value) ? [...value as unknown[]] : Object.values(value);
    } catch {
      // A getter (or proxy) that throws hides what it would return.
      return 'exceeded';
    }
    if (values + children.length > limits.values) return 'exceeded';
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push([children[index], depth + 1]);
  }
  return 'clear';
}
