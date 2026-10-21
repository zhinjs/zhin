/** Internal composition contract. Not part of the command authoring facade. */
import { createToken, type PluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { CommandExecutionLimit, CommandExecutionPolicy } from './execution-policy.js';

interface ConversationIdentity {
  readonly endpoint: { readonly adapter: string; readonly id: string };
  readonly kind: string;
  readonly id: string;
  readonly parent?: { readonly kind: string; readonly id: string };
  readonly threadId?: string;
}

interface AdmissionReader {
  admit(source: unknown, capability: string, owner: PluginId, policy: CommandExecutionPolicy, snapshot: RuntimeSnapshot): CommandExecutionLimit | undefined;
  /**
   * Programmatic call with no inbound source (e.g. `CommandIndex.execute`). The policy is keyed by command only:
   * there is no sender or conversation to budget, and no reply channel for progress feedback.
   * On success the caller must invoke `release` once the execution settles.
   */
  admitDirect(capability: string, policy: CommandExecutionPolicy): DirectAdmission;
}

type DirectAdmission = { readonly limit: CommandExecutionLimit; readonly release?: undefined } | { readonly limit?: undefined; readonly release: () => void };

/** @internal Admission-only Root resource; no bind or finish authority is published. */
export const commandExecutionAdmissionToken = createToken<AdmissionReader>('zhin.command.execution-admission');

/** @internal Held only by Core's actual leased operation. */
export interface CommandOperationController {
  bind(view: object, owner: PluginId): void;
  /** Core registers actual started delivery promises, never a caller-supplied completion callback. */
  trackSend(send: Promise<unknown>): void;
  /** Stop pending feedback and drain already-started feedback before the final reply. */
  stopProgress(): Promise<void>;
  /** Called only by the real outer operation's finally, after all final sends settle. */
  finish(): Promise<void>;
}

interface Entry { active: number; cooldownUntil: number }
interface Operation {
  snapshot?: RuntimeSnapshot;
  key?: readonly string[];
  active: boolean;
  progressStopped: boolean;
  admitted: boolean;
  signal: AbortSignal;
  reply?: (owner: PluginId, text: string) => Promise<unknown>;
  readonly releases: (() => void)[];
  readonly timers: Set<ReturnType<typeof setTimeout>>;
  readonly feedback: Promise<void>[];
  readonly accepted: Set<string>;
  readonly sends: Set<Promise<void>>;
}

/** @internal Root-instance-owned state shared by projections and draining retired generations. */
export class CommandExecutionBudget {
  readonly #entries = new Map<string, Entry>();
  readonly #views = new WeakMap<object, { operation: Operation; owner: PluginId }>();
  readonly #clock: () => number;
  readonly #capacity: number;
  readonly admission: AdmissionReader;

  constructor(options: { readonly clock?: () => number; readonly capacity?: number } = {}) {
    this.#clock = options.clock ?? (() => performance.now());
    this.#capacity = options.capacity ?? 10_000;
    if (!Number.isSafeInteger(this.#capacity) || this.#capacity < 1) throw new TypeError('Invalid command budget capacity');
    this.admission = Object.freeze<AdmissionReader>({ admit: (source, capability, owner, policy, snapshot) => this.#admit(source, capability, owner, policy, snapshot),
      admitDirect: (capability, policy) => this.#admitDirect(capability, policy) });
  }

  openOperation(input: {
    readonly snapshot: RuntimeSnapshot;
    readonly conversation: ConversationIdentity;
    readonly senderId?: string;
    readonly retirementSignal: AbortSignal;
    readonly reply: (owner: PluginId, text: string) => Promise<unknown>;
  }): CommandOperationController {
    const c = input.conversation;
    const values = [c.endpoint.adapter, c.endpoint.id, c.kind, c.id, c.parent?.kind ?? '', c.parent?.id ?? '', c.threadId ?? '', input.senderId ?? ''];
    const valid = values.slice(0, 4).every(nonempty) && ['private', 'group', 'channel'].includes(c.kind) && nonempty(input.senderId)
      && (c.parent === undefined || (nonempty(c.parent.kind) && nonempty(c.parent.id)))
      && (c.threadId === undefined || nonempty(c.threadId)) && values.every(value => value.length <= 1024);
    const operation: Operation = {
      snapshot: input.snapshot, key: valid ? Object.freeze(values) : undefined,
      active: true, progressStopped: false, admitted: false, signal: input.retirementSignal,
      reply: input.reply, releases: [], timers: new Set(), feedback: [], accepted: new Set(), sends: new Set(),
    };
    const stop = () => {
      operation.progressStopped = true;
      for (const timer of operation.timers) clearTimeout(timer);
      operation.timers.clear();
    };
    input.retirementSignal.addEventListener('abort', stop, { once: true });
    return Object.freeze({
      bind: (view: object, owner: PluginId) => { if (operation.active) this.#views.set(view, { operation, owner }); },
      trackSend: (send: Promise<unknown>) => {
        if (!operation.active) return;
        const settled = send.then(() => { operation.sends.delete(settled); }, () => { operation.sends.delete(settled); });
        operation.sends.add(settled);
      },
      stopProgress: async () => { stop(); await Promise.all(operation.feedback); },
      finish: async () => {
        stop();
        await Promise.all(operation.feedback);
        // New sends may start while an earlier send is draining. Do not release from an initial snapshot alone.
        if (operation.admitted) while (operation.sends.size > 0) await Promise.all(operation.sends);
        if (!operation.active) return;
        operation.active = false;
        operation.signal.removeEventListener('abort', stop);
        for (const release of operation.releases) release();
        operation.releases.length = 0;
        operation.feedback.length = 0;
        operation.accepted.clear();
        operation.sends.clear();
        operation.reply = undefined;
        operation.snapshot = undefined;
        operation.key = undefined;
      },
    });
  }

  #admitDirect(capability: string, policy: CommandExecutionPolicy): DirectAdmission {
    return this.#acquire(JSON.stringify([capability, 'direct']), policy);
  }

  /** Shared entry accounting: concurrency, cooldown and capacity. Returns a one-shot release on success. */
  #acquire(key: string, policy: CommandExecutionPolicy): DirectAdmission {
    const now = this.#clock();
    let entry = this.#entries.get(key);
    if (entry && policy.maxConcurrent !== undefined && entry.active >= policy.maxConcurrent) return { limit: limited('busy') };
    if (entry && entry.cooldownUntil > now) return { limit: Object.freeze({ reason: 'cooldown', retryAfterMs: Math.ceil(entry.cooldownUntil - now) }) };
    if (!entry) {
      if (this.#entries.size >= this.#capacity) {
        for (const [oldKey, old] of this.#entries) if (old.active === 0 && old.cooldownUntil <= now) this.#entries.delete(oldKey);
        if (this.#entries.size >= this.#capacity) return { limit: limited('capacity') };
      }
      entry = { active: 0, cooldownUntil: 0 };
      this.#entries.set(key, entry);
    }
    entry.active++;
    entry.cooldownUntil = now + (policy.cooldownMs ?? 0);
    const acceptedEntry = entry;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        acceptedEntry.active--;
        if (acceptedEntry.active === 0 && acceptedEntry.cooldownUntil <= this.#clock()) this.#entries.delete(key);
      },
    };
  }

  #admit(source: unknown, capability: string, owner: PluginId, policy: CommandExecutionPolicy, snapshot: RuntimeSnapshot): CommandExecutionLimit | undefined {
    const binding = source !== null && typeof source === 'object' ? this.#views.get(source) : undefined;
    const operation = binding?.operation;
    if (!operation?.active || operation.snapshot !== snapshot || binding?.owner !== owner || operation.signal.aborted) return limited('operation_unavailable');
    if (!operation.key) return limited('identity_unavailable');
    const key = JSON.stringify([capability, ...operation.key]);
    // Re-entering the same capability is a second attempt, rather than a second free execution.
    const acquired = this.#acquire(key, policy);
    if (acquired.limit) return acquired.limit;
    operation.admitted = true;
    operation.releases.push(acquired.release);
    if (policy.progressAfterMs !== undefined && !operation.progressStopped && !operation.accepted.has(capability)) {
      const timer = setTimeout(() => {
        operation.timers.delete(timer);
        if (!operation.active || operation.progressStopped || operation.signal.aborted || !operation.reply) return;
        // Observe failure once. Never retry uncertain delivery and never expose the exception.
        let send: Promise<void>;
        try { send = Promise.resolve(operation.reply(owner, '正在处理中，请稍候。')).then(() => {}, () => {}); }
        catch { send = Promise.resolve(); }
        operation.feedback.push(send);
      }, policy.progressAfterMs);
      operation.timers.add(timer);
    }
    operation.accepted.add(capability);
    return undefined;
  }
}

function nonempty(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function limited(reason: CommandExecutionLimit['reason']): CommandExecutionLimit { return Object.freeze({ reason }); }

/** @internal Projection reads the Root resource; ordinary authoring values cannot bind an operation. */
export function admitCommandExecution(source: unknown, capability: string, owner: PluginId, policy: CommandExecutionPolicy | undefined, snapshot: RuntimeSnapshot): CommandExecutionLimit | undefined {
  if (!policy) return undefined;
  const reader = snapshot.resources.get(snapshot.root)?.get(commandExecutionAdmissionToken.id) as AdmissionReader | undefined;
  return reader ? reader.admit(source, capability, owner, policy, snapshot) : limited('service_unavailable');
}

/** @internal Programmatic (source-less) admission: keyed by command only, never refused for lacking a source. */
export function admitDirectCommandExecution(capability: string, policy: CommandExecutionPolicy | undefined, snapshot: RuntimeSnapshot): DirectAdmission {
  if (!policy) return { release: () => {} };
  const reader = snapshot.resources.get(snapshot.root)?.get(commandExecutionAdmissionToken.id) as AdmissionReader | undefined;
  return reader ? reader.admitDirect(capability, policy) : { limit: limited('service_unavailable') };
}
