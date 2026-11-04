import { createHash } from 'node:crypto';
import { rootPluginId, type JsonValue, type PersistentStatePort, type StateRecord } from '@zhin.js/plugin-runtime';
import { normalizeRuntimePolicyRefsOverride, RuntimePolicyStateError,
  type RuntimePolicyRepository, type RuntimePolicySnapshot, type RuntimePolicyRefsOverride, type RuntimePolicyWriteResult } from '@zhin.js/agent/model-policy';

/** One desired refs override per trusted Host; no file writes, expiry or write retries. */
export class PersistentRuntimePolicyRepository implements RuntimePolicyRepository {
  readonly #key: string;
  constructor(private readonly options: Readonly<{ rootId: string; hostOwnerId: string; state: () => PersistentStatePort | undefined }>) {
    this.#key = `runtime-model-policy:v1:${createHash('sha256').update(JSON.stringify([options.rootId, options.hostOwnerId])).digest('hex')}`;
  }
  private port(): PersistentStatePort {
    const port = this.options.state();
    if (!port) throw new RuntimePolicyStateError('unavailable');
    return port;
  }
  private snapshot(record: StateRecord | undefined): RuntimePolicySnapshot {
    if (!record) return Object.freeze({ revision: 0, refsOverride: normalizeRuntimePolicyRefsOverride({}) });
    try {
      const value = record.value as Record<string, unknown>;
      if (!value || Array.isArray(value) || typeof value !== 'object' || record.expiresAt !== null
        || Object.keys(value).some(key => !['version', 'kind', 'rootId', 'hostOwnerId', 'revision', 'refsOverride'].includes(key))
        || value.version !== 1 || value.kind !== 'runtime-model-policy' || value.rootId !== this.options.rootId
        || value.hostOwnerId !== this.options.hostOwnerId || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1) {
        throw new RuntimePolicyStateError('integrity');
      }
      return Object.freeze({ revision: Number(value.revision), refsOverride: normalizeRuntimePolicyRefsOverride(value.refsOverride) });
    } catch { throw new RuntimePolicyStateError('integrity'); }
  }
  private async readRecord(port: PersistentStatePort): Promise<StateRecord | undefined> {
    try { return await port.read(rootPluginId(), { kind: 'plugin' }, this.#key); }
    catch { throw new RuntimePolicyStateError('unavailable'); }
  }
  async read(): Promise<RuntimePolicySnapshot> {
    return this.snapshot(await this.readRecord(this.port()));
  }
  async compareExchange(expectedRevision: number, input: RuntimePolicyRefsOverride): Promise<RuntimePolicyWriteResult> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) {
      throw new TypeError('Invalid runtime model policy revision');
    }
    const refsOverride = normalizeRuntimePolicyRefsOverride(input);
    const port = this.port();
    const record = await this.readRecord(port);
    const current = this.snapshot(record);
    if (current.revision !== expectedRevision) return Object.freeze({ kind: 'conflict', actualRevision: current.revision });
    const snapshot = Object.freeze({ revision: expectedRevision + 1, refsOverride });
    const value = JSON.parse(JSON.stringify({ version: 1, kind: 'runtime-model-policy', rootId: this.options.rootId,
      hostOwnerId: this.options.hostOwnerId, ...snapshot })) as JsonValue;
    let written: boolean;
    try { written = await port.compareExchange(rootPluginId(), { kind: 'plugin' }, this.#key, record?.revision, value, null); }
    catch { throw new RuntimePolicyStateError('commit_unknown'); }
    return written ? Object.freeze({ kind: 'updated', snapshot }) : Object.freeze({ kind: 'conflict' });
  }
}
