export type {
  ConsoleServerOptions,
  ConsoleClientHostAttachOptions,
  ConsoleClientHostAttachment,
  PluginServerRegisterHostApi,
  PluginServerRegister,
  ConsoleServerRouteRegistrar,
} from "./consoleServerOptions.js";

export { rewriteEntriesForClient } from "./resolveClientEntries.js";
export { buildEntriesResponse } from "./entries-handler.js";
export type { EntriesResponseBody } from "./entries-handler.js";
export { serverRuntimeEnv } from "./env.js";
export { attachConsoleClientHost } from "./startHost.js";

export type { EntryStore } from "./entryStore.js";
export { createInMemoryEntryStore } from "./entryStore.js";

export { PageManager, mountConsoleRouter } from "./pageManager.js";
