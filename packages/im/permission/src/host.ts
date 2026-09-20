/**
 * PermissionHost — 统一鉴权面。
 *
 * 解析顺序：builtin → platform(adapter,perm) → 自定义 register → deny。
 */

import type { PermissionSubject } from './subject.js';
import {
  checkBuiltinPermit,
  isBuiltinPermit,
  isPlatformPermit,
  parsePlatformPermitName,
} from './builtin.js';

export type PermissionChecker = (
  name: string,
  subject: PermissionSubject,
) => boolean | Promise<boolean>;

export type PlatformPermitChecker = (
  perm: string,
  subject: PermissionSubject,
) => boolean | Promise<boolean>;

export class PermissionHost {
  readonly #customEntries: CustomEntry[] = [];
  readonly #platformCheckers = new Map<string, PlatformPermitChecker[]>();

  /**
   * 检查单条 permit 是否通过。
   * 解析顺序：builtin → platform → custom → deny。
   */
  async check(name: string, subject: PermissionSubject): Promise<boolean> {
    if (isBuiltinPermit(name)) {
      return checkBuiltinPermit(name, subject);
    }

    if (isPlatformPermit(name)) {
      const parsed = parsePlatformPermitName(name);
      if (!parsed) return false;
      if (subject.adapter !== undefined && subject.adapter !== parsed.adapter) {
        const last = subject.adapter.includes('/')
          ? subject.adapter.slice(subject.adapter.lastIndexOf('/') + 1)
          : subject.adapter;
        if (last !== parsed.adapter && !last.startsWith(`${parsed.adapter}-`)) return false;
      }
      const checkers = this.#platformCheckers.get(parsed.adapter);
      if (!checkers || checkers.length === 0) return false;
      return checkers[checkers.length - 1]!(parsed.perm, subject);
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
  async checkAll(permits: readonly string[], subject: PermissionSubject): Promise<boolean> {
    for (const permit of permits) {
      if (!(await this.check(permit, subject))) return false;
    }
    return true;
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

  /**
   * 注册平台级 checker。
   * 当 permit 为 `platform(adapter, perm)` 且 adapter 匹配时调用。
   */
  registerPlatform(
    adapter: string,
    checker: PlatformPermitChecker,
  ): () => void {
    const key = String(adapter);
    const list = this.#platformCheckers.get(key) ?? [];
    list.push(checker);
    this.#platformCheckers.set(key, list);
    return () => {
      const current = this.#platformCheckers.get(key);
      if (!current) return;
      const index = current.lastIndexOf(checker);
      if (index >= 0) current.splice(index, 1);
      if (current.length === 0) this.#platformCheckers.delete(key);
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
