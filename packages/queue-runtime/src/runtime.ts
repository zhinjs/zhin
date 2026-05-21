function newId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
import type { StoragePort } from "@zhin.js/storage-port";
import type { QueueEnvelope } from "@zhin.js/core/queue-im-field-contract";
import { parseQueueEnvelope } from "./envelope.js";
import type {
  ExecuteOutboundResult,
  IncomingHandler,
  OutgoingRecord,
  QueueRuntimeOptions,
} from "./types.js";

const OUT_PREFIX = "out:";
const CLAIM_KEY = "claim:lock";

export class QueueRuntime {
  private readonly ns: string;

  constructor(
    private readonly storage: StoragePort,
    options: QueueRuntimeOptions,
  ) {
    this.ns = options.namespace ?? `queue:${options.botId}`;
  }

  async handleIncoming(body: unknown, onEvent?: IncomingHandler): Promise<QueueEnvelope> {
    const envelope = parseQueueEnvelope(body);
    if (onEvent) await onEvent(envelope);
    return envelope;
  }

  async enqueueOutgoing(botId: string, detail: Record<string, unknown>): Promise<OutgoingRecord> {
    const id = newId();
    const record: OutgoingRecord = {
      id,
      botId,
      detail,
      status: "pending",
      createdAt: Date.now(),
    };
    await this.storage.set(this.ns, `${OUT_PREFIX}${id}`, record);
    return record;
  }

  async listOutgoing(): Promise<OutgoingRecord[]> {
    const keys = await this.storage.list(this.ns, OUT_PREFIX);
    const records: OutgoingRecord[] = [];
    for (const key of keys) {
      const raw = await this.storage.get(this.ns, key);
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        records.push(raw as OutgoingRecord);
      }
    }
    return records.sort((a, b) => a.createdAt - b.createdAt);
  }

  async claimOutgoing(workerId: string): Promise<OutgoingRecord | null> {
    const lock = await this.storage.get(this.ns, CLAIM_KEY);
    if (lock && typeof lock === "object" && (lock as { workerId?: string }).workerId !== workerId) {
      const at = (lock as { at?: number }).at ?? 0;
      if (Date.now() - at < 30_000) return null;
    }
    await this.storage.set(this.ns, CLAIM_KEY, { workerId, at: Date.now() });

    const pending = (await this.listOutgoing()).find((r) => r.status === "pending");
    if (!pending) return null;

    pending.status = "claimed";
    pending.claimedAt = Date.now();
    await this.storage.set(this.ns, `${OUT_PREFIX}${pending.id}`, pending);
    return pending;
  }

  async executeOutbound(
    recordId: string,
    executor: (detail: Record<string, unknown>) => Promise<void>,
  ): Promise<ExecuteOutboundResult> {
    const raw = await this.storage.get(this.ns, `${OUT_PREFIX}${recordId}`);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Outgoing record not found: ${recordId}`);
    }
    const record = raw as OutgoingRecord;
    try {
      await executor(record.detail);
      record.status = "done";
    } catch (e) {
      record.status = "failed";
      record.error = (e as Error).message;
    }
    await this.storage.set(this.ns, `${OUT_PREFIX}${record.id}`, record);
    return { record, executed: record.status === "done" };
  }
}

export async function runQueueBot(
  storage: StoragePort,
  options: QueueRuntimeOptions,
): Promise<QueueRuntime> {
  return new QueueRuntime(storage, options);
}
