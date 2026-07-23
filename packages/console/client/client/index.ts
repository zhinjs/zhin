// Types
export * from "./types";
export {
  ENDPOINT_RPC,
  ENDPOINT_MANAGEMENT_CAPABILITIES,
  INBOX_RPC,
  SIDE_EVENT_PUSH,
  SIDE_EVENT_RPC,
  normalizeConsolePushMessage,
  normalizeConsolePushType,
  parseConsoleInboxEvent,
  type ConsoleInboxEvent,
  type ConsoleInboxEventKind,
  type ConsoleEndpointPhase,
  type ConsoleEndpointSummary,
  type EndpointManagementCapability,
} from "@zhin.js/console-protocol";

// Media URL resolution
export { resolveMediaSrc, pickMediaRawUrl, type MediaKind } from "./mediaSrc";

// Segment IM visibility (inbox vs agent panel)
export { segmentsForImDelivery, segmentsForAgentPanel } from "./segments.js";

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
  resolveEntryRegister,
  type CreatePluginRegisterHostApiOptions,
  type FetchConsoleEntriesOptions,
  type LoadConsoleEntriesOptions,
} from "./bootstrap/loadConsoleEntries.js";

export { registerOrchestrationConsole } from "./orchestration/registerOrchestrationConsole.js";
export { default as OrchestrationRunsPage } from "./orchestration/OrchestrationRunsPage.js";

export {
  startAgentSession,
  continueAgentSession,
  subscribeAgentStream,
  iterateAgentStreamNdjson,
  foldAgentStreamNdjson,
  type AgentStreamClientOptions,
  type SubscribeAgentStreamOptions,
} from "./agent-stream.js";
