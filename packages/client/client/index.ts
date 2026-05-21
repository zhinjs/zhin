// Types
export * from "./types";

// Media URL resolution
export { resolveMediaSrc, pickMediaRawUrl, type MediaKind } from "./mediaSrc";

// Console app singleton (page-manager style)
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

// Re-export console-types
export type {
  PluginRegisterHostApi,
  PluginAddRouteInput,
  PluginAddToolInput,
  ConsolePluginRegister,
  ConsoleClientEntry,
  ConsoleEntriesResponse,
  ConsoleEntry,
  ConsoleFileAddEntryInput,
  RuntimeEnv,
} from "@zhin.js/console-types";

export {
  DEFAULT_CONSOLE_BASE_PATH,
  CONSOLE_HOST_REACT_NAMESPACE_KEY,
} from "@zhin.js/console-types";

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
