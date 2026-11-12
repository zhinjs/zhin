/**
 * PermissionHost — 统一鉴权面。
 *
 * 解析顺序：builtin（会话、聊天角色、平台身份，ADR 0056 §5）→ 自定义 register → deny。
 */

import type { PermissionSubject } from './subject.js';
import { checkBuiltinPermit, isBuiltinPermit } from './builtin.js';

export type PermissionChecker = (
  name: string,
  subject: PermissionSubject,
) => boolean | Promise<boolean>;

export class PermissionHost {
  readonly #customEntries: CustomEntry[] = [];

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
}

interface CustomEntry {
  readonly name: string | RegExp;
  readonly checker: PermissionChecker;
}

function normalizeMatcher(matcher: string | RegExp): string | RegExp {
  if (typeof matcher === 'string') return matcher;
  return new RegExp(matcher.source, matcher.flags.replace(/[gy]/gu, ''));
}
