import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyConsoleEvent, idbListInbox } from "./idb-store.js";

/**
 * 最小内存 IndexedDB stub：仅实现 idb-store 用到的 open/upgrade/getAll/put 语义，
 * 含版本检查（低版本 open 触发 VersionError）。
 */
type StoreData = Map<string, Record<string, unknown>>;
interface DbData {
  version: number;
  stores: Map<string, StoreData>;
}

function createFakeIndexedDB() {
  const dbs = new Map<string, DbData>();

  function makeRequest<T>(run: (req: IDBRequest<T>) => void): IDBRequest<T> {
    const req = {
      result: undefined as T,
      error: null as unknown,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onupgradeneeded: null as (() => void) | null,
    } as unknown as IDBRequest<T>;
    queueMicrotask(() => run(req));
    return req;
  }

  function makeDb(data: DbData): IDBDatabase {
    return {
      objectStoreNames: {
        contains: (name: string) => data.stores.has(name),
      },
      createObjectStore: (name: string) => {
        data.stores.set(name, new Map());
      },
      transaction: (name: string) => {
        const store = data.stores.get(name);
        const tx = {
          oncomplete: null as (() => void) | null,
          onerror: null as (() => void) | null,
          error: null as unknown,
          objectStore: () => ({
            getAll: () =>
              makeRequest<Record<string, unknown>[]>((req) => {
                (req as { result: unknown }).result = [...(store?.values() ?? [])];
                req.onsuccess?.();
              }),
            put: (record: Record<string, unknown>) => {
              store?.set(String(record.id), record);
              queueMicrotask(() => tx.oncomplete?.());
            },
          }),
        };
        return tx;
      },
      close: () => undefined,
    } as unknown as IDBDatabase;
  }

  return {
    open(name: string, version = 1) {
      return makeRequest<IDBDatabase>((req) => {
        let data = dbs.get(name);
        if (data && data.version > version) {
          (req as { error: unknown }).error = new Error("VersionError");
          req.onerror?.();
          return;
        }
        const upgrading = !data || data.version < version;
        if (!data) {
          data = { version, stores: new Map() };
          dbs.set(name, data);
        }
        data.version = version;
        (req as { result: unknown }).result = makeDb(data);
        if (upgrading) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
    },
  };
}

const PUSH = {
  type: "message.receive",
  data: { adapter: "icqq", endpointKey: "bot-1", channelId: "1001" },
};

describe("applyConsoleEvent inbox record ids", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", createFakeIndexedDB());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps two events of the same conversation within one millisecond (no key overwrite)", async () => {
    // 回归：旧主键 `${adapter}:${endpointKey}:${type}:${Date.now()}` 在同毫秒会互相覆盖。
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    await applyConsoleEvent(PUSH);
    await applyConsoleEvent(PUSH);

    const rows = await idbListInbox("icqq", "bot-1", "message");
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it('deduplicates the same resumable event across history and live delivery', async () => {
    const event = { ...PUSH, runtimeId: 'runtime-a', eventId: 7, timestamp: 1700000000000 };
    await applyConsoleEvent(event);
    await applyConsoleEvent(event);

    const rows = await idbListInbox('icqq', 'bot-1', 'message');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('runtime-a:7');
    expect(rows[0]?.updatedAt).toBe(1700000000000);
  });

  it("reads legacy records that only carry endpointKey (camelCase)", async () => {
    // 旧版（DB v1 时代）记录只有 endpointKey 字段，升级后仍需能被列出
    const { idbPutInbox } = await import("./idb-store.js");
    const legacy = {
      id: "icqq:bot-1:message:1700000000000:legacy",
      adapter: "icqq",
      endpointKey: "bot-1",
      kind: "message",
      payload: {},
      updatedAt: 1700000000000,
    };
    await idbPutInbox(legacy as unknown as Parameters<typeof idbPutInbox>[0]);

    const rows = await idbListInbox("icqq", "bot-1", "message");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(legacy.id);
  });
});
