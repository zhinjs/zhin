import type { StoragePort, StorageValue } from "./types.js";

export function createMemoryStoragePort(store?: Map<string, Map<string, StorageValue>>): StoragePort {
  const root = store ?? new Map<string, Map<string, StorageValue>>();

  function ns(name: string): Map<string, StorageValue> {
    let bucket = root.get(name);
    if (!bucket) {
      bucket = new Map();
      root.set(name, bucket);
    }
    return bucket;
  }

  return {
    async get(namespace, key) {
      return ns(namespace).get(key) ?? null;
    },
    async set(namespace, key, value) {
      ns(namespace).set(key, value);
    },
    async delete(namespace, key) {
      ns(namespace).delete(key);
    },
    async list(namespace, prefix = "") {
      const keys = [...ns(namespace).keys()];
      return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
    },
  };
}
