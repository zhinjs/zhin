import type { QueueEnvelope } from "@zhin.js/core/queue-im-field-contract";

export type OutgoingRecord = {
  id: string;
  botId: string;
  detail: Record<string, unknown>;
  status: "pending" | "claimed" | "done" | "failed";
  createdAt: number;
  claimedAt?: number;
  error?: string;
};

export type QueueRuntimeOptions = {
  botId: string;
  namespace?: string;
};

export type ExecuteOutboundResult = {
  record: OutgoingRecord;
  executed: boolean;
};

export type IncomingHandler = (envelope: QueueEnvelope) => Promise<void>;
