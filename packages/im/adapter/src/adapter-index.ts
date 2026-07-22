import {
  DisposeStack,
  type CapabilityId,
  type CapabilitySlot,
  type PluginId,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import { createCapabilityContext } from '@zhin.js/feature-kit';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type {
  AdapterCapability,
  AdapterDefinition,
  EndpointInstance,
  EndpointSendRequest,
} from './definition.js';

const logger = getLogger('Adapter');

export interface AdapterDescriptor {
  readonly id: CapabilityId;
  readonly owner: PluginId;
  readonly name: string;
  readonly source: string;
  readonly capabilities: readonly AdapterCapability[];
}

/** Console / Host-facing endpoint row (connected = admission open). */
export interface AdapterEndpointSummary extends AdapterDescriptor {
  readonly connected: boolean;
  readonly status: 'online' | 'offline';
  readonly phase: AdapterEndpointPhase;
}

export type AdapterEndpointPhase =
  'pending' | 'starting' | 'online' | 'failed' | 'unconfigured';

interface AdapterRecord extends AdapterDescriptor {
  readonly endpoint: EndpointInstance;
  readonly unconfigured: boolean;
  started: boolean;
  open: boolean;
  stopped: boolean;
  /** Start rejected or was given up on — distinguishes 'failed' from 'unconfigured'. */
  failed: boolean;
  /** start() was invoked at least once (may still be in flight). */
  startAttempted: boolean;
}

export class AdapterIndex {
  readonly $projection = 'zhin.adapter-index/1' as const;
  readonly #records = new Map<CapabilityId, AdapterRecord>();
  readonly #order: readonly AdapterRecord[];
  /** True after `open()` until `close()` / `stop()` — late starts may open themselves. */
  #admissionOpen = false;
  readonly #startTimeoutMs: number;
  /** Final give-up budget for deferred starts (never-settling start promises). */
  readonly #deferredGiveUpMs: number;

  private constructor(
    records: readonly AdapterRecord[],
    startTimeoutMs: number,
    deferredGiveUpMs: number,
  ) {
    this.#order = Object.freeze([...records]);
    this.#startTimeoutMs = startTimeoutMs;
    this.#deferredGiveUpMs = deferredGiveUpMs;
    for (const record of records) this.#records.set(record.id, record);
  }

  static async create(
    slots: readonly Readonly<CapabilitySlot<AdapterDefinition>>[],
    snapshot: RuntimeSnapshot,
    options: {
      readonly startTimeoutMs?: number;
      readonly deferredGiveUpMs?: number;
    } = {},
  ): Promise<AdapterIndex> {
    const records: AdapterRecord[] = [];
    const unconfigured: string[] = [];
    try {
      for (const slot of [...slots].sort((left, right) => left.id.localeCompare(right.id))) {
        for (const expansion of expandEndpointConfigs(slot, snapshot)) {
          const endpoint = await createEndpointSoft(slot, snapshot, expansion);
          if (endpoint.unconfigured) unconfigured.push(expansion.name);
          records.push({
            id: expansion.id,
            owner: slot.owner,
            // 展开模式下 record name 即 endpoint 名（entry.name），
            // 保证 Console 展示与 resolve/instance 按 entry name 命中唯一 record
            name: expansion.name,
            source: slot.source,
            capabilities: slot.definition.capabilities,
            endpoint: endpoint.instance,
            unconfigured: endpoint.unconfigured,
            started: false,
            open: false,
            failed: false,
            startAttempted: false,
            // Unconfigured stubs skip start/open so kitchen-sink Roots stay quiet.
            stopped: endpoint.unconfigured,
          });
        }
      }
      if (unconfigured.length > 0) {
        logger.info(formatCompact({
          op: 'adapters_unconfigured',
          count: unconfigured.length,
          names: unconfigured.join(','),
        }));
      }
      return new AdapterIndex(
        records,
        options.startTimeoutMs ?? 3_000,
        options.deferredGiveUpMs ?? 60_000,
      );
    } catch (error) {
      await stopRecords(records, error);
      throw error;
    }
  }

  list(): readonly AdapterDescriptor[] {
    return this.#order.map(({ endpoint: _endpoint, unconfigured: _unconfigured,
      started: _started, open: _open, stopped: _stopped, failed: _failed,
      startAttempted: _startAttempted, ...descriptor }) => Object.freeze(descriptor));
  }

  /** Endpoint rows for Console `endpoint.list` / `endpoint.info`. */
  describe(): readonly AdapterEndpointSummary[] {
    return Object.freeze(this.#order.map((record) => Object.freeze({
      id: record.id,
      owner: record.owner,
      // Console 展示用 live name（如 ICQQ uin、sandbox bot 名），缺省回退 slot localName
      name: endpointLiveName(record.endpoint) ?? record.name,
      source: record.source,
      capabilities: record.capabilities,
      connected: record.open && !record.stopped,
      status: record.open && !record.stopped ? 'online' as const : 'offline' as const,
      phase: endpointPhase(record),
    })));
  }

  /**
   * Resolve a Console `$adapter` + `$endpoint` pair to a capability id.
   * Matches local name, capability id, or owner path segments.
   */
  resolve(adapter: string, endpointId: string): CapabilityId | undefined {
    const matches = this.#order.filter((record) =>
      matchesEndpoint(record, adapter, endpointId));
    if (matches.length === 1) return matches[0]?.id;
    if (matches.length === 0) return undefined;
    // Prefer exact localName === endpointId when ambiguous.
    const exact = matches.find((record) => record.name === endpointId);
    return exact?.id ?? matches[0]?.id;
  }

  /**
   * Resolve a live EndpointInstance for Host-side side channels (reactions, etc.).
   */
  instance(adapter: string, endpointId: string): EndpointInstance | undefined {
    const id = this.resolve(adapter, endpointId);
    if (!id) return undefined;
    return this.#records.get(id)?.endpoint;
  }

  owner(id: CapabilityId): PluginId {
    const record = this.#records.get(id);
    if (!record) throw new Error(`Unknown Adapter Endpoint: ${id}`);
    return record.owner;
  }

  async start(): Promise<void> {
    // Soft-start in parallel with a short wait so kitchen-sink Roots do not
    // stall generation. Configured platforms that need longer (QQ auth, Slack
    // socket, GitHub verify) stay in-flight instead of being stop()'d mid-connect.
    const startTimeoutMs = this.#startTimeoutMs;
    await Promise.all(this.#order.map(async (record) => {
      if (record.started || record.stopped) return;
      record.startAttempted = true;
      const startPromise = (async () => record.endpoint.start?.())();
      try {
        await withTimeout(
          startPromise,
          startTimeoutMs,
          `Adapter start timed out after ${startTimeoutMs}ms`,
        );
        if (record.stopped) return;
        record.started = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('timed out after')) {
          logger.info(formatCompact({
            op: 'adapter_start_deferred',
            id: record.id,
            name: record.name,
            waitMs: startTimeoutMs,
          }));
          // Final backstop: a deferred start promise that never settles must
          // not keep the Endpoint in limbo forever.
          const giveUp = setTimeout(() => {
            if (record.stopped || record.started) return;
            record.stopped = true;
            record.failed = true;
            // Swallow a late rejection so it does not become unhandled.
            void startPromise.catch(() => undefined);
            logger.warn(formatCompact({
              op: 'adapter_start_give_up',
              id: record.id,
              name: record.name,
              waitMs: this.#deferredGiveUpMs,
            }));
          }, this.#deferredGiveUpMs);
          giveUp.unref?.();
          void startPromise.then(
            () => {
              clearTimeout(giveUp);
              if (record.stopped || record.started) return;
              record.started = true;
              if (this.#admissionOpen && !record.open) {
                try {
                  record.endpoint.open?.();
                  record.open = true;
                } catch (openError) {
                  logger.warn(formatCompact({
                    op: 'adapter_open_after_deferred_fail',
                    id: record.id,
                    name: record.name,
                    error: openError instanceof Error ? openError.message : String(openError),
                  }));
                }
              }
            },
            (startError) => {
              clearTimeout(giveUp);
              if (record.stopped) return;
              record.stopped = true;
              record.failed = true;
              logger.warn(formatCompact({
                op: 'adapter_start_soft_fail',
                id: record.id,
                name: record.name,
                error: startError instanceof Error ? startError.message : String(startError),
                stack: startError instanceof Error ? startError.stack : undefined,
              }));
            },
          );
          return;
        }
        record.stopped = true;
        record.failed = true;
        void startPromise.catch(() => undefined);
        // Startup connect failures are logged once here (with stack); Endpoint
        // implementations must NOT re-log them at error level.
        logger.warn(formatCompact({
          op: 'adapter_start_soft_fail',
          id: record.id,
          name: record.name,
          error: message,
          stack: error instanceof Error ? error.stack : undefined,
        }));
        // No endpoint.stop() here: adapter Endpoints self-stop in their start()
        // catch by convention (verified across icqq/qq/slack/… endpoints).
      }
    }));
  }

  open(): void {
    this.#admissionOpen = true;
    const errors: unknown[] = [];
    for (const record of this.#order) {
      if (!record.started || record.open || record.stopped) continue;
      try {
        record.endpoint.open?.();
        record.open = true;
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Adapter Endpoint open failed');
  }

  async close(): Promise<void> {
    this.#admissionOpen = false;
    const stack = new DisposeStack();
    for (const record of this.#order) {
      if (!record.open || record.stopped) continue;
      stack.add(async () => {
        await record.endpoint.close?.();
        record.open = false;
      });
    }
    await stack.dispose();
  }

  async stop(): Promise<void> {
    const stack = new DisposeStack();
    // DisposeStack unwinds in reverse: admission closes before transports stop,
    // and a close failure cannot skip transport cleanup.
    stack.add(() => stopRecords(this.#order));
    stack.add(() => this.close());
    await stack.dispose();
  }

  async send(id: CapabilityId, request: EndpointSendRequest): Promise<unknown> {
    const record = this.#records.get(id);
    if (!record) throw new Error(`Unknown Adapter Endpoint: ${id}`);
    if (!record.capabilities.includes('outbound') || !record.endpoint.send) {
      throw new Error(`Adapter Endpoint does not support outbound: ${id}`);
    }
    if (!record.started || record.stopped) {
      throw new Error(`Adapter Endpoint is not active: ${id}`);
    }
    return record.endpoint.send(request);
  }
}

export function isAdapterIndex(value: unknown): value is AdapterIndex {
  return !!value && typeof value === 'object'
    && (value as { readonly $projection?: unknown }).$projection === 'zhin.adapter-index/1';
}

function matchesEndpoint(
  record: AdapterRecord,
  adapter: string,
  endpointId: string,
): boolean {
  // 消息上的 $adapter 是 CapabilityId 的 localName 段（多 endpoint 展开后形如
  // `icqq~8596238`）。CapabilityId 段分隔符是 \0（owner\0feature\0localName），
  // 不能用 `/` 去 endsWith，否则永远匹配不上（endpoint not found）。
  const localName = record.id.split('\0').pop() ?? record.id;
  const adapterOk = record.name === adapter
    || record.id === adapter
    || localName === adapter
    || record.id.endsWith(`/${adapter}`)
    || record.owner === adapter
    || record.owner.endsWith(`/${adapter}`);
  // Live EndpointInstance.name is the bot runtime id (e.g. ICQQ uin). Host /
  // activity-feedback resolve with that id; slot.localName alone is not enough
  // when multiple plugin instances share localName "icqq".
  const liveName = endpointLiveName(record.endpoint);
  const endpointOk = record.name === endpointId
    || record.id === endpointId
    || record.id.endsWith(`/${endpointId}`)
    || (liveName !== undefined && liveName === endpointId);
  return adapterOk && endpointOk;
}

function endpointLiveName(endpoint: EndpointInstance): string | undefined {
  const name = (endpoint as { readonly name?: unknown }).name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

function endpointPhase(record: AdapterRecord): AdapterEndpointPhase {
  if (record.unconfigured) return 'unconfigured';
  if (record.failed) return 'failed';
  if (record.open && !record.stopped) return 'online';
  if (record.startAttempted) return 'starting';
  return 'pending';
}

function assertEndpoint(value: unknown, id: CapabilityId): asserts value is EndpointInstance {
  if (!value || typeof value !== 'object') {
    throw new TypeError(`Adapter ${id} create() must return an Endpoint instance`);
  }
}

/**
 * Adapter `resolveXxxConfig` helpers report missing config/credentials as
 * TypeError("… requires …") by convention; only those are expected failures.
 */
function isUnconfiguredError(error: unknown): boolean {
  return (
    error instanceof TypeError
    && /requires|not configured|missing|未配置|缺少/i.test(error.message)
  );
}

/** 单个实例配置展开的 endpoint 描述（多账号适配器经 `endpoints` 数组声明）。 */
interface EndpointExpansion {
  readonly id: CapabilityId;
  readonly name: string;
  readonly config?: Readonly<Record<string, unknown>>;
}

/**
 * 实例配置的 endpoint 展开：插件实例 config 含非空 `endpoints: [{name, ...覆盖}]` 时
 * 按数组一一创建 endpoint（基础配置为实例 config 去掉 `endpoints` 键，逐项合并），
 * 否则按实例 config 创建单个 endpoint（历史行为）。
 */
function expandEndpointConfigs(
  slot: Readonly<CapabilitySlot<AdapterDefinition>>,
  snapshot: RuntimeSnapshot,
): readonly EndpointExpansion[] {
  const config = snapshot.config.get(slot.owner) as
    | { endpoints?: unknown }
    | undefined;
  const raw = config?.endpoints;
  const entries = Array.isArray(raw)
    ? raw.filter((entry): entry is Record<string, unknown> & { name: string } =>
      !!entry && typeof entry === 'object'
      && typeof (entry as { name?: unknown }).name === 'string'
      && (entry as { name: string }).name.length > 0)
    : [];
  if (entries.length === 0) {
    if (Array.isArray(raw) && raw.length > 0) {
      logger.warn(formatCompact({
        op: 'adapter_endpoints_entries_dropped',
        id: slot.id,
        reason: 'every endpoints entry is missing a non-empty string name',
      }));
    }
    return Object.freeze([{ id: slot.id, name: slot.localName }]);
  }
  // `~` 是 record id 的分隔符、\0 是 CapabilityId 的分隔符，混入会破坏解析
  const valid = entries.filter((entry) => {
    if (/[~\0]/u.test(entry.name)) {
      logger.warn(formatCompact({
        op: 'adapter_endpoint_name_invalid',
        id: slot.id,
        name: entry.name,
      }));
      return false;
    }
    return true;
  });
  // 重名会让 #records 覆盖与 #order/resolve 三者不一致；保留首个并告警
  const seen = new Set<string>();
  const deduped = valid.filter((entry) => {
    if (seen.has(entry.name)) {
      logger.warn(formatCompact({
        op: 'adapter_endpoint_name_duplicate',
        id: slot.id,
        name: entry.name,
      }));
      return false;
    }
    seen.add(entry.name);
    return true;
  });
  if (deduped.length === 0) {
    return Object.freeze([{ id: slot.id, name: slot.localName }]);
  }
  const { endpoints: _drop, ...base } = (config ?? {}) as Record<string, unknown>;
  return Object.freeze(deduped.map((entry) => Object.freeze({
    id: `${slot.id}~${entry.name}` as CapabilityId,
    name: entry.name,
    config: Object.freeze({ ...base, ...entry, name: entry.name }),
  })));
}

async function createEndpointSoft(
  slot: Readonly<CapabilitySlot<AdapterDefinition>>,
  snapshot: RuntimeSnapshot,
  expansion?: EndpointExpansion,
): Promise<{ readonly instance: EndpointInstance; readonly unconfigured: boolean }> {
  let endpoint: unknown;
  try {
    endpoint = await slot.definition.create(
      Object.freeze({
        ...createCapabilityContext(snapshot, slot.owner),
        ...(expansion?.config ? { config: expansion.config } : {}),
        id: expansion?.id ?? slot.id,
        name: slot.localName,
      }),
    );
  } catch (error) {
    // Missing config / credentials: degrade to an inert stub so the rest of
    // the generation still boots. Anything else (network failures, bugs in
    // create()) is unexpected — keep the stub but surface a warning instead
    // of silently swallowing it at debug level.
    const message = error instanceof Error ? error.message : String(error);
    const log = isUnconfiguredError(error) ? logger.debug.bind(logger) : logger.warn.bind(logger);
    log(formatCompact({
      op: 'adapter_create_soft_fail',
      id: expansion?.id ?? slot.id,
      name: expansion?.name ?? slot.localName,
      error: message,
    }));
    return {
      instance: createUnconfiguredEndpoint(message),
      unconfigured: true,
    };
  }
  // Programming errors (create() did not return an Endpoint) must surface:
  // they propagate to AdapterIndex.create's catch, which disposes the records
  // created so far instead of hiding the bug behind an unconfigured stub.
  assertEndpoint(endpoint, expansion?.id ?? slot.id);
  return { instance: endpoint, unconfigured: false };
}

function createUnconfiguredEndpoint(reason: string): EndpointInstance {
  return Object.freeze({
    start() {
      throw new Error(`Adapter unconfigured: ${reason}`);
    },
    open() {},
    close() {},
    stop() {},
    send() {
      throw new Error(`Adapter unconfigured: ${reason}`);
    },
  });
}

function withTimeout<T>(
  promise: Promise<T> | T | undefined,
  ms: number,
  message: string,
): Promise<T | undefined> {
  if (promise === undefined) return Promise.resolve(undefined);
  return new Promise<T | undefined>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function stopRecords(
  records: readonly AdapterRecord[],
  primaryError?: unknown,
): Promise<void> {
  const stack = new DisposeStack();
  for (const record of records) {
    if (record.stopped) continue;
    stack.add(async () => {
      record.stopped = true;
      record.open = false;
      await record.endpoint.stop?.();
    });
  }
  try {
    await stack.dispose();
  } catch (stopError) {
    if (primaryError !== undefined) {
      throw new AggregateError(
        [primaryError, stopError],
        'Adapter prepare and Endpoint cleanup both failed',
        { cause: stopError },
      );
    }
    throw stopError;
  }
}
