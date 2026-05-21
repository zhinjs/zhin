import type { QueueEnvelope } from "@zhin.js/core/queue-im-field-contract";

export function parseQueueEnvelope(body: unknown): QueueEnvelope {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid queue envelope: expected object");
  }
  const o = body as Record<string, unknown>;
  if (typeof o.kind !== "string" || typeof o.type !== "string") {
    throw new Error("Invalid queue envelope: kind and type required");
  }
  if (!o.detail || typeof o.detail !== "object") {
    throw new Error("Invalid queue envelope: detail required");
  }
  return {
    kind: o.kind,
    type: o.type,
    detail: o.detail as Record<string, unknown>,
    ts: o.ts as number | string | undefined,
  };
}
