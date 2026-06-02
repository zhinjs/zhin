// Types
export * from "./types";

// Media URL resolution
export { resolveMediaSrc, pickMediaRawUrl, type MediaKind } from "./mediaSrc";

// Console app singleton (pagemanager / registry style)
export {
  app,
  type ConsoleApp,
  type AddRouteInput,
  type AddToolInput,
  type ConsoleRouteRecord,
  type RouteTreeNode,
  type ToolTreeNode,
  type ConsoleRouteRenderer,
} from "./app";

// WebSocket (business data only)
export * from "./websocket";

export { configureConsole, getRuntimeEnv } from "./runtime/index.js";

export {
  createRegistryStore,
  useRegistry,
  type RegistryStore,
} from "./store/createRegistryStore.js";

export { cn } from "./console-utils/cn.js";

export {
  apiFetch,
  getApiBase,
  getToken,
  resolveApiUrl,
  resolveWebSocketUrl,
} from "./console-utils/remoteApi.js";

export {
  fetchConsoleEntries,
  createPluginRegisterHostApi,
  getRegisterFn,
  loadConsoleEntries,
  registerConsolePluginsFromEntries,
  type CreatePluginRegisterHostApiOptions,
  type FetchConsoleEntriesOptions,
  type LoadConsoleEntriesOptions,
} from "./bootstrap/loadConsoleEntries.js";
