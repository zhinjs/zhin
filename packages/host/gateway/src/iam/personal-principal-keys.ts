/**
 * Usable keys for `ai.personalPrincipals` (#1250 `personal-principals-invalid-key-consumes-migration`).
 *
 * The configuration keys must be `user:<Console user id>` (ADR 0060 §4.1). The instance never
 * reads `.zhin/gateway.db` (ADR 0059 §1), so it cannot say which id a wrong key should have been;
 * the gateway can. The hints name Console users, so the gateway writes them to its own log only
 * (never to the instance log, which `status.view` holders read). They only **suggest** a key: nothing is imported from them, and a
 * username is never accepted as a key — usernames are free again once a user is deleted, so a
 * username key could later point at somebody else; user ids are random and never reused.
 */
import type { ConsoleUserView } from './service.js';

const USER_KEY = /^user:(.{1,128})$/u;

/** Holds the built-in `owner` role globally and is enabled. */
function isGlobalOwner(user: ConsoleUserView): boolean {
  return !user.disabled && user.bindings.some(binding => binding.role === 'owner' && binding.scope.kind === 'global');
}

const nameOf = (user: ConsoleUserView) => user.displayName && user.displayName !== user.username ? `${user.username}（${user.displayName}）` : user.username;

/**
 * One line per configured key that does not name an existing Console user, with the key to use
 * when it can be told: the user whose **username** the key spells, else the only global owner.
 * Keys that name an existing user id yield nothing.
 */
export function personalPrincipalKeyHints(keys: readonly string[], users: readonly ConsoleUserView[]): readonly string[] {
  const byId = new Map(users.map(user => [user.id, user] as const));
  const byName = new Map(users.map(user => [user.username, user] as const));
  const owners = users.filter(isGlobalOwner);
  const hints: string[] = [];
  for (const key of keys) {
    const id = USER_KEY.exec(key)?.[1];
    if (id !== undefined && byId.has(id)) continue;
    const head = `ai.personalPrincipals.${key}`;
    const problem = id === undefined ? '键不是 user:<Console 用户 id>' : `没有 id 为 ${id} 的 Console 用户`;
    const named = byName.get(id ?? key);
    if (named) {
      hints.push(`${head}：${problem}；${named.username} 是用户名，键要写用户 id（用户名删除后可被别人重新注册），可改为 user:${named.id}`);
    } else if (owners.length === 1) {
      hints.push(`${head}：${problem}；当前唯一的所有者是 ${nameOf(owners[0]!)}，可改为 user:${owners[0]!.id}`);
    } else if (users.length) {
      hints.push(`${head}：${problem}；共有 ${users.length} 个 Console 用户（${owners.length} 个所有者），用 zhin console user list 查看 id 后改为 user:<id>`);
    } else {
      hints.push(`${head}：${problem}；还没有 Console 用户，先运行 zhin console init 创建所有者，再改为 user:<id>`);
    }
  }
  return Object.freeze(hints);
}

/** The keys of `ai.personalPrincipals` in a configuration document (empty when absent). */
export function personalPrincipalKeysOf(document: unknown): readonly string[] {
  const ai = document && typeof document === 'object' ? (document as Record<string, unknown>).ai : undefined;
  const block = ai && typeof ai === 'object' ? (ai as Record<string, unknown>).personalPrincipals : undefined;
  return block && typeof block === 'object' && !Array.isArray(block) ? Object.freeze(Object.keys(block)) : Object.freeze([]);
}
