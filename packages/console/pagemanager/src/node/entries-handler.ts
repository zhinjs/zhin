import type { ConsoleClientEntry } from "@zhin.js/contract";
import type { EntryStore } from "./entryStore.js";
import { serverRuntimeEnv } from "./env.js";
import { rewriteEntriesForClient } from "./resolveClientEntries.js";

export type EntriesResponseBody = {
  entries: ConsoleClientEntry[];
  runtimeEnvHint: ReturnType<typeof serverRuntimeEnv>;
};

export function buildEntriesResponse(
  entryStore: EntryStore,
  basePath: string,
  runtimeEnvHint?: ReturnType<typeof serverRuntimeEnv>,
): EntriesResponseBody {
  const list = entryStore
    .list()
    .filter((e) => e.enabled !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const serverEnv = runtimeEnvHint ?? serverRuntimeEnv();
  const entries = rewriteEntriesForClient({ entries: list, serverEnv, basePath });
  return { entries, runtimeEnvHint: serverEnv };
}
