import { createDenoKvStoragePort } from "./deno-kv-driver.js";
import { createMemoryStoragePort } from "./memory-driver.js";
import type { KvLike, StoragePort } from "./types.js";

export type StorageDriver = "memory" | "deno-kv";

export type CreateStorageOptions = {
  driver?: StorageDriver;
  /** Required when driver is deno-kv */
  kv?: KvLike;
  memoryStore?: Map<string, Map<string, import("./types.js").StorageValue>>;
};

export function createStoragePort(options: CreateStorageOptions = {}): StoragePort {
  const driver = options.driver ?? "memory";
  if (driver === "deno-kv") {
    if (!options.kv) throw new Error("storage-port: deno-kv driver requires kv binding");
    return createDenoKvStoragePort(options.kv);
  }
  return createMemoryStoragePort(options.memoryStore);
}
