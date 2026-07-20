/**
 * Platform permit — 适配器注册的平台级权限校验（场景治理、频道身份等）
 */
import type { Message } from '../message.js';
import { parsePlatformPermitName, isPlatformPermit } from './permit-parse.js';

export type PlatformPermitChecker = (
  perm: string,
  message: Message<any>,
) => boolean;

const checkers = new Map<string, PlatformPermitChecker[]>();
const defaultSceneRegistrations = new Map<string, {
  readonly checker: PlatformPermitChecker;
  readonly dispose: () => void;
  references: number;
}>();

export function registerPlatformPermitChecker(
  adapter: string,
  checker: PlatformPermitChecker,
): () => void {
  const key = String(adapter);
  const registrations = checkers.get(key) ?? [];
  registrations.push(checker);
  checkers.set(key, registrations);
  return () => {
    const current = checkers.get(key);
    if (!current) return;
    const index = current.lastIndexOf(checker);
    if (index >= 0) current.splice(index, 1);
    if (current.length === 0) checkers.delete(key);
  };
}

export function clearPlatformPermitCheckers(): void {
  checkers.clear();
  defaultSceneRegistrations.clear();
}

export function checkPlatformPermit(name: string, message: Message<any>): boolean {
  const parsed = parsePlatformPermitName(name);
  if (!parsed) return false;
  if (String(message.$adapter) !== parsed.adapter) return false;
  const registrations = checkers.get(parsed.adapter);
  const checker = registrations?.[registrations.length - 1];
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

/** 常见 IM 平台场景身份：$sender.role 为 owner / admin */
export function createSceneRolePlatformChecker(): PlatformPermitChecker {
  return (perm, message) => {
    const role = message.$sender?.role;
    if (perm === 'scene_admin') return role === 'admin' || role === 'owner';
    if (perm === 'scene_owner') return role === 'owner';
    return false;
  };
}

/** 为适配器注册默认场景治理 platform checker（幂等） */
export function registerDefaultScenePlatformPermitChecker(adapter: string): () => void {
  const key = String(adapter);
  const existing = defaultSceneRegistrations.get(key);
  if (existing) {
    existing.references += 1;
    return () => releaseDefaultSceneChecker(key, existing);
  }
  const checker = createSceneRolePlatformChecker();
  const registration = {
    checker,
    dispose: registerPlatformPermitChecker(key, checker),
    references: 1,
  };
  defaultSceneRegistrations.set(key, registration);
  return () => releaseDefaultSceneChecker(key, registration);
}

function releaseDefaultSceneChecker(
  key: string,
  registration: {
    readonly checker: PlatformPermitChecker;
    readonly dispose: () => void;
    references: number;
  },
): void {
  if (defaultSceneRegistrations.get(key) !== registration) return;
  registration.references -= 1;
  if (registration.references > 0) return;
  defaultSceneRegistrations.delete(key);
  registration.dispose();
}
