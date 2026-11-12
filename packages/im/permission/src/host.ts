/**
 * PermissionHost — 统一鉴权面。
 *
 * 解析顺序：builtin（会话、发言者 zhin 角色、发言者平台身份、机器人自身平台身份，ADR 0056 §5）
 * → 自定义 register → deny。命令、中间件、Agent 工具 / 技能与按钮回调共用这一个评估器。
 */

import type { PermissionPlatformStanding, PermissionSubject } from './subject.js';
import { normalizePermissionStanding } from './subject.js';
import { checkBuiltinPermit, isBuiltinPermit, permitsNeedBotStanding } from './builtin.js';

/**
 * Resolves the receiving Bot account's own standing in the source's conversation (ADR 0056 §1).
 * `cachedOnly`: answer from the cache, never start a platform lookup (middleware gates).
 * Undefined / throwing = unknown, so every `bot:*` permit fails.
 */
export type BotStandingResolver = (
  source: unknown,
  options: Readonly<{ cachedOnly?: boolean; signal?: AbortSignal }>,
) => PermissionPlatformStanding | undefined | Promise<PermissionPlatformStanding | undefined>;

export interface PermissionCheckOptions {
  /** Original message-like input; lets the host resolve `subject.bot` for `bot:*` permits. */
  readonly source?: unknown;
  readonly cachedOnly?: boolean;
  readonly signal?: AbortSignal;
}

export type PermissionChecker = (
  name: string,
  subject: PermissionSubject,
) => boolean | Promise<boolean>;

export class PermissionHost {
  readonly #customEntries: CustomEntry[] = [];
  #botStanding: BotStandingResolver | undefined;

  /** Installs the resolver of `subject.bot` (the IM Runtime does, over the Adapter index cache). */
  setBotStandingResolver(resolver: BotStandingResolver): () => void {
    this.#botStanding = resolver;
    return () => { if (this.#botStanding === resolver) this.#botStanding = undefined; };
  }

  /**
   * Returns `subject` with `bot` filled when a permit needs it, it is not set yet and a resolver
   * and source exist. Resolution failures leave `bot` unset (fail closed).
   */
  async withBotStanding(permits: readonly string[], subject: PermissionSubject, options: PermissionCheckOptions = {}): Promise<PermissionSubject> {
    if (subject.bot || options.source === undefined || !this.#botStanding || !permitsNeedBotStanding(permits)) return subject;
    let bot: PermissionPlatformStanding | undefined;
    try {
      bot = normalizePermissionStanding(await this.#botStanding(options.source, {
        ...(options.cachedOnly ? { cachedOnly: true } : {}), ...(options.signal ? { signal: options.signal } : {}),
      }));
    } catch { bot = undefined; }
    return bot ? Object.freeze({ ...subject, bot }) : subject;
  }

  /** First permit that fails (AND order), or undefined when all pass. */
  async firstDenied(permits: readonly string[], subject: PermissionSubject, options: PermissionCheckOptions = {}): Promise<string | undefined> {
    const prepared = await this.withBotStanding(permits, subject, options);
    for (const permit of permits) {
      if (!(await this.check(permit, prepared))) return permit;
    }
    return undefined;
  }

  /**
   * 检查单条 permit 是否通过。
   * 解析顺序：builtin → custom → deny。
   */
  async check(name: string, subject: PermissionSubject): Promise<boolean> {
    if (isBuiltinPermit(name)) {
      return checkBuiltinPermit(name, subject);
    }

    for (const entry of this.#customEntries) {
      const matches = typeof entry.name === 'string'
        ? entry.name === name
        : entry.name.test(name);
      if (matches && await entry.checker(name, subject)) return true;
    }

    return false;
  }

  /**
   * AND 检查多条 permit。
   */
  async checkAll(permits: readonly string[], subject: PermissionSubject, options: PermissionCheckOptions = {}): Promise<boolean> {
    return (await this.firstDenied(permits, subject, options)) === undefined;
  }

  /**
   * 注册自定义 checker（name 或 RegExp 匹配）。
   * 返回 dispose 函数。
   */
  register(
    name: string | RegExp,
    checker: PermissionChecker,
  ): () => void {
    const entry: CustomEntry = Object.freeze({ name: normalizeMatcher(name), checker });
    this.#customEntries.push(entry);
    return () => {
      const index = this.#customEntries.indexOf(entry);
      if (index >= 0) this.#customEntries.splice(index, 1);
    };
  }
}

interface CustomEntry {
  readonly name: string | RegExp;
  readonly checker: PermissionChecker;
}

function normalizeMatcher(matcher: string | RegExp): string | RegExp {
  if (typeof matcher === 'string') return matcher;
  return new RegExp(matcher.source, matcher.flags.replace(/[gy]/gu, ''));
}
