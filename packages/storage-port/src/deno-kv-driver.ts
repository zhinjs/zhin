import type { KvLike, StoragePort, StorageValue } from "./types.js";

function encode(value: StorageValue): unknown {
  if (typeof value === "string" || value instanceof Uint8Array) return value;
  return value;
}

function decode(raw: unknown): StorageValue | null {
  if (raw == null) return null;
  if (typeof raw === "string" || raw instanceof Uint8Array) return raw;
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return String(raw);
}

export function createDenoKvStoragePort(kv: KvLike, rootPrefix = "zhin"): StoragePort {
  const keyParts = (namespace: string, key: string) => [rootPrefix, namespace, key];

  return {
    async get(namespace, key) {
      const entry = await kv.get(keyParts(namespace, key));
      return decode(entry?.value);
    },
    async set(namespace, key, value) {
      await kv.set(keyParts(namespace, key), encode(value));
    },
    async delete(namespace, key) {
      await kv.delete(keyParts(namespace, key));
    },
    async list(namespace, prefix = "") {
      const keys: string[] = [];
      const listPrefix = prefix
        ? [rootPrefix, namespace, prefix]
        : [rootPrefix, namespace];
      for await (const entry of kv.list({ prefix: listPrefix })) {
        const tail = entry.key.slice(2).join(":");
        if (tail) keys.push(tail);
      }
      return keys;
    },
  };
}
