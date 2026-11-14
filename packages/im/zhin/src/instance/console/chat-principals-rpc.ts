/**
 * ADR 0060 §7: `chat-principals.*` and `chat-identities.*` Console RPC.
 *
 * Thresholds (on top of the route's permission map):
 * - reading (`list`, `get`, `chat-identities.recent`): `iam.manage` at the requested scope; only
 *   identities on adapters the caller manages are shown, grants outside the caller's scopes are
 *   redacted, and Console links only to global `iam.manage` holders;
 * - `merge` / `split` / `rename`: `iam.manage` on the adapter of every identity involved, and a
 *   **global** binding when a person involved holds a global grant (merging extends it to new
 *   identities, ADR 0060 §5.2);
 * - `link-console` / `unlink-console` / `export` / `import`: global `iam.manage` (§2.4, §4.5);
 * - `chat-identities.bind-code.create` / `me`: the caller's own link only (`self.chat-identity`).
 *
 * Without a relational project database writes are refused (503 `chat-roles-unpersisted`).
 */
import {
  CHAT_PRINCIPALS_RPC, isConsoleChatPrincipalsRpcType,
  type ConsoleChatIdentity, type ConsoleChatPrincipal, type ConsoleChatPrincipalsRpcType, type ConsoleChatRoleEntry,
  type ConsoleFeatureLevel,
} from '@zhin.js/console-protocol';
import {
  chatRoleEntryPrincipalId, chatScopeAdapter, chatScopeCovers, implicitChatPrincipalId, isChatIdentity, normalizeChatRoleScope,
  type ChatIdentity, type ChatRoleEntry,
} from '@zhin.js/core';
import { ChatPeopleError, type ChatPeople, type ChatPrincipalRef } from '../chat-people.js';
import { CHAT_IDENTITY_RETENTION_MS, isChatPrincipalId, type StoredChatIdentity } from '../chat-principals.js';
import { ChatRoleStorageUnavailableError } from '../chat-roles.js';
import { hasGlobalOwner } from '../chat-owner-claim.js';
import type { ChatIdentityBindCodes } from '../chat-identity-bind.js';
import { chatRoleView } from './chat-roles-rpc.js';
import { FeatureRpcError, readScope, type FeatureRpcReply } from './console-feature-rpc.js';

export interface ChatPrincipalsRpcAuthorization {
  readonly type: ConsoleChatPrincipalsRpcType;
  readonly level: ConsoleFeatureLevel;
  readonly key?: string;
}

export interface ChatPrincipalsRpcContext {
  readonly people?: ChatPeople;
  readonly codes?: ChatIdentityBindCodes;
  /** `iam.manage` at a scope (adapter / endpoint bindings count under them). Deny by default. */
  readonly authorize?: (request: ChatPrincipalsRpcAuthorization) => boolean | Promise<boolean>;
  /** The signed-in Console user (self operations); absent for the bootstrap principal. */
  readonly consoleUser?: Readonly<{ userId: string; displayName?: string }>;
  readonly actor?: string;
  readonly publishEvent?: (type: string, data: unknown) => void;
  readonly now?: () => number;
}

type Record_ = Record<string, unknown>;
const record = (value: unknown): value is Record_ => !!value && typeof value === 'object' && !Array.isArray(value);
const identityKey = (identity: ChatIdentity) => `${identity.adapter}\u0000${identity.userId}`;

/** `user:<id>` / `console:user:<id>` → the Console user id. */
export function consoleUserOfGrantor(grantedBy: string): string | undefined {
  const match = /^(?:console:)?user:(.+)$/u.exec(grantedBy);
  return match?.[1];
}

/** ADR 0060 Q12: the linked person's name, else the cached Console display name. */
export function chatGrantorName(people: ChatPeople | undefined, grantedBy: string): string | undefined {
  const user = consoleUserOfGrantor(grantedBy);
  if (!people || !user) return undefined;
  const link = people.store.principals.linkOfConsoleUser(user);
  if (!link) return undefined;
  return people.store.principals.stored(link.principalId)?.displayName ?? link.consoleDisplayName;
}

function redactedView(entry: ChatRoleEntry): ConsoleChatRoleEntry {
  return Object.freeze({ level: entry.level, key: entry.key, role: entry.role, source: entry.source, redacted: true as const });
}

function identityView(identity: StoredChatIdentity | ChatIdentity, now: number): ConsoleChatIdentity {
  const stored = identity as StoredChatIdentity;
  const recent = stored.lastSeenAt !== undefined && now - stored.lastSeenAt < CHAT_IDENTITY_RETENTION_MS;
  return Object.freeze({ adapter: identity.adapter, userId: identity.userId,
    ...(stored.linkMethod ? { linkMethod: stored.linkMethod } : {}), ...(stored.linkedAt ? { linkedAt: stored.linkedAt } : {}),
    ...(recent ? { lastSeenAt: stored.lastSeenAt! } : {}), ...(recent && stored.lastDisplayName ? { lastDisplayName: stored.lastDisplayName } : {}) });
}

function readIdentityInput(input: Record_): ChatIdentity {
  const identity = { adapter: input.adapter, userId: input.userId };
  if (!isChatIdentity(identity)) throw new FeatureRpcError(400, 'adapter 必须是适配器实例别名，userId 必须是平台用户 id');
  return { adapter: identity.adapter, userId: identity.userId };
}

function readRef(value: unknown, field: string): ChatPrincipalRef {
  if (!record(value)) throw new FeatureRpcError(400, `${field} 必须是 { principalId } 或 { adapter, userId }`);
  if (value.principalId !== undefined) {
    if (!isChatPrincipalId(value.principalId)) throw new FeatureRpcError(400, `${field}.principalId 无效`);
    return { principalId: value.principalId };
  }
  return readIdentityInput(value);
}

/** Dispatches `chat-principals.*` / `chat-identities.*`; null means the type belongs elsewhere. */
export async function dispatchChatPrincipalsConsoleRpc(message: Record_, context: ChatPrincipalsRpcContext): Promise<FeatureRpcReply | null> {
  const type = message.type;
  if (!isConsoleChatPrincipalsRpcType(type)) return null;
  const input = record(message.data) ? message.data : message;
  const now = (context.now ?? Date.now)();
  const actor = context.actor ?? 'console';
  try {
    const people = context.people;
    if (!people) throw new FeatureRpcError(503, '聊天身份不可用');
    const store = people.store;
    const principals = store.principals;
    const cache = new Map<string, boolean>();
    const allowed = async (level: ConsoleFeatureLevel, key?: string): Promise<boolean> => {
      const id = `${level}\u0000${key ?? ''}`;
      if (cache.has(id)) return cache.get(id)!;
      let ok: boolean;
      try { ok = context.authorize ? await context.authorize({ type, level, ...(key ? { key } : {}) }) === true : false; } catch { ok = false; }
      cache.set(id, ok);
      return ok;
    };
    const requireGlobal = async (what: string) => {
      if (!(await allowed('global'))) throw new FeatureRpcError(403, `${what}需要全局 iam.manage 权限`);
    };
    const managesAdapter = (alias: string) => allowed('adapter', alias);
    const requireAdapters = async (identities: readonly ChatIdentity[]) => {
      for (const alias of new Set(identities.map(identity => identity.adapter))) {
        if (!(await managesAdapter(alias))) throw new FeatureRpcError(403, `没有适配器 ${alias} 上的 iam.manage 权限`);
      }
    };
    const grantorName = (grantedBy: string) => chatGrantorName(people, grantedBy);

    /** View of a person (stored id) or of an identity's implicit person. */
    const view = async (principalId: string | undefined, implicit?: ChatIdentity, scopeAdapter?: string): Promise<ConsoleChatPrincipal | undefined> => {
      const stored = principalId ? principals.stored(principalId) : undefined;
      const identities: readonly (StoredChatIdentity | ChatIdentity)[] = stored
        ? principals.identitiesOf(stored.id)
        : implicit ? [principals.identity(implicit) ?? implicit] : [];
      const visible: (StoredChatIdentity | ChatIdentity)[] = [];
      for (const identity of identities) {
        if (scopeAdapter !== undefined && identity.adapter !== scopeAdapter) continue;
        if (await managesAdapter(identity.adapter)) visible.push(identity);
      }
      if (visible.length === 0) return undefined;
      const id = stored?.id ?? implicitChatPrincipalId(implicit!);
      const entries = store.list().filter(entry => chatRoleEntryPrincipalId(entry) === id);
      const roles = await Promise.all(entries.map(async entry =>
        await allowed(entry.level, entry.key || undefined) ? chatRoleView(entry, grantorName) : redactedView(entry)));
      const link = stored ? principals.linkOf(stored.id) : undefined;
      const global = await allowed('global');
      return Object.freeze({
        id,
        ...(stored?.displayName ? { displayName: stored.displayName } : {}),
        ...(stored?.createdBy ? { createdBy: stored.createdBy } : {}),
        ...(stored?.createdAt ? { createdAt: stored.createdAt } : {}),
        identities: Object.freeze(visible.map(identity => identityView(identity, now))),
        ...(identities.length > visible.length ? { hiddenIdentities: identities.length - visible.length } : {}),
        roles: Object.freeze(roles),
        ...(link && global ? { consoleLink: Object.freeze({ consoleUserId: link.consoleUserId,
          ...(link.consoleDisplayName ? { consoleDisplayName: link.consoleDisplayName } : {}), linkedAt: link.linkedAt, linkedVia: link.linkedVia }) } : {}),
        ...(identities.some(identity => (identity as StoredChatIdentity).linkMethod === 'manual') ? { unverified: true as const } : {}),
      });
    };
    const viewOfRef = async (ref: ChatPrincipalRef) => {
      const id = people.principalIdOf(ref);
      return id ? view(id) : 'principalId' in ref ? undefined : view(undefined, ref);
    };
    const identitiesOfRef = (ref: ChatPrincipalRef): readonly ChatIdentity[] => {
      const id = people.principalIdOf(ref);
      if (id) return principals.identitiesOf(id);
      if ('principalId' in ref) throw new FeatureRpcError(404, '没有这个人');
      return [ref];
    };
    const holdsGlobalRef = (ref: ChatPrincipalRef): boolean => {
      const id = people.principalIdOf(ref);
      // An identity without a stored person holds no grant (grants create the person).
      return id ? people.holdsGlobal(id) : false;
    };
    const changed = () => context.publishEvent?.('chat-principals:updated', {});

    let data: unknown;
    switch (type) {
      case CHAT_PRINCIPALS_RPC.LIST: {
        const scope = input.level === undefined ? { level: 'global' as const } : readScope(input);
        if (!(await allowed(scope.level, scope.key))) throw new FeatureRpcError(403, '没有 iam.manage 权限');
        const scopeAdapter = scope.key ? chatScopeAdapter(scope.key) : undefined;
        const views: ConsoleChatPrincipal[] = [];
        for (const stored of principals.principals()) {
          const principal = await view(stored.id, undefined, scopeAdapter);
          if (principal) views.push(principal);
        }
        // Identities holding a grant without a stored person (memory-only seed).
        const seen = new Set<string>();
        for (const entry of store.list()) {
          if (entry.principalId || seen.has(identityKey(entry))) continue;
          seen.add(identityKey(entry));
          const principal = await view(undefined, entry, scopeAdapter);
          if (principal) views.push(principal);
        }
        data = Object.freeze({ principals: Object.freeze(views) });
        break;
      }
      case CHAT_PRINCIPALS_RPC.GET: {
        const ref = input.principalId !== undefined ? readRef({ principalId: input.principalId }, 'principalId') : readIdentityInput(input);
        const principal = await viewOfRef(ref);
        if (!principal) throw new FeatureRpcError(404, '没有这个人，或不在你管理的适配器上');
        data = Object.freeze({ principal });
        break;
      }
      case CHAT_PRINCIPALS_RPC.MERGE: {
        const into = readRef(input.into, 'into');
        const from = readRef(input.from, 'from');
        await requireAdapters([...identitiesOfRef(into), ...identitiesOfRef(from)]);
        // §5.2: merging a person that holds a global grant extends it to new identities.
        if (holdsGlobalRef(into) || holdsGlobalRef(from)) await requireGlobal('归并持有全局角色的人');
        const result = await people.merge({ into, from, actor });
        const principal = await view(result.principalId);
        data = Object.freeze({ status: result.status, ...(principal ? { principal } : {}) });
        if (result.status === 'saved') changed();
        break;
      }
      case CHAT_PRINCIPALS_RPC.SPLIT: {
        const identity = readIdentityInput(input);
        const owner = principals.principalOf(identity);
        if (!owner) throw new FeatureRpcError(404, '这个身份还不属于任何人');
        await requireAdapters(owner.identities);
        if (people.holdsGlobal(owner.id)) await requireGlobal('拆分持有全局角色的人');
        const result = await people.split({ identity, actor });
        const principal = result.principalId ? await view(result.principalId) : undefined;
        data = Object.freeze({ status: result.status, ...(principal ? { principal } : {}) });
        if (result.status === 'saved') changed();
        break;
      }
      case CHAT_PRINCIPALS_RPC.RENAME: {
        if (!isChatPrincipalId(input.principalId)) throw new FeatureRpcError(400, 'principalId 无效');
        if (typeof input.displayName !== 'string' || input.displayName.length > 256) throw new FeatureRpcError(400, 'displayName 必须是字符串');
        if (!principals.stored(input.principalId)) throw new FeatureRpcError(404, '没有这个人');
        await requireAdapters(principals.identitiesOf(input.principalId));
        if (people.holdsGlobal(input.principalId)) await requireGlobal('改名持有全局角色的人');
        const status = await people.rename({ principalId: input.principalId, displayName: input.displayName, actor });
        data = Object.freeze({ status, principal: await view(input.principalId) });
        if (status === 'saved') changed();
        break;
      }
      case CHAT_PRINCIPALS_RPC.LINK_CONSOLE: {
        await requireGlobal('链接 Console 用户');
        if (!isChatPrincipalId(input.principalId)) throw new FeatureRpcError(400, 'principalId 无效');
        if (typeof input.consoleUserId !== 'string' || !input.consoleUserId || input.consoleUserId.length > 128) throw new FeatureRpcError(400, 'consoleUserId 无效');
        const result = await people.linkConsole({ principal: { principalId: input.principalId }, consoleUserId: input.consoleUserId,
          ...(typeof input.consoleDisplayName === 'string' ? { consoleDisplayName: input.consoleDisplayName } : {}), via: 'manual', actor });
        data = Object.freeze({ status: result.status, principal: await view(result.principalId) });
        if (result.status === 'saved') changed();
        break;
      }
      case CHAT_PRINCIPALS_RPC.UNLINK_CONSOLE: {
        await requireGlobal('解除 Console 链接');
        const principalId = isChatPrincipalId(input.principalId) ? input.principalId : undefined;
        const consoleUserId = typeof input.consoleUserId === 'string' && input.consoleUserId ? input.consoleUserId : undefined;
        if (!principalId && !consoleUserId) throw new FeatureRpcError(400, '需要 principalId 或 consoleUserId');
        const status = await people.unlinkConsole({ ...(principalId ? { principalId } : {}), ...(consoleUserId ? { consoleUserId } : {}), actor });
        data = Object.freeze({ status });
        if (status === 'saved') changed();
        break;
      }
      case CHAT_PRINCIPALS_RPC.EXPORT: {
        await requireGlobal('导出聊天角色');
        data = people.export();
        break;
      }
      case CHAT_PRINCIPALS_RPC.IMPORT: {
        // Imports may carry owner grants: same threshold as granting owner (ADR 0056 §3).
        await requireGlobal('导入聊天角色');
        data = await people.import(input.data, actor);
        changed();
        context.publishEvent?.('chat-roles:updated', { level: 'global', key: '' });
        break;
      }
      case CHAT_PRINCIPALS_RPC.IDENTITIES_RECENT: {
        const { level, key } = readScope(input);
        let scope: string;
        try { scope = normalizeChatRoleScope(level, key ?? ''); } catch (error) { throw new FeatureRpcError(400, (error as Error).message); }
        if (!(await allowed(level, key))) throw new FeatureRpcError(403, '没有 iam.manage 权限');
        const limit = typeof input.limit === 'number' && Number.isInteger(input.limit) ? Math.min(Math.max(input.limit, 1), 200) : 50;
        const rows: ConsoleChatIdentity[] = [];
        const candidates = principals.identities()
          .filter(identity => identity.lastSeenAt !== undefined && now - identity.lastSeenAt < CHAT_IDENTITY_RETENTION_MS
            && identity.lastScopeKey !== undefined && (() => { try { return chatScopeCovers(scope, identity.lastScopeKey!); } catch { return false; } })())
          .sort((left, right) => right.lastSeenAt! - left.lastSeenAt!);
        for (const identity of candidates) {
          if (rows.length >= limit) break;
          if (!(await managesAdapter(identity.adapter))) continue;
          rows.push(Object.freeze({ ...identityView(identity, now), principalId: identity.principalId ?? implicitChatPrincipalId(identity) }));
        }
        data = Object.freeze({ identities: Object.freeze(rows) });
        break;
      }
      case CHAT_PRINCIPALS_RPC.BIND_CODE_CREATE: {
        const user = context.consoleUser;
        if (!user) throw new FeatureRpcError(403, '需要以 Console 用户身份登录');
        if (!context.codes) throw new FeatureRpcError(503, '绑定码不可用');
        store.assertPersistent();
        const created = context.codes.create({ consoleUserId: user.userId, ...(user.displayName ? { consoleDisplayName: user.displayName } : {}),
          canManageGlobal: await allowed('global') });
        data = created;
        break;
      }
      case CHAT_PRINCIPALS_RPC.ME: {
        const user = context.consoleUser;
        if (!user) throw new FeatureRpcError(403, '需要以 Console 用户身份登录');
        people.touchConsoleUser(user.userId, user.displayName);
        const link = principals.linkOfConsoleUser(user.userId);
        const stored = link ? principals.stored(link.principalId) : undefined;
        const pending = context.codes?.pending(user.userId);
        const global = await allowed('global');
        let principal: ConsoleChatPrincipal | undefined;
        if (stored) {
          // The caller's own person: every identity and grant, whatever their Console scopes.
          principal = Object.freeze({ id: stored.id, ...(stored.displayName ? { displayName: stored.displayName } : {}),
            identities: Object.freeze(principals.identitiesOf(stored.id).map(identity => identityView(identity, now))),
            roles: Object.freeze(store.grantsOf(stored.id).map(entry => chatRoleView(entry, grantorName))),
            consoleLink: Object.freeze({ consoleUserId: link!.consoleUserId, ...(link!.consoleDisplayName ? { consoleDisplayName: link!.consoleDisplayName } : {}),
              linkedAt: link!.linkedAt, linkedVia: link!.linkedVia }) });
        }
        data = Object.freeze({ ...(principal ? { principal } : {}), ...(pending ? { pendingCode: Object.freeze({ expiresAt: pending }) } : {}),
          ...(principal && global && !hasGlobalOwner({ store }) ? { suggestGlobalOwner: true } : {}) });
        break;
      }
      default:
        throw new FeatureRpcError(400, '未知请求');
    }
    return { status: 200, body: { success: true, data, type, requestId: message.requestId } };
  } catch (error) {
    if (error instanceof ChatRoleStorageUnavailableError) {
      return { status: 503, body: { success: false, code: error.code, error: error.message, type, requestId: message.requestId } };
    }
    if (error instanceof ChatPeopleError) {
      const status = error.code === 'not-found' ? 404 : error.code === 'conflict' ? 409 : 400;
      return { status, body: { success: false, error: error.message, type, requestId: message.requestId } };
    }
    const status = error instanceof FeatureRpcError ? error.status : 500;
    return { status, body: { success: false, error: error instanceof FeatureRpcError ? error.message : '聊天身份操作失败', type, requestId: message.requestId } };
  }
}
