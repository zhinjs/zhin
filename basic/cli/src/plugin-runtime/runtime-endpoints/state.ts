import { createHash } from 'node:crypto';
import { AdapterManagementError, type EndpointDesiredRepository, type EndpointDesiredSnapshot,
  type EndpointDesiredRecord } from '@zhin.js/adapter';
import { rootPluginId, type CapabilityId, type PersistentStatePort, type StateRecord, type JsonValue } from '@zhin.js/plugin-runtime';
import { createHostDocumentCipher, HostCredentialStorageError } from '../host-credential-storage.js';

/** One encrypted CAS document per Host/Adapter; the database never receives account credentials in plaintext. */
export class PersistentEndpointRepository implements EndpointDesiredRepository {
  readonly #cipher: ReturnType<typeof createHostDocumentCipher>;
  constructor(private readonly options: Readonly<{
    rootId: string;
    directory: string;
    state: () => PersistentStatePort | undefined;
  }>) { this.#cipher = createHostDocumentCipher(options.directory); }

  private key(adapterId: CapabilityId): string {
    return `runtime-endpoints:v1:${createHash('sha256').update(JSON.stringify([this.options.rootId, adapterId])).digest('hex')}`;
  }
  private aad(adapterId: CapabilityId, revision: number): Buffer {
    return Buffer.from(JSON.stringify(['runtime-endpoints', 1, this.options.rootId, adapterId, revision]));
  }
  private port(): PersistentStatePort {
    const state = this.options.state();
    if (!state) throw new AdapterManagementError('unavailable', 'Endpoint persistence is unavailable');
    return state;
  }
  private async readRecord(port: PersistentStatePort, adapterId: CapabilityId): Promise<StateRecord | undefined> {
    try { return await port.read(rootPluginId(), { kind: 'plugin' }, this.key(adapterId)); }
    catch { throw new AdapterManagementError('unavailable', 'Endpoint desired state could not be read'); }
  }
  private async decode(adapterId: CapabilityId, record: StateRecord | undefined): Promise<EndpointDesiredSnapshot | undefined> {
    if (!record) return undefined;
    try {
      const value = record.value as Record<string, unknown>;
      if (!value || typeof value !== 'object' || Array.isArray(value) || record.expiresAt !== null
        || Object.keys(value).length !== 5 || value.version !== 1 || value.rootId !== this.options.rootId
        || value.adapterId !== adapterId || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1) {
        throw new Error('Invalid endpoint state envelope');
      }
      const payload: unknown = JSON.parse(await this.#cipher.open(value.sealed, this.aad(adapterId, Number(value.revision))));
      const document = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : undefined;
      const endpoints: unknown = document ? document.endpoints : payload;
      if (document && (Object.keys(document).length !== 2 || typeof document.commitId !== 'string' || !document.commitId)) {
        throw new Error('Invalid endpoint commit identity');
      }
      if (!Array.isArray(endpoints)) throw new Error('Invalid endpoint desired records');
      return Object.freeze({ revision: Number(value.revision), endpoints, ...(document ? { commitId: document.commitId as string } : {}) });
    } catch (error) {
      if (error instanceof HostCredentialStorageError && error.code === 'storage') {
        throw new AdapterManagementError('unavailable', 'Endpoint credential storage is unavailable');
      }
      throw new AdapterManagementError('integrity', 'Endpoint desired state integrity could not be verified');
    }
  }
  async load(adapterId: CapabilityId): Promise<EndpointDesiredSnapshot | undefined> {
    return this.decode(adapterId, await this.readRecord(this.port(), adapterId));
  }
  async compareAndSet(adapterId: CapabilityId, expectedRevision: number | null,
    endpoints: readonly EndpointDesiredRecord[], commitId?: string): Promise<EndpointDesiredSnapshot> {
    if (commitId !== undefined && (!commitId || typeof commitId !== 'string')) {
      throw new AdapterManagementError('invalid_configuration', 'Invalid Endpoint commit identity');
    }
    if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1
      || expectedRevision >= Number.MAX_SAFE_INTEGER)) throw new AdapterManagementError('invalid_configuration', 'Invalid Endpoint state revision');
    const port = this.port(), record = await this.readRecord(port, adapterId);
    const current = await this.decode(adapterId, record);
    if ((current?.revision ?? null) !== expectedRevision) throw new AdapterManagementError('conflict', 'Endpoint desired state revision conflicts');
    const revision = (expectedRevision ?? 0) + 1;
    let value: JsonValue;
    try {
      const sealed = await this.#cipher.seal(JSON.stringify(commitId === undefined ? endpoints : { endpoints, commitId }), this.aad(adapterId, revision));
      value = JSON.parse(JSON.stringify({ version: 1, rootId: this.options.rootId, adapterId, revision, sealed })) as JsonValue;
    } catch (error) {
      if (error instanceof HostCredentialStorageError && error.code === 'integrity') {
        throw new AdapterManagementError('integrity', 'Endpoint credential storage integrity could not be verified');
      }
      throw new AdapterManagementError('unavailable', 'Endpoint desired state could not be encrypted');
    }
    let written: boolean;
    try { written = await port.compareExchange(rootPluginId(), { kind: 'plugin' }, this.key(adapterId), record?.revision, value, null); }
    catch { throw new AdapterManagementError('commit_unknown', 'Endpoint desired state commit is unknown; reload before another operation'); }
    if (!written) throw new AdapterManagementError('conflict', 'Endpoint desired state revision conflicts');
    return Object.freeze({ revision, endpoints: structuredClone(endpoints), ...(commitId === undefined ? {} : { commitId }) });
  }
}
