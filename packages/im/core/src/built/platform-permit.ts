/**
 * Platform permit — 适配器注册的平台级权限校验（群管、频道身份等）
 */
import type { Message } from '../message.js';
import { parsePlatformPermitName, isPlatformPermit } from './permit-parse.js';

export type PlatformPermitChecker = (
  perm: string,
  message: Message<any>,
) => boolean;

const checkers = new Map<string, PlatformPermitChecker>();
const registeredDefaultGroupCheckers = new Set<string>();

export function registerPlatformPermitChecker(
  adapter: string,
  checker: PlatformPermitChecker,
): () => void {
  const key = String(adapter);
  checkers.set(key, checker);
  return () => {
    if (checkers.get(key) === checker) {
      checkers.delete(key);
    }
  };
}

export function clearPlatformPermitCheckers(): void {
  checkers.clear();
  registeredDefaultGroupCheckers.clear();
}

export function checkPlatformPermit(name: string, message: Message<any>): boolean {
  const parsed = parsePlatformPermitName(name);
  if (!parsed) return false;
  if (String(message.$adapter) !== parsed.adapter) return false;
  const checker = checkers.get(parsed.adapter);
  if (!checker) return false;
  return checker(parsed.perm, message);
}

export function checkPlatformPermitList(
  permits: readonly string[],
  message: Message<any>,
): boolean {
  return permits.every((p) => isPlatformPermit(p) && checkPlatformPermit(p, message));
}

/** OneBot / QQ 系 sender.role 归一化 */
export function normalizeQqSenderRole(role?: string): 'owner' | 'admin' | undefined {
  if (!role || role === 'member') return undefined;
  if (role === 'owner' || role === 'admin') return role;
  return undefined;
}

/** 从 OneBot sender 对象写入 MessageSender.role / permissions */
export function applyQqSenderRoleToMessageSender(
  sender: { role?: string; permissions?: string[] },
  role?: string,
): void {
  const normalized = normalizeQqSenderRole(role);
  if (!normalized) return;
  sender.role = normalized;
  sender.permissions = [normalized];
}

/** 常见 IM 平台群身份：$sender.role 为 owner / admin */
export function createGroupRolePlatformChecker(): PlatformPermitChecker {
  return (perm, message) => {
    const role = message.$sender?.role;
    if (perm === 'group_admin') return role === 'admin' || role === 'owner';
    if (perm === 'group_owner') return role === 'owner';
    return false;
  };
}

/** 为适配器注册默认群管 platform checker（幂等） */
export function registerDefaultGroupPlatformPermitChecker(adapter: string): () => void {
  const key = String(adapter);
  if (registeredDefaultGroupCheckers.has(key)) {
    return () => {};
  }
  registeredDefaultGroupCheckers.add(key);
  return registerPlatformPermitChecker(key, createGroupRolePlatformChecker());
}
