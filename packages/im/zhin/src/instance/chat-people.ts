/**
 * ADR 0060 §2 / §4.5 / §5.2: operations on people — merge, split, rename, Console links, bind by
 * code, the sighting cache and export / import. Every write runs in the role store's queue
 * ({@link ChatRoleStore.exclusive}) because people and grants change together.
 *
 * Rules kept here (authorization thresholds are the callers'):
 * - one identity belongs to at most one person; one Console user links to at most one person and
 *   one person to at most one Console user (Q3);
 * - merging never lowers a grant (where both people hold a scope the higher role stays);
 * - a grant below global counts only for the person's identities on the scope's adapter (Q10), so a
 *   merge never extends it to another platform;
 * - imports only add or raise, never lower or remove, and never re-assign an identity that already
 *   belongs to another person.
 */
import {
  chatRoleEntryAppliesTo, isChatIdentity, isChatRole, normalizeChatRoleScope, type ChatIdentity,
} from '@zhin.js/core';
import type {
  ConsoleChatRolesExport, ConsoleChatRolesImportResult,
} from '@zhin.js/console-protocol';
import type { FeatureConfigLevel } from '@zhin.js/plugin-runtime';
import {
  CHAT_IDENTITY_SIGHTING_THROTTLE_MS, cleanChatDisplayName, isChatPrincipalId,
  type ChatConsoleLinkVia, type ChatIdentityLinkMethod,
} from './chat-principals.js';
import type { ChatRoleStore } from './chat-roles.js';
import type { ChatRoleAudit } from './chat-role-migration.js';

/** A person by id, or the person an identity belongs to. */
export type ChatPrincipalRef = Readonly<{ principalId: string }> | ChatIdentity;

export class ChatPeopleError extends Error {
  constructor(readonly code: 'not-found' | 'conflict' | 'invalid', message: string) {
    super(message);
    this.name = 'ChatPeopleError';
  }
}

export type ChatBindOutcome =
  /** The identity now belongs to the Console user's person. */
  | 'bound'
  /** It already did. */
  | 'unchanged'
  /** The identity belongs to a person linked to another Console user, or to a multi-identity person. */
  | 'owned-elsewhere'
  /** Binding would carry roles to another identity: needs an operator with global `iam.manage`. */
  | 'needs-admin';

export interface ChatPeopleOptions {
  readonly store: ChatRoleStore;
  readonly audit?: () => ChatRoleAudit | undefined;
  readonly now?: () => number;
}

const identityText = (identity: ChatIdentity) => `${identity.adapter}:${identity.userId}`;
const sameIdentity = (left: ChatIdentity, right: ChatIdentity) => left.adapter === right.adapter && left.userId === right.userId;

export class ChatPeople {
  readonly #store: ChatRoleStore;
  readonly #options: ChatPeopleOptions;
  /** identity → last written sighting (throttle). */
  readonly #sightings = new Map<string, { at: number; name?: string; scope?: string }>();

  constructor(options: ChatPeopleOptions) {
    this.#store = options.store;
    this.#options = options;
  }

  get store(): ChatRoleStore { return this.#store; }

  #now(): number { return (this.#options.now ?? Date.now)(); }

  #audit(entry: Parameters<ChatRoleAudit>[0]): void {
    try { this.#options.audit?.()?.(entry); } catch { /* audit never breaks an operation */ }
  }

  /** Whether the person holds any global grant (merging / renaming it needs global `iam.manage`). */
  holdsGlobal(principalId: string): boolean {
    return this.#store.grantsOf(principalId).some(entry => entry.level === 'global');
  }

  /** Stored person id of a ref, or undefined (an identity without a person). */
  principalIdOf(ref: ChatPrincipalRef): string | undefined {
    if ('principalId' in ref) return this.#store.principals.stored(ref.principalId) ? ref.principalId : undefined;
    return this.#store.principalOf(ref)?.id;
  }

  async #resolveUnlocked(ref: ChatPrincipalRef, by: string): Promise<string> {
    if ('principalId' in ref) {
      if (!isChatPrincipalId(ref.principalId) || !this.#store.principals.stored(ref.principalId)) throw new ChatPeopleError('not-found', '没有这个人');
      return ref.principalId;
    }
    if (!isChatIdentity(ref)) throw new ChatPeopleError('invalid', 'adapter 必须是适配器实例别名，userId 必须是平台用户 id');
    return this.#store.ensurePrincipalUnlocked(ref, { method: 'implicit', by });
  }

  /**
   * Moves every identity, grant and (when only `from` has one) the Console link of `from` to
   * `into`, then deletes `from`. Grants: where both hold a scope the higher role stays.
   */
  async #mergeUnlocked(into: string, from: string, method: ChatIdentityLinkMethod, by: string): Promise<readonly ChatIdentity[]> {
    const principals = this.#store.principals;
    const intoLink = principals.linkOf(into);
    const fromLink = principals.linkOf(from);
    if (intoLink && fromLink) throw new ChatPeopleError('conflict', '两个人都已链接 Console 用户，不能归并（一个人只能链接一个 Console 用户）');
    const moved = principals.identitiesOf(from).map(identity => Object.freeze({ adapter: identity.adapter, userId: identity.userId }));
    for (const identity of moved) await principals.assignIdentity(identity, into, { method, by });
    for (const entry of this.#store.grantsOf(from)) await this.#store.moveGrantUnlocked(entry, into);
    if (fromLink) {
      await principals.deleteLink(from);
      await principals.setLink({ principalId: into, consoleUserId: fromLink.consoleUserId,
        ...(fromLink.consoleDisplayName ? { consoleDisplayName: fromLink.consoleDisplayName } : {}), linkedVia: fromLink.linkedVia });
    }
    await principals.deletePrincipal(from);
    return moved;
  }

  async merge(input: Readonly<{ into: ChatPrincipalRef; from: ChatPrincipalRef; actor: string }>): Promise<Readonly<{ status: 'saved' | 'unchanged'; principalId: string }>> {
    const result = await this.#store.exclusive(async () => {
      this.#store.assertPersistent();
      const into = await this.#resolveUnlocked(input.into, input.actor);
      const from = await this.#resolveUnlocked(input.from, input.actor);
      if (into === from) return { status: 'unchanged' as const, principalId: into, moved: [] as readonly ChatIdentity[] };
      const moved = await this.#mergeUnlocked(into, from, 'manual', input.actor);
      return { status: 'saved' as const, principalId: into, moved, from };
    });
    if (result.status === 'saved') {
      this.#store.notify(Object.freeze({ kind: 'merge', principalId: result.principalId, from: result.from!, identities: Object.freeze(result.moved) }));
      this.#audit({ actor: input.actor, action: 'chat-principals.merge', target: result.principalId, outcome: 'ok',
        detail: Object.freeze({ from: result.from, identities: result.moved.map(identityText), linkMethod: 'manual' }) });
    }
    return Object.freeze({ status: result.status, principalId: result.principalId });
  }

  /**
   * ADR 0060 §4.1: identities a configuration list named once (`ai.trigger.masters: [id]` on every
   * adapter) are one person. Only people that hold exactly that identity and no Console link are
   * merged — an established person is never folded into another by configuration. Audited as a
   * merge with `link_method: import`.
   */
  async mergeConfigured(identities: readonly ChatIdentity[], actor: string): Promise<string | undefined> {
    const result = await this.#store.exclusive(async () => {
      if (identities.length < 2 || !this.#store.persistent) return undefined;
      const principals = this.#store.principals;
      const singles = identities.map(identity => principals.principalOf(identity))
        .filter((person): person is NonNullable<typeof person> => !!person && person.identities.length === 1 && !principals.linkOf(person.id));
      if (singles.length < 2) return undefined;
      const [into, ...rest] = singles;
      for (const from of rest) await this.#mergeUnlocked(into!.id, from.id, 'import', actor);
      return { into: into!.id, from: rest.map(person => person.id) };
    });
    if (!result) return undefined;
    for (const from of result.from) {
      this.#store.notify(Object.freeze({ kind: 'merge', principalId: result.into, from, identities: Object.freeze([]) }));
    }
    this.#audit({ actor, action: 'chat-principals.merge', target: result.into, outcome: 'ok',
      detail: Object.freeze({ from: result.from, identities: identities.map(identityText), linkMethod: 'import' }) });
    return result.into;
  }

  /**
   * Gives `identity` its own new person. The old person's global grants stay; its grants below
   * global on the identity's adapter move along when it keeps no other identity there (they could
   * count for nobody else). The dual-written identity of grants that stay is moved off it.
   */
  async split(input: Readonly<{ identity: ChatIdentity; actor: string }>): Promise<Readonly<{ status: 'saved' | 'unchanged'; principalId?: string; from?: string }>> {
    const result = await this.#store.exclusive(async () => {
      this.#store.assertPersistent();
      const principals = this.#store.principals;
      const from = principals.principalOf(input.identity);
      if (!from) throw new ChatPeopleError('not-found', '这个身份还不属于任何人');
      if (from.identities.length < 2) return { status: 'unchanged' as const, principalId: from.id };
      const rest = from.identities.filter(identity => !sameIdentity(identity, input.identity));
      const created = await principals.createPrincipal({ createdBy: input.actor });
      await principals.assignIdentity(input.identity, created, { method: 'manual', by: input.actor });
      for (const entry of this.#store.grantsOf(from.id)) {
        const applies = rest.filter(identity => chatRoleEntryAppliesTo(entry, identity));
        if (applies.length === 0) {
          // Below global on the split identity's adapter, and nobody else there: it goes with it.
          if (chatRoleEntryAppliesTo(entry, input.identity)) await this.#store.moveGrantUnlocked(entry, created);
          continue;
        }
        if (sameIdentity(entry, input.identity)) await this.#store.moveGrantUnlocked(entry, from.id, applies[0]);
      }
      return { status: 'saved' as const, principalId: created, from: from.id };
    });
    if (result.status === 'saved') {
      this.#store.notify(Object.freeze({ kind: 'split', principalId: result.principalId!, from: result.from!, identities: Object.freeze([Object.freeze({ ...input.identity })]) }));
      this.#audit({ actor: input.actor, action: 'chat-principals.split', target: result.principalId!, outcome: 'ok',
        detail: Object.freeze({ from: result.from, identity: identityText(input.identity) }) });
    }
    return Object.freeze(result);
  }

  async rename(input: Readonly<{ principalId: string; displayName: string; actor: string }>): Promise<'saved' | 'unchanged'> {
    const status = await this.#store.exclusive(async () => {
      this.#store.assertPersistent();
      if (!this.#store.principals.stored(input.principalId)) throw new ChatPeopleError('not-found', '没有这个人');
      return this.#store.principals.renamePrincipal(input.principalId, input.displayName);
    });
    if (status === 'saved') this.#audit({ actor: input.actor, action: 'chat-principals.rename', target: input.principalId, outcome: 'ok' });
    return status;
  }

  /** Operator link (`manual`) or import; one-to-one (Q3). */
  async linkConsole(input: Readonly<{ principal: ChatPrincipalRef; consoleUserId: string; consoleDisplayName?: string; via: ChatConsoleLinkVia; actor: string }>): Promise<Readonly<{ status: 'saved' | 'unchanged'; principalId: string }>> {
    if (!input.consoleUserId || input.consoleUserId.length > 128) throw new ChatPeopleError('invalid', 'consoleUserId 无效');
    const result = await this.#store.exclusive(async () => {
      this.#store.assertPersistent();
      const principalId = await this.#resolveUnlocked(input.principal, input.actor);
      const principals = this.#store.principals;
      const current = principals.linkOf(principalId);
      if (current?.consoleUserId === input.consoleUserId) return { status: 'unchanged' as const, principalId };
      if (current) throw new ChatPeopleError('conflict', '这个人已链接另一个 Console 用户；请先解除链接');
      if (principals.linkOfConsoleUser(input.consoleUserId)) throw new ChatPeopleError('conflict', '这个 Console 用户已链接另一个人；请先解除链接');
      await principals.setLink({ principalId, consoleUserId: input.consoleUserId,
        ...(input.consoleDisplayName ? { consoleDisplayName: input.consoleDisplayName } : {}), linkedVia: input.via });
      return { status: 'saved' as const, principalId };
    });
    if (result.status === 'saved') {
      this.#audit({ actor: input.actor, action: 'chat-principals.link-console', target: result.principalId, outcome: 'ok',
        detail: Object.freeze({ consoleUserId: input.consoleUserId, linkedVia: input.via }) });
    }
    return Object.freeze(result);
  }

  async unlinkConsole(input: Readonly<{ principalId?: string; consoleUserId?: string; actor: string; reason?: string }>): Promise<'saved' | 'unchanged'> {
    const removed = await this.#store.exclusive(async () => {
      const principals = this.#store.principals;
      const link = input.principalId ? principals.linkOf(input.principalId)
        : input.consoleUserId ? principals.linkOfConsoleUser(input.consoleUserId) : undefined;
      if (!link) return undefined;
      this.#store.assertPersistent();
      await principals.deleteLink(link.principalId);
      return link;
    });
    if (!removed) return 'unchanged';
    this.#audit({ actor: input.actor, action: 'chat-principals.unlink-console', target: removed.principalId, outcome: 'ok',
      detail: Object.freeze({ consoleUserId: removed.consoleUserId, ...(input.reason ? { reason: input.reason } : {}) }) });
    return 'saved';
  }

  /** ADR 0060 §2.4: the gateway deleted or disabled a Console user — its link goes (roles stay). */
  async consoleUserRemoved(consoleUserId: string, reason: string): Promise<'saved' | 'unchanged'> {
    if (!this.#store.principals.linkOfConsoleUser(consoleUserId)) return 'unchanged';
    return this.unlinkConsole({ consoleUserId, actor: 'gateway', reason });
  }

  /** Q12: refreshes the cached Console display name when that user calls the instance again. */
  touchConsoleUser(consoleUserId: string, displayName: string | undefined): void {
    const link = this.#store.principals.linkOfConsoleUser(consoleUserId);
    const name = cleanChatDisplayName(displayName);
    if (!link || !name || link.consoleDisplayName === name || !this.#store.persistent) return;
    void this.#store.exclusive(() => this.#store.principals.refreshConsoleDisplayName(consoleUserId, name)).catch(() => undefined);
  }

  /**
   * ADR 0060 §2.4 self-service bind: the holder of `identity` sent the Console user's code in a
   * private chat (the caller checked that). Without a person yet, the Console user is linked to
   * the identity's person; with one, the identity joins it. Refused when the identity belongs to
   * a person that is linked to someone else or has other identities, and — unless the code was
   * made by a holder of global `iam.manage` — when it would carry roles to another identity
   * (the identity's person holds grants, or the Console user's person holds grants that would
   * count for the identity).
   */
  async bindByCode(input: Readonly<{ consoleUserId: string; consoleDisplayName?: string; identity: ChatIdentity; canManageGlobal: boolean; codeHash: string }>): Promise<Readonly<{ outcome: ChatBindOutcome; principalId?: string }>> {
    const actor = `chat:${identityText(input.identity)}`;
    const result = await this.#store.exclusive(async (): Promise<{ outcome: ChatBindOutcome; principalId?: string; merged?: string }> => {
      this.#store.assertPersistent();
      const principals = this.#store.principals;
      const mine = principals.linkOfConsoleUser(input.consoleUserId)?.principalId;
      const owner = principals.principalOf(input.identity);
      if (owner && owner.id === mine) return { outcome: 'unchanged', principalId: mine };
      if (owner) {
        const ownerLink = principals.linkOf(owner.id);
        if (ownerLink || owner.identities.length > 1) return { outcome: 'owned-elsewhere' };
      }
      if (!mine) {
        const principalId = owner?.id ?? await principals.createPrincipal({ createdBy: `console:user:${input.consoleUserId}` });
        await principals.assignIdentity(input.identity, principalId, { method: 'code', by: `console:user:${input.consoleUserId}` });
        await principals.setLink({ principalId, consoleUserId: input.consoleUserId,
          ...(input.consoleDisplayName ? { consoleDisplayName: input.consoleDisplayName } : {}), linkedVia: 'code' });
        return { outcome: 'bound', principalId };
      }
      const carried = (owner ? this.#store.grantsOf(owner.id).length > 0 : false)
        || this.#store.grantsOf(mine).some(entry => chatRoleEntryAppliesTo(entry, input.identity));
      if (carried && !input.canManageGlobal) return { outcome: 'needs-admin' };
      if (owner) {
        await this.#mergeUnlocked(mine, owner.id, 'code', `console:user:${input.consoleUserId}`);
        return { outcome: 'bound', principalId: mine, merged: owner.id };
      }
      await principals.assignIdentity(input.identity, mine, { method: 'code', by: `console:user:${input.consoleUserId}` });
      return { outcome: 'bound', principalId: mine };
    });
    this.#audit({ actor, action: 'chat-identities.bind', ...(result.principalId ? { target: result.principalId } : {}),
      outcome: result.outcome === 'bound' || result.outcome === 'unchanged' ? 'ok' : 'denied',
      detail: Object.freeze({ linkMethod: 'code', consoleUserId: input.consoleUserId, result: result.outcome, codeHash: input.codeHash }) });
    if (result.merged) {
      this.#store.notify(Object.freeze({ kind: 'merge', principalId: result.principalId!, from: result.merged, identities: Object.freeze([Object.freeze({ ...input.identity })]) }));
    }
    return Object.freeze({ outcome: result.outcome, ...(result.principalId ? { principalId: result.principalId } : {}) });
  }

  /**
   * ADR 0060 §4.1 / §4.3: one `ai.personalPrincipals[user:<id>]` entry. The Console user's person
   * is the one already linked to it; else the first configured identity's person when that one is
   * not linked yet; else a new person — linked to the user (`import`). Identities without a person
   * join it; an identity owned by another person stays there (reported). Never grants a role.
   */
  async importPersonalPrincipal(input: Readonly<{ consoleUserId: string; identities: readonly ChatIdentity[]; actor: string }>): Promise<Readonly<{
    principalId: string; linked: boolean; joined: readonly ChatIdentity[]; ownedElsewhere: readonly ChatIdentity[]; linkConflict: boolean;
  }>> {
    if (!input.consoleUserId || input.consoleUserId.length > 128) throw new ChatPeopleError('invalid', 'consoleUserId 无效');
    const identities = input.identities.filter(isChatIdentity);
    const result = await this.#store.exclusive(async () => {
      this.#store.assertPersistent();
      const principals = this.#store.principals;
      let principalId = principals.linkOfConsoleUser(input.consoleUserId)?.principalId;
      let linked = false;
      let linkConflict = false;
      if (!principalId) {
        const candidate = identities.map(identity => principals.principalOf(identity)).find(person => person && !principals.linkOf(person.id));
        principalId = candidate?.id ?? await principals.createPrincipal({ createdBy: `import:${input.actor}` });
        await principals.setLink({ principalId, consoleUserId: input.consoleUserId, linkedVia: 'import' });
        linked = true;
      }
      const joined: ChatIdentity[] = [];
      const ownedElsewhere: ChatIdentity[] = [];
      for (const identity of identities) {
        const owner = principals.principalOf(identity)?.id;
        if (owner === principalId) continue;
        if (owner) { ownedElsewhere.push(identity); if (principals.linkOf(owner)) linkConflict = true; continue; }
        await principals.assignIdentity(identity, principalId, { method: 'import', by: input.actor });
        joined.push(Object.freeze({ adapter: identity.adapter, userId: identity.userId }));
      }
      return { principalId, linked, joined, ownedElsewhere, linkConflict };
    });
    this.#audit({ actor: input.actor, action: 'chat-roles.import', target: result.principalId, outcome: 'ok',
      detail: Object.freeze({ source: 'ai.personalPrincipals', consoleUserId: input.consoleUserId, linked: result.linked,
        identities: result.joined.map(identityText), skipped: result.ownedElsewhere.map(identityText) }) });
    return Object.freeze({ ...result, joined: Object.freeze(result.joined), ownedElsewhere: Object.freeze(result.ownedElsewhere) });
  }

  /**
   * ADR 0060 §5.4: gives the Console user's person an identity on each simulation adapter alias
   * (`console-<consoleUserId>`), creating the person and its Console link (`console`) when the
   * user has none. Console authentication is the proof, so the identity is the user's own; only
   * aliases the caller classified as local simulations may be passed. An identity id already held
   * by another person (an operator merged it elsewhere) is left alone.
   */
  async ensureSimulatedIdentities(input: Readonly<{ consoleUserId: string; consoleDisplayName?: string; aliases: readonly string[] }>): Promise<Readonly<{ status: 'saved' | 'unchanged'; principalId: string; identities: readonly ChatIdentity[] }>> {
    if (!input.consoleUserId || input.consoleUserId.length > 128) throw new ChatPeopleError('invalid', 'consoleUserId 无效');
    const by = `console:user:${input.consoleUserId}`;
    const result = await this.#store.exclusive(async () => {
      this.#store.assertPersistent();
      const principals = this.#store.principals;
      let changed = false;
      let principalId = principals.linkOfConsoleUser(input.consoleUserId)?.principalId;
      if (!principalId) {
        principalId = await principals.createPrincipal({ createdBy: by,
          ...(cleanChatDisplayName(input.consoleDisplayName) ? { displayName: cleanChatDisplayName(input.consoleDisplayName)! } : {}) });
        await principals.setLink({ principalId, consoleUserId: input.consoleUserId,
          ...(input.consoleDisplayName ? { consoleDisplayName: input.consoleDisplayName } : {}), linkedVia: 'console' });
        changed = true;
      }
      for (const alias of new Set(input.aliases)) {
        const mine = principals.identitiesOf(principalId).some(identity => identity.adapter === alias);
        if (mine) continue;
        const identity = { adapter: alias, userId: `console-${input.consoleUserId}` };
        if (!isChatIdentity(identity) || principals.principalOf(identity)) continue;
        await principals.assignIdentity(identity, principalId, { method: 'console', by });
        changed = true;
      }
      const identities = principals.identitiesOf(principalId).filter(identity => input.aliases.includes(identity.adapter))
        .map(identity => Object.freeze({ adapter: identity.adapter, userId: identity.userId }));
      return { status: changed ? 'saved' as const : 'unchanged' as const, principalId, identities: Object.freeze(identities) };
    });
    if (result.status === 'saved') {
      this.#audit({ actor: by, action: 'chat-identities.bind', target: result.principalId, outcome: 'ok',
        detail: Object.freeze({ linkMethod: 'console', identities: result.identities.map(identityText) }) });
    }
    return Object.freeze(result);
  }

  /**
   * ADR 0060 §2.2 `last_seen_at`: throttled, fire-and-forget; never part of authorization and
   * never blocks a message.
   */
  observe(sighting: Readonly<{ identity: ChatIdentity; scopeKey: string; displayName?: string }>): void {
    if (!this.#store.persistent) return;
    const key = `${sighting.identity.adapter}\u0000${sighting.identity.userId}`;
    const now = this.#now();
    const name = cleanChatDisplayName(sighting.displayName);
    const last = this.#sightings.get(key);
    if (last && now - last.at < CHAT_IDENTITY_SIGHTING_THROTTLE_MS && last.name === name && last.scope === sighting.scopeKey) return;
    this.#sightings.set(key, { at: now, ...(name ? { name } : {}), scope: sighting.scopeKey });
    if (this.#sightings.size > 10_000) this.#sightings.delete(this.#sightings.keys().next().value!);
    void this.#store.exclusive(() => this.#store.principals.recordSighting(sighting.identity,
      { at: now, ...(name ? { displayName: name } : {}), scopeKey: sighting.scopeKey })).catch(() => undefined);
  }

  /** ADR 0060 Q11: clears display names older than 90 days. */
  expireSightings(): Promise<number> {
    return this.#store.exclusive(() => this.#store.principals.expireSightings(this.#now()));
  }

  /** ADR 0060 §4.5 export (people, identities with a person, grants, links). */
  export(): ConsoleChatRolesExport {
    const principals = this.#store.principals;
    return Object.freeze({
      format: 'zhin.chat-roles' as const,
      version: 1 as const,
      exportedAt: this.#now(),
      principals: principals.principals().map(({ id, displayName, createdBy, createdAt }) => ({ id,
        ...(displayName ? { displayName } : {}), ...(createdBy ? { createdBy } : {}), createdAt })),
      identities: principals.identities().filter(identity => identity.principalId).map(identity => ({
        adapter: identity.adapter, userId: identity.userId, principalId: identity.principalId!,
        ...(identity.linkMethod ? { linkMethod: identity.linkMethod } : {}),
        ...(identity.linkedBy ? { linkedBy: identity.linkedBy } : {}), ...(identity.linkedAt ? { linkedAt: identity.linkedAt } : {}) })),
      roles: this.#store.list().map(entry => ({ level: entry.level, key: entry.key,
        ...(entry.principalId ? { principalId: entry.principalId } : {}), adapter: entry.adapter, userId: entry.userId, role: entry.role,
        ...(entry.grantedBy ? { grantedBy: entry.grantedBy } : {}), ...(entry.grantedAt ? { grantedAt: entry.grantedAt } : {}) })),
      consoleLinks: principals.links().map(link => ({ principalId: link.principalId, consoleUserId: link.consoleUserId,
        ...(link.consoleDisplayName ? { consoleDisplayName: link.consoleDisplayName } : {}), linkedAt: link.linkedAt, linkedVia: link.linkedVia })),
    });
  }

  /**
   * ADR 0060 §4.3 / §4.5 import (merge into what is stored):
   * - an exported person maps to the stored person one of its identities already belongs to, else
   *   to the stored person with the same id, else a new person (same id when free);
   * - identities without a person join it (`import`); identities owned by another person stay
   *   where they are (skipped);
   * - grants are bound to the identity's current person and only added or raised (never lowered,
   *   never removed); grants below global need an identity on the scope's adapter;
   * - Console links only where neither side is linked yet.
   */
  async import(data: unknown, actor: string): Promise<ConsoleChatRolesImportResult> {
    const skipped: string[] = [];
    const counts = { principals: 0, identities: 0, roles: 0, consoleLinks: 0 };
    const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
    if (!record(data) || data.format !== 'zhin.chat-roles' || data.version !== 1) throw new ChatPeopleError('invalid', '不是 zhin.chat-roles v1 导出文件');
    const list = (value: unknown) => Array.isArray(value) ? value.filter(record).slice(0, 100_000) : [];
    const exportedIdentities = list(data.identities);
    await this.#store.exclusive(async () => {
      this.#store.assertPersistent();
      const principals = this.#store.principals;
      const mapped = new Map<string, string>();
      for (const person of list(data.principals)) {
        const id = String(person.id ?? '');
        if (!isChatPrincipalId(id)) { skipped.push(`principal ${String(person.id ?? '').slice(0, 40)}: malformed`); continue; }
        const own = exportedIdentities.filter(identity => identity.principalId === id)
          .map(identity => ({ adapter: identity.adapter, userId: identity.userId })).filter(isChatIdentity);
        const existing = own.map(identity => principals.principalOf(identity)?.id).find(Boolean)
          ?? (principals.stored(id) ? id : undefined);
        if (existing) { mapped.set(id, existing); continue; }
        const created = await principals.createPrincipal({ id, createdBy: `import:${actor}`,
          ...(typeof person.displayName === 'string' ? { displayName: person.displayName } : {}) });
        mapped.set(id, created);
        counts.principals += 1;
      }
      for (const row of exportedIdentities) {
        const identity = { adapter: row.adapter, userId: row.userId };
        const target = typeof row.principalId === 'string' ? mapped.get(row.principalId) : undefined;
        if (!isChatIdentity(identity) || !target) { skipped.push(`identity ${String(row.adapter)}:${String(row.userId)}: malformed`); continue; }
        const owner = principals.principalOf(identity)?.id;
        if (owner === target) continue;
        if (owner) { skipped.push(`identity ${identityText(identity)}: belongs to another person`); continue; }
        await principals.assignIdentity(identity, target, { method: 'import', by: actor });
        counts.identities += 1;
      }
      for (const row of list(data.roles)) {
        const identity = { adapter: row.adapter, userId: row.userId };
        let key: string;
        try { key = normalizeChatRoleScope(row.level, row.key ?? ''); } catch { skipped.push('role: malformed scope'); continue; }
        if (!isChatIdentity(identity) || !isChatRole(row.role) || !chatRoleEntryAppliesTo({ key }, identity)) { skipped.push(`role ${String(row.adapter)}:${String(row.userId)}: malformed`); continue; }
        // Bound to the identity's current person (ADR 0060 §4.3), never to whoever the file names.
        const principalId = principals.principalOf(identity)?.id
          ?? await this.#store.ensurePrincipalUnlocked(identity, { method: 'import', by: actor });
        const raised = await this.#store.raiseUnlocked({ level: row.level as FeatureConfigLevel, key, role: row.role, ...identity, principalId,
          grantedBy: typeof row.grantedBy === 'string' ? row.grantedBy : `import:${actor}` });
        if (raised) counts.roles += 1;
      }
      for (const row of list(data.consoleLinks)) {
        const principalId = typeof row.principalId === 'string' ? mapped.get(row.principalId) : undefined;
        const consoleUserId = typeof row.consoleUserId === 'string' && row.consoleUserId.length <= 128 ? row.consoleUserId : undefined;
        if (!principalId || !consoleUserId) { skipped.push('console link: malformed'); continue; }
        const current = principals.linkOf(principalId);
        if (current?.consoleUserId === consoleUserId) continue;
        if (current || principals.linkOfConsoleUser(consoleUserId)) { skipped.push(`console link user:${consoleUserId}: already linked`); continue; }
        await principals.setLink({ principalId, consoleUserId, linkedVia: 'import',
          ...(typeof row.consoleDisplayName === 'string' ? { consoleDisplayName: row.consoleDisplayName } : {}) });
        counts.consoleLinks += 1;
      }
    });
    this.#audit({ actor, action: 'chat-roles.import', target: 'export-file', outcome: 'ok',
      detail: Object.freeze({ source: 'chat-principals.import', ...counts, skipped: skipped.length }) });
    return Object.freeze({ ...counts, skipped: Object.freeze(skipped.slice(0, 200)) });
  }
}

