import type { CapabilityId } from '@zhin.js/plugin-runtime';

/**
 * @internal 框架机制：进程级 Peer Registry。
 *
 * 记录“本进程内已知的 Bot 平台账号”，供入站 origin 标签（self / member / peer_bot / human）使用。
 * Fail closed：Endpoint 未上报（或上报非法值）即不在 Registry 中，绝不用配置 id 兜底。
 */

/** 平台账号键：adapter 名（小写）+ 平台用户 id。 */
export interface PeerAccountKey {
  readonly adapter: string;
  readonly userId: string;
}

export interface PeerAccount extends PeerAccountKey {
  /** `endpoint`：本进程某个已登录 Endpoint；`declared`：配置声明的外部 Bot。 */
  readonly kind: 'endpoint' | 'declared';
  /** 登记该账号的 Endpoint（同号多端会合并）；declared 账号为空数组。 */
  readonly endpointIds: readonly CapabilityId[];
  readonly label?: string;
}

export interface RegisterEndpointInput {
  readonly endpointId: CapabilityId;
  readonly adapter: string;
  readonly selfUserId: string;
}

interface EndpointEntry {
  readonly owner: object;
  /** 登记序号：owner 首次登记时分配，单调递增；大者为更新的 generation。 */
  readonly claim: number;
  readonly endpointId: CapabilityId;
  readonly adapter: string;
  readonly userId: string;
}

interface DeclaredEntry {
  readonly adapter: string;
  readonly userId: string;
  readonly label?: string;
}

function normalizeAdapter(adapter: string): string {
  if (typeof adapter !== 'string' || adapter.trim() === '') {
    throw new TypeError('Peer adapter must be a non-empty string');
  }
  return adapter.trim().toLowerCase();
}

function normalizeUserId(userId: unknown): string {
  if (typeof userId !== 'string' && typeof userId !== 'number') {
    throw new TypeError('Peer userId must be a non-empty string');
  }
  const value = String(userId).trim();
  if (value === '') throw new TypeError('Peer userId must be a non-empty string');
  return value;
}

function tryNormalizeAdapter(adapter: unknown): string | undefined {
  if (typeof adapter !== 'string') return undefined;
  const value = adapter.trim().toLowerCase();
  return value === '' ? undefined : value;
}

function tryNormalizeUserId(userId: unknown): string | undefined {
  if (typeof userId === 'number') {
    if (!Number.isFinite(userId)) return undefined;
  } else if (typeof userId !== 'string') {
    return undefined;
  }
  const value = String(userId).trim();
  return value === '' ? undefined : value;
}

function tryEndpointKey(endpointId: unknown): string | undefined {
  if (typeof endpointId !== 'string' && typeof endpointId !== 'number') return undefined;
  const value = String(endpointId);
  return value === '' ? undefined : value;
}

let claimCounter = 0;
const claimOf = new WeakMap<object, number>();

function claimFor(owner: object): number {
  let claim = claimOf.get(owner);
  if (claim === undefined) {
    claim = ++claimCounter;
    claimOf.set(owner, claim);
  }
  return claim;
}

const keyOf = (adapter: string, userId: string): string => `${adapter}\u0000${userId}`;

export class PeerRegistry {
  readonly #endpoints = new Map<string, EndpointEntry>();
  readonly #declared: DeclaredEntry[] = [];

  /**
   * 登记一个已 active 的 Endpoint 账号。“新 generation 胜出”：每个 owner 首次登记时获得单调递增的序号，
   * 同 owner 或更新的 owner 可替换旧条目；旧 generation 在新实例登记后再次上报会被忽略（返回空操作 release）。
   * 返回的 release 只在条目仍是自己登记的那条时生效（热重载新旧实例互不误删）。
   * 写路径严格校验，非法输入抛 TypeError。
   */
  registerEndpoint(owner: object, input: RegisterEndpointInput): () => void {
    const adapter = normalizeAdapter(input.adapter);
    const userId = normalizeUserId(input.selfUserId);
    const id = String(input.endpointId);
    const claim = claimFor(owner);
    const existing = this.#endpoints.get(id);
    if (existing && existing.owner !== owner && existing.claim > claim) return () => {};
    const entry: EndpointEntry = Object.freeze({ owner, claim, endpointId: input.endpointId, adapter, userId });
    this.#endpoints.set(id, entry);
    return () => {
      if (this.#endpoints.get(id) === entry) this.#endpoints.delete(id);
    };
  }

  /** 声明一个配置层的外部 Bot 账号（不对应本进程 Endpoint）。 */
  declareExternal(adapter: string, userId: string, label?: string): () => void {
    const entry: DeclaredEntry = Object.freeze({
      adapter: normalizeAdapter(adapter),
      userId: normalizeUserId(userId),
      ...(label !== undefined ? { label } : {}),
    });
    this.#declared.push(entry);
    return () => {
      const index = this.#declared.indexOf(entry);
      if (index >= 0) this.#declared.splice(index, 1);
    };
  }

  lookup(adapter: string, userId: string): PeerAccount | undefined {
    const a = tryNormalizeAdapter(adapter);
    const u = tryNormalizeUserId(userId);
    if (a === undefined || u === undefined) return undefined;
    return this.#build().get(keyOf(a, u));
  }

  isReady(endpointId: CapabilityId | string): boolean {
    const id = tryEndpointKey(endpointId);
    return id !== undefined && this.#endpoints.has(id);
  }

  selfOf(endpointId: CapabilityId | string): string | undefined {
    const id = tryEndpointKey(endpointId);
    return id === undefined ? undefined : this.#endpoints.get(id)?.userId;
  }

  snapshot(): readonly PeerAccount[] {
    return Object.freeze([...this.#build().values()]);
  }

  #build(): Map<string, PeerAccount> {
    const ids = new Map<string, CapabilityId[]>();
    const base = new Map<string, { adapter: string; userId: string; label?: string }>();
    for (const entry of this.#endpoints.values()) {
      const key = keyOf(entry.adapter, entry.userId);
      const list = ids.get(key) ?? [];
      list.push(entry.endpointId);
      ids.set(key, list);
      base.set(key, { adapter: entry.adapter, userId: entry.userId });
    }
    for (const entry of this.#declared) {
      const key = keyOf(entry.adapter, entry.userId);
      const current = base.get(key);
      if (!current) base.set(key, { adapter: entry.adapter, userId: entry.userId, label: entry.label });
      else if (current.label === undefined && entry.label !== undefined) current.label = entry.label;
    }
    const result = new Map<string, PeerAccount>();
    for (const [key, value] of base) {
      const endpointIds = ids.get(key) ?? [];
      result.set(key, Object.freeze({
        adapter: value.adapter,
        userId: value.userId,
        kind: endpointIds.length > 0 ? 'endpoint' : 'declared',
        endpointIds: Object.freeze([...endpointIds]),
        ...(value.label !== undefined ? { label: value.label } : {}),
      }) as PeerAccount);
    }
    return result;
  }
}

export function createPeerRegistry(): PeerRegistry {
  return new PeerRegistry();
}

const processRegistryKey = Symbol.for('zhin.adapter.peer-registry/1');

/** 进程级单例；经 globalThis 存放以跨 ESM 重新求值（热重载）共享。 */
export function getProcessPeerRegistry(): PeerRegistry {
  const holder = globalThis as unknown as Record<symbol, PeerRegistry | undefined>;
  return holder[processRegistryKey] ??= createPeerRegistry();
}
