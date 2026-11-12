import {
  adapterFeatureId,
  isAdapterIndex,
  type AdapterCapabilityProfile,
  type AITriggerConfig,
  type TurnCapabilities,
} from '@zhin.js/core';
import type { Message } from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  SCENE_FACT_STALE_MS,
  type SceneFactStore,
} from '../../scene-facts.js';
import type { TurnContextState } from '../../turn/turn-ingress.js';
import type { ToolCapability } from '../capability-ingress.js';
import type { CapabilityId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { SceneFactRefresher } from './scene-fact-refresher.js';
import type { ConversationRef, SelfProfilePort } from '@zhin.js/im-contract';

export type EndpointOwnerResolver = (adapterLocalName: string, endpointKey: string) => string | undefined;
const logger = getLogger('agent');

interface GroupSceneFacts {
  readonly name?: string;
  readonly ownerId?: string;
  readonly adminIds?: readonly string[];
  readonly memberCount?: number;
  readonly muteAll?: boolean;
}

interface GroupMemberProfile {
  readonly platformRole?: 'owner' | 'admin' | 'member';
  readonly card?: string;
  readonly title?: string;
  readonly mutedUntil?: number;
}

type AdapterIndexType = typeof isAdapterIndex extends (value: unknown) => value is infer T ? T : never;
type CapabilityDeliveryState = NonNullable<Parameters<AdapterIndexType['turnCapabilities']>[1]['delivery']>;

function resolveSceneCapabilities(
  profile: AdapterCapabilityProfile,
  conversation: Pick<ConversationRef, 'kind' | 'threadId'>,
): Readonly<{ groupInfo?: boolean; memberProfile?: boolean }> | undefined {
  const sections = [
    profile.default,
    profile[conversation.kind],
    ...(conversation.threadId ? [profile.thread] : []),
  ];
  let groupInfo: boolean | undefined;
  let memberProfile: boolean | undefined;
  for (const section of sections) {
    if (!section) continue;
    const scene = section.scene;
    if ((scene as unknown) === false) {
      groupInfo = undefined;
      memberProfile = undefined;
      continue;
    }
    if (scene && typeof scene === 'object') {
      if (scene.groupInfo === true) groupInfo = true;
      else if (scene.groupInfo === false) groupInfo = undefined;
      if (scene.memberProfile === true) memberProfile = true;
      else if (scene.memberProfile === false) memberProfile = undefined;
    }
  }
  return {
    ...(groupInfo ? { groupInfo: true } : {}),
    ...(memberProfile ? { memberProfile: true } : {}),
  };
}

function resolveEndpointRoleTarget(
  conversation: ConversationRef,
  snapshot?: RuntimeSnapshot,
  trustedEndpointId?: string,
): Readonly<{ pluginKey: string; endpointId: string }> | undefined {
  const adapters = snapshot?.projections.get(adapterFeatureId);
  if (isAdapterIndex(adapters)) {
    const adapter = adapters.adapterForEndpoint(conversation.endpoint.id as CapabilityId);
    const child = adapter?.find(conversation.endpoint.id as CapabilityId);
    const owner = adapter && snapshot?.tree.get(adapter.descriptor.owner);
    if (!owner || !child) return undefined;
    return { pluginKey: owner.instanceKey, endpointId: child.desired.endpointId };
  }
  // Legacy synthetic callers may provide the framework's explicit endpoint identity.
  // A real captured projection which cannot resolve the account must never take this path.
  if (trustedEndpointId && conversation.endpoint.adapter) {
    return { pluginKey: conversation.endpoint.adapter, endpointId: trustedEndpointId };
  }
  return undefined;
}

export interface RuntimeSenderRoles {
  /** Chat role `owner` (ADR 0056; formerly `master`). */
  readonly isMaster: boolean;
  readonly isTrusted: boolean;
}

/** ADR 0041 §6: scene/sender facts are reused for at most this long. */
export const TURN_FACT_CACHE_TTL_MS = 60_000;
/** Upper bound of cached lookups per generation (scenes + senders). */
export const TURN_FACT_CACHE_MAX_ENTRIES = 256;
const MAX_ADMIN_IDS = 20;
const KEY_SEP = '\u0000';

interface FactCacheEntry { readonly at: number; readonly value: unknown }

/** Bounded in-memory TTL cache; only successful lookups are stored. */
class TurnFactCache {
  readonly #entries = new Map<string, FactCacheEntry>();
  get<T>(key: string, now: number): T | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (now - entry.at >= TURN_FACT_CACHE_TTL_MS) { this.#entries.delete(key); return undefined; }
    return entry.value as T;
  }
  set(key: string, value: unknown, now: number): void {
    this.#entries.delete(key);
    if (this.#entries.size >= TURN_FACT_CACHE_MAX_ENTRIES) {
      for (const [k, entry] of this.#entries) {
        if (now - entry.at >= TURN_FACT_CACHE_TTL_MS) this.#entries.delete(k);
      }
      while (this.#entries.size >= TURN_FACT_CACHE_MAX_ENTRIES) {
        const oldest = this.#entries.keys().next();
        if (oldest.done) break;
        this.#entries.delete(oldest.value);
      }
    }
    this.#entries.set(key, { at: now, value });
  }
  get size(): number { return this.#entries.size; }
}

/** Keyed by the generation's adapter index, so a disposed generation's cache is unreachable and collected. */
const factCaches = new WeakMap<object, TurnFactCache>();

function factCacheFor(owner: object): TurnFactCache {
  let cache = factCaches.get(owner);
  if (!cache) factCaches.set(owner, cache = new TurnFactCache());
  return cache;
}

/** Number of cached lookups for a generation's adapter index (tests / diagnostics). */
export function turnFactCacheSize(owner: object): number {
  return factCaches.get(owner)?.size ?? 0;
}

async function raceSignal<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([task, aborted]); } finally { signal.removeEventListener('abort', onAbort); }
}

/** ADR 0041 §6 level 2: the persistent copy of one cached lookup. */
interface FactLevel2<T> {
  read(): Promise<Readonly<{ value: T; updatedAt: number }> | undefined>;
  write(value: T): Promise<void>;
}

/**
 * Optional persistent level behind {@link resolveRuntimeTurnContextState}. Absent store keeps the
 * in-memory-only behaviour.
 */
export interface SceneFactDeps {
  readonly store?: SceneFactStore;
  /** Background refresh of stale level-2 rows; absent means stale rows are served as they are. */
  readonly refresher?: SceneFactRefresher;
  readonly now?: () => number;
}

async function level2Read<T>(level2: FactLevel2<T> | undefined, kind: string): Promise<Readonly<{ value: T; updatedAt: number }> | undefined> {
  if (!level2) return undefined;
  try { return await level2.read(); } catch (error) {
    logFactError('agent_scene_fact_l2_read_failed', kind, error);
    return undefined;
  }
}

function level2Write<T>(level2: FactLevel2<T> | undefined, kind: string, value: T): Promise<void> {
  if (!level2) return Promise.resolve();
  return level2.write(value).catch((error: unknown) => logFactError('agent_scene_fact_l2_write_failed', kind, error));
}

function logFactError(op: string, kind: string | undefined, error: unknown): void {
  logger.debug(formatCompact({ op, kind, error: error instanceof Error ? error.message : String(error) }));
}

/** One cache lookup and its existing fallback services; all lifetimes stay request/generation owned. */
interface CachedFactLookup<T> {
  readonly cache: TurnFactCache;
  readonly key: string;
  readonly signal: AbortSignal;
  readonly lookup: (signal: AbortSignal) => Promise<T>;
  readonly level2?: FactLevel2<T>;
  readonly refresher?: SceneFactRefresher;
  readonly now: () => number;
}

/**
 * Read order: level 1 (fresh, 60 s) → level 2 (database) → platform. A platform result is written to both
 * levels. A level-2 row older than {@link SCENE_FACT_STALE_MS} is still served and refreshed once in the
 * background (a failed refresh keeps the last known value).
 */
async function cachedLookup<T>(
  { cache, key, signal, lookup, level2, refresher, now }: CachedFactLookup<T>,
): Promise<T | undefined> {
  const kind = key.split(KEY_SEP)[0]!;
  const hit = cache.get<T>(key, now());
  if (hit !== undefined) return hit;
  const stored = await level2Read(level2, kind);
  signal.throwIfAborted();
  if (stored) {
    cache.set(key, stored.value, now());
    if (now() - stored.updatedAt >= SCENE_FACT_STALE_MS) {
      refresher?.schedule(key, async (refreshSignal) => {
        const value = await raceSignal(lookup(refreshSignal), refreshSignal);
        cache.set(key, value, now());
        await level2Write(level2, kind, value);
      });
    }
    return stored.value;
  }
  try {
    const value = await raceSignal(lookup(signal), signal);
    cache.set(key, value, now());
    await level2Write(level2, kind, value);
    return value;
  } catch (error) {
    signal.throwIfAborted();
    logFactError('agent_scene_fact_lookup_failed', kind, error);
    return undefined;
  }
}

function hasFacts(value: object): boolean {
  return Object.keys(value).length > 0;
}

function groupLevel2(store: SceneFactStore, platform: string, group: string): FactLevel2<GroupSceneFacts> {
  return {
    async read() {
      const found = await store.getGroup(platform, 'group', group);
      return found ? { value: found.facts as GroupSceneFacts, updatedAt: found.updatedAt } : undefined;
    },
    async write(value) { if (hasFacts(value)) await store.putGroup(platform, 'group', group, value); },
  };
}

/** Address of one persistent member fact, using the existing FactStore namespace unchanged. */
interface MemberFactLevel2Request {
  readonly store: SceneFactStore;
  readonly platform: string;
  readonly groupId: string;
  readonly userId: string;
  readonly now: () => number;
}

function memberLevel2({ store, platform, groupId: group, userId: user, now }: MemberFactLevel2Request): FactLevel2<GroupMemberProfile> {
  return {
    async read() {
      const found = await store.getMember(platform, 'group', group, user);
      if (!found) return undefined;
      const facts = found.facts;
      // An expired mute is a confirmed "not muted", not a stale expiry.
      const mutedUntil = facts.mutedUntil !== undefined && facts.mutedUntil <= now() ? 0 : facts.mutedUntil;
      return {
        updatedAt: found.updatedAt,
        value: {
          ...(facts.platformRole ? { platformRole: facts.platformRole } : {}),
          ...(facts.card ? { card: facts.card } : {}),
          ...(facts.title ? { title: facts.title } : {}),
          ...(mutedUntil !== undefined ? { mutedUntil } : {}),
        },
      };
    },
    async write(value) { await store.putMember(platform, 'group', group, user, value); },
  };
}

/** One source conversation and caller lifetime, resolved against its existing generation. */
export interface RuntimeTurnContextRequest {
  readonly snapshot: Pick<RuntimeSnapshot, 'projections'>;
  readonly conversation: ConversationRef;
  readonly signal: AbortSignal;
  readonly senderId?: string;
  /** Already captured source Client authority; never resolved from a reusable account alias. */
  readonly selfProfile?: SelfProfilePort;
  /** Existing persistent facts, refresh owner and test clock; omission keeps memory-only lookup. */
  readonly factServices?: SceneFactDeps;
}

/**
 * ADR 0044: resolve what the platform allows in this conversation, once per turn, from the Endpoint's
 * effective capability profile plus the trusted facts already read into `contextState`. The Adapter's
 * `resolveCapabilities` can only narrow. Returns `undefined` when the Endpoint is unknown.
 */
export function resolveRuntimeTurnCapabilities(
  snapshot: Pick<RuntimeSnapshot, 'projections'>,
  conversation: ConversationRef,
  contextState: TurnContextState | undefined,
  options: Readonly<{ delivery?: CapabilityDeliveryState; now?: number }> = {},
): TurnCapabilities | undefined {
  const adapters = snapshot.projections?.get(adapterFeatureId);
  if (!isAdapterIndex(adapters) || typeof adapters.turnCapabilities !== 'function') return undefined;
  return adapters.turnCapabilities(conversation.endpoint.id as CapabilityId, {
    conversation,
    ...(contextState ? { facts: contextState } : {}),
    ...(options.delivery ? { delivery: options.delivery } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
}

/**
 * Resolve this turn's account and, where the profile declares `scene.groupInfo` / `scene.memberProfile`, the ADR 0041 scene facts (group, Bot role and
 * card, sender role/card/title/mute) before tool discovery. Bot, group and sender facts all use the
 * two-level cache (memory 60 s → database → platform). Failed lookups omit their fields.
 */
export async function resolveRuntimeTurnContextState(
  { snapshot, conversation, signal, senderId, selfProfile, factServices: deps = {} }: RuntimeTurnContextRequest,
): Promise<TurnContextState | undefined> {
  signal.throwIfAborted();
  const now = deps.now ?? Date.now;
  const adapters = snapshot.projections?.get(adapterFeatureId);
  if (!isAdapterIndex(adapters)) return undefined;
  const endpointId = conversation.endpoint.id;
  const endpoint = adapters.connection(endpointId, endpointId);
  let id = endpoint?.selfUserId;
  if (!id && !selfProfile) return undefined;
  let profile: import('@zhin.js/im-contract').SelfProfileSnapshot | undefined;
  let profileError: 'lookup_failed' | undefined;
  if (selfProfile) {
    try { profile = await selfProfile.read({ signal }); }
    catch {
      signal.throwIfAborted();
      profile = selfProfile.peek();
      profileError = 'lookup_failed';
      logger.warn(formatCompact({ op: 'agent_self_profile_lookup_failed', endpoint: endpointId }));
    }
    // A first read may finish an already-started platform identity lookup. The captured port
    // checks its original incarnation before this synchronous DTO read; never use config ids.
    selfProfile.peek();
    id = adapters.connection(endpointId, endpointId)?.selfUserId;
  }
  const bot: NonNullable<TurnContextState['bot']> = {
    ...(id ? { id } : {}),
    ...(profile ? { profile, ...(profile.values.nickname ? { name: profile.values.nickname } : {}) } : {}),
    ...(profileError ? { profileError } : {}),
  };
  if (!endpoint || !id) return Object.freeze({ bot: Object.freeze(bot) });
  // ADR 0044: the scene lookups run only where the Endpoint's static profile declares them usable.
  const capabilityProfile = adapters.capabilityProfile(endpointId as CapabilityId);
  const sceneCapabilities = capabilityProfile
    ? resolveSceneCapabilities(capabilityProfile, conversation)
    : undefined;
  const lookupGroupInfo = sceneCapabilities?.groupInfo === true;
  const lookupMemberProfile = sceneCapabilities?.memberProfile === true;
  if (conversation.kind === 'private' || (!lookupGroupInfo && !lookupMemberProfile)) {
    return Object.freeze({ bot: Object.freeze(bot) });
  }
  // Each inspection supplies its own signal: foreground turn or generation-owned background refresh.
  // The captured port still pins the exact source incarnation for every invocation.
  const management = adapters.management(endpoint.identity.id);
  if (lookupMemberProfile && !management?.inspectGroupMember && !management?.inspectGroupMemberProfile) {
    return Object.freeze({ bot: Object.freeze({ ...bot, platformRoleError: 'unsupported' }) });
  }
  const cache = factCacheFor(adapters);
  const group = conversation.id;
  const store = deps.store;
  const platform = capabilityLocalName(String(endpointId));
  const scopeKey = `${endpointId}${KEY_SEP}${group}`;
  const sender = senderId && senderId !== id ? senderId : undefined;

  const botTask = (async (): Promise<NonNullable<TurnContextState['bot']>> => {
    if (!lookupMemberProfile || !management) return bot;
    try {
      if (management.inspectGroupMemberProfile) {
        // Same cadence as any member (Fin 2026-10-29): L1 60 s → L2 → platform. Role-change events
        // write through, and a stale role at worst offers a tool the platform then refuses.
        const level2 = store ? memberLevel2({ store, platform, groupId: group, userId: id, now }) : undefined;
        const member = await cachedLookup({
          cache,
          key: `member${KEY_SEP}${scopeKey}${KEY_SEP}${id}`,
          signal,
          lookup: (lookupSignal) => management.inspectGroupMemberProfile!({ groupId: group, userId: id, signal: lookupSignal }),
          now,
          ...(level2 && store ? { level2: {
            read: level2.read,
            // A platform result also refreshes the session profile's bot role / mute.
            write: (value: GroupMemberProfile) => store.putBot(platform, 'group', group, id, value),
          } } : {}),
          ...(deps.refresher ? { refresher: deps.refresher } : {}),
        });
        if (!member) throw new Error('bot member lookup returned nothing');
        return {
          ...bot,
          ...(member.platformRole ? { platformRole: member.platformRole } : { platformRoleError: 'unavailable' }),
          ...(member.card ? { nickname: member.card } : {}),
          ...(member.mutedUntil !== undefined ? { mutedUntil: member.mutedUntil } : {}),
        };
      }
      const member = await raceSignal(management.inspectGroupMember!({ groupId: group, userId: id, signal }), signal);
      return { ...bot, ...(member.platformRole ? { platformRole: member.platformRole } : { platformRoleError: 'unavailable' }) };
    } catch (error) {
      signal.throwIfAborted();
      logger.warn(formatCompact({
        op: 'agent_bot_role_lookup_failed', endpoint: endpointId, group,
        error: error instanceof Error ? error.message : String(error),
      }));
      return { ...bot, platformRoleError: 'lookup_failed' };
    }
  })();
  const sceneTask = lookupGroupInfo && management?.inspectGroupScene
    ? cachedLookup({
        cache,
        key: `scene${KEY_SEP}${scopeKey}`,
        signal,
        lookup: (lookupSignal) => management.inspectGroupScene!({ groupId: group, signal: lookupSignal }),
        now,
        ...(store ? { level2: groupLevel2(store, platform, group) } : {}),
        ...(deps.refresher ? { refresher: deps.refresher } : {}),
      })
    : Promise.resolve(undefined);
  const senderTask = sender && lookupMemberProfile && management?.inspectGroupMemberProfile
    ? cachedLookup({
        cache,
        key: `member${KEY_SEP}${scopeKey}${KEY_SEP}${sender}`,
        signal,
        lookup: (lookupSignal) => management.inspectGroupMemberProfile!({ groupId: group, userId: sender, signal: lookupSignal }),
        now,
        ...(store ? { level2: memberLevel2({ store, platform, groupId: group, userId: sender, now }) } : {}),
        ...(deps.refresher ? { refresher: deps.refresher } : {}),
      })
    : Promise.resolve(undefined);
  const [resolvedBot, scene, member] = await Promise.all([botTask, sceneTask, senderTask]);
  signal.throwIfAborted();

  const conversationFacts: Record<string, unknown> = {};
  if (scene?.name) conversationFacts.name = scene.name;
  if (scene?.ownerId) conversationFacts.ownerId = scene.ownerId;
  if (scene?.adminIds) conversationFacts.adminIds = Object.freeze(scene.adminIds.slice(0, MAX_ADMIN_IDS));
  if (scene?.memberCount !== undefined) conversationFacts.memberCount = scene.memberCount;
  if (scene?.muteAll !== undefined) conversationFacts.muteAll = scene.muteAll;
  const senderFacts: Record<string, unknown> = {};
  if (member?.platformRole) senderFacts.platformRole = member.platformRole;
  if (member?.card) senderFacts.groupNickname = member.card;
  if (member?.title) senderFacts.groupTitle = member.title;
  if (member?.mutedUntil !== undefined) senderFacts.mutedUntil = member.mutedUntil;
  return Object.freeze({
    bot: Object.freeze(resolvedBot),
    ...(Object.keys(conversationFacts).length
      ? { conversation: Object.freeze(conversationFacts) as NonNullable<TurnContextState['conversation']> } : {}),
    ...(Object.keys(senderFacts).length
      ? { sender: Object.freeze(senderFacts) as NonNullable<TurnContextState['sender']> } : {}),
  });
}

/**
 * Sender roles derive only from the Runtime-set `sender.chatRole` (ADR 0056: stored grants and
 * mapping rules along the conversation's scope chain). `isMaster` means the chat role `owner`;
 * `isTrusted` means `trusted` or `admin` (admin includes trusted) without owner.
 */
export function resolveRuntimeSenderRoles(message: Pick<Message, 'sender'>): RuntimeSenderRoles {
  const role = message.sender?.id ? message.sender.chatRole : undefined;
  const isMaster = role === 'owner';
  return { isMaster, isTrusted: !isMaster && (role === 'admin' || role === 'trusted') };
}

export function resolveOwnerForRuntimeMessage(
  message: Message,
  resolve?: EndpointOwnerResolver,
  snapshot?: RuntimeSnapshot,
): string | undefined {
  if (!resolve) return undefined;
  const target = resolveEndpointRoleTarget(message.conversation, snapshot, message.endpointId);
  return target ? resolve(target.pluginKey, target.endpointId) : undefined;
}

export function capabilityLocalName(id: string): string {
  const parts = id.split('\0');
  const local = parts.length >= 3 ? parts[2]! : id;
  // 展开 id 形如 `slot~entry`（多 endpoint）：adapter 名取 slot localName
  return local.split('~')[0]!;
}

/** Endpoint liveName (e.g. ICQQ uin, sandbox bot name) from the typed endpoint identity. */
export function adapterLiveEndpointId(message: Message): string {
  if (message.endpointId) return message.endpointId;
  return capabilityLocalName(String(message.conversation.endpoint.id));
}

export function runtimeApprovalPolicy(
  requiresApproval: ToolCapability['requiresApproval'],
): ToolCapability['requiresApproval'] {
  return requiresApproval;
}
