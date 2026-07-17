import {
  DisposeStack,
  type CapabilityId,
  type CapabilitySlot,
  type PluginId,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import { createCapabilityContext } from '@zhin.js/feature-kit';
import type {
  AdapterCapability,
  AdapterDefinition,
  EndpointInstance,
  EndpointSendRequest,
} from './definition.js';

export interface AdapterDescriptor {
  readonly id: CapabilityId;
  readonly owner: PluginId;
  readonly name: string;
  readonly source: string;
  readonly capabilities: readonly AdapterCapability[];
}

interface AdapterRecord extends AdapterDescriptor {
  readonly endpoint: EndpointInstance;
  started: boolean;
  open: boolean;
  stopped: boolean;
}

export class AdapterIndex {
  readonly #records = new Map<CapabilityId, AdapterRecord>();
  readonly #order: readonly AdapterRecord[];

  private constructor(records: readonly AdapterRecord[]) {
    this.#order = Object.freeze([...records]);
    for (const record of records) this.#records.set(record.id, record);
  }

  static async create(
    slots: readonly Readonly<CapabilitySlot<AdapterDefinition>>[],
    snapshot: RuntimeSnapshot,
  ): Promise<AdapterIndex> {
    const records: AdapterRecord[] = [];
    try {
      for (const slot of [...slots].sort((left, right) => left.id.localeCompare(right.id))) {
        const endpoint = await slot.definition.create(
          Object.freeze({
            ...createCapabilityContext(snapshot, slot.owner),
            id: slot.id,
            name: slot.localName,
          }),
        );
        assertEndpoint(endpoint, slot.id);
        records.push({
          id: slot.id,
          owner: slot.owner,
          name: slot.localName,
          source: slot.source,
          capabilities: slot.definition.capabilities,
          endpoint,
          started: false,
          open: false,
          stopped: false,
        });
      }
      return new AdapterIndex(records);
    } catch (error) {
      await stopRecords(records, error);
      throw error;
    }
  }

  list(): readonly AdapterDescriptor[] {
    return this.#order.map(({ endpoint: _endpoint, started: _started, open: _open,
      stopped: _stopped, ...descriptor }) => Object.freeze(descriptor));
  }

  owner(id: CapabilityId): PluginId {
    const record = this.#records.get(id);
    if (!record) throw new Error(`Unknown Adapter Endpoint: ${id}`);
    return record.owner;
  }

  async start(): Promise<void> {
    const started: AdapterRecord[] = [];
    try {
      for (const record of this.#order) {
        if (record.started || record.stopped) continue;
        started.push(record);
        await record.endpoint.start?.();
        record.started = true;
      }
    } catch (error) {
      await stopRecords(started, error);
      throw error;
    }
  }

  open(): void {
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

function assertEndpoint(value: unknown, id: CapabilityId): asserts value is EndpointInstance {
  if (!value || typeof value !== 'object') {
    throw new TypeError(`Adapter ${id} create() must return an Endpoint instance`);
  }
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
