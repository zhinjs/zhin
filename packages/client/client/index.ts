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

// Re-export console-core browser utilities
export {
  createRegistryStore,
  useRegistry,
  type RegistryStore,
  configureConsole,
  getRuntimeEnv,
  cn,
} from "@zhin.js/console-core/browser";
