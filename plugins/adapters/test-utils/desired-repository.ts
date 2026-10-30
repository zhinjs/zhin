import { AdapterManagementError, type EndpointDesiredRepository, type EndpointDesiredSnapshot,
  type EndpointDesiredRecord } from 'zhin.js/adapter';
import type { CapabilityId } from 'zhin.js';

/** Atomic fake persistence, with the same conflict/unknown distinction as the Host port. */
export class MemoryDesiredRepository implements EndpointDesiredRepository {
  snapshot: EndpointDesiredSnapshot | undefined = { revision: 1, endpoints: [] };
  readonly writes: Array<Readonly<{ expected: number | null; endpoints: readonly EndpointDesiredRecord[] }>> = [];
  async load(): Promise<EndpointDesiredSnapshot | undefined> { return structuredClone(this.snapshot); }
  async compareAndSet(_id: CapabilityId, expected: number | null, endpoints: readonly EndpointDesiredRecord[], commitId?: string) {
    if ((this.snapshot?.revision ?? null) !== expected) throw new AdapterManagementError('conflict', 'Changed account document');
    this.writes.push({ expected, endpoints: structuredClone(endpoints) });
    this.snapshot = structuredClone({ revision: (expected ?? 0) + 1, endpoints, commitId });
    return this.snapshot;
  }
}
