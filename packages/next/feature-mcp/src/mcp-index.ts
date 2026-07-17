import {
  DisposeStack,
  type CapabilitySlot,
  type PluginId,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import {
  OwnerCapabilityIndex,
  createCapabilityContext,
  type OwnerCapabilityEntry,
} from '@zhin.js/feature-kit';
import {
  assertMcpClient,
  type McpClientInstance,
  type McpDefinition,
  type McpToolDescriptor,
} from './definition.js';

export interface McpDescriptor {
  readonly owner: PluginId;
  readonly name: string;
  readonly qualifiedName: string;
  readonly description?: string;
  readonly source: string;
}

interface McpRecord {
  readonly entry: OwnerCapabilityEntry<McpDefinition>;
  readonly client: McpClientInstance;
  started: boolean;
  stopped: boolean;
}

export class McpIndex {
  readonly #index: OwnerCapabilityIndex<McpDefinition>;
  readonly #records = new Map<string, McpRecord>();
  readonly #order: readonly McpRecord[];

  private constructor(
    index: OwnerCapabilityIndex<McpDefinition>,
    records: readonly McpRecord[],
  ) {
    this.#index = index;
    this.#order = Object.freeze([...records]);
    for (const record of records) this.#records.set(record.entry.slot.id, record);
  }

  static async create(
    slots: readonly Readonly<CapabilitySlot<McpDefinition>>[],
    snapshot: RuntimeSnapshot,
  ): Promise<McpIndex> {
    const index = new OwnerCapabilityIndex(slots, snapshot);
    const records: McpRecord[] = [];
    try {
      for (const entry of index.entries()) {
        const client = await entry.slot.definition.create(
          createCapabilityContext(snapshot, entry.owner),
        );
        assertMcpClient(client, entry.source);
        records.push({ entry, client, started: false, stopped: false });
      }
      return new McpIndex(index, records);
    } catch (error) {
      await stopRecords(records, error);
      throw error;
    }
  }

  list(): readonly McpDescriptor[] {
    return this.#index.entries().map(toDescriptor);
  }

  visible(requester: PluginId): readonly McpDescriptor[] {
    return this.#index.visible(requester).map(toDescriptor);
  }

  async start(): Promise<void> {
    const started: McpRecord[] = [];
    try {
      for (const record of this.#order) {
        if (record.started || record.stopped) continue;
        started.push(record);
        await record.client.start?.();
        record.started = true;
      }
    } catch (error) {
      await stopRecords(started, error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    await stopRecords(this.#order);
  }

  async listTools(requester: PluginId, name: string): Promise<readonly McpToolDescriptor[]> {
    const record = this.#resolve(requester, name);
    return Object.freeze((await record.client.listTools()).map((tool) => {
      if (!tool.name.trim()) throw new TypeError(`MCP ${name} returned a Tool without a name`);
      return Object.freeze({ ...tool });
    }));
  }

  async callTool<TResult = unknown>(
    requester: PluginId,
    connection: string,
    tool: string,
    input: unknown,
  ): Promise<TResult> {
    const record = this.#resolve(requester, connection);
    return record.client.callTool(tool, input) as TResult | Promise<TResult>;
  }

  #resolve(requester: PluginId, name: string): McpRecord {
    const entry = this.#index.resolve(requester, name);
    if (!entry) throw new Error(`Unknown MCP connection ${name} for ${requester}`);
    const record = this.#records.get(entry.slot.id);
    if (!record || !record.started || record.stopped) {
      throw new Error(`MCP connection is not active: ${entry.qualifiedName}`);
    }
    return record;
  }
}

function toDescriptor(entry: OwnerCapabilityEntry<McpDefinition>): McpDescriptor {
  return Object.freeze({
    owner: entry.owner,
    name: entry.name,
    qualifiedName: entry.qualifiedName,
    description: entry.slot.definition.description,
    source: entry.source,
  });
}

async function stopRecords(records: readonly McpRecord[], primary?: unknown): Promise<void> {
  const stack = new DisposeStack();
  for (const record of records) {
    if (record.stopped) continue;
    stack.add(async () => {
      record.stopped = true;
      await record.client.stop?.();
    });
  }
  try {
    await stack.dispose();
  } catch (stopError) {
    if (primary !== undefined) {
      throw new AggregateError(
        [primary, stopError],
        'MCP prepare and client cleanup both failed',
        { cause: stopError },
      );
    }
    throw stopError;
  }
}
