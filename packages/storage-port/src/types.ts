export type StorageValue = string | Uint8Array | Record<string, unknown>;

export interface StoragePort {
  get(namespace: string, key: string): Promise<StorageValue | null>;
  set(namespace: string, key: string, value: StorageValue): Promise<void>;
  delete(namespace: string, key: string): Promise<void>;
  list(namespace: string, prefix?: string): Promise<string[]>;
}

export type MemoryStorageBackend = Map<string, Map<string, StorageValue>>;

export type KvLike = {
  get: (key: string[]) => Promise<{ value: unknown } | null>;
  set: (key: string[], value: unknown) => Promise<void>;
  delete: (key: string[]) => Promise<void>;
  list: (opts: { prefix: string[] }) => AsyncIterable<{ key: string[] }>;
};
