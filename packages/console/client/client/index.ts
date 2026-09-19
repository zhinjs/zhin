// Types
export * from "./types";
export {
  ENDPOINT_RPC,
  CONSOLE_EVENT_RECOVERY_GAP_EVENT,
  ENDPOINT_MANAGEMENT_CAPABILITIES,
  INBOX_RPC,
  SIDE_EVENT_PUSH,
  SIDE_EVENT_RPC,
  normalizeConsolePushMessage,
  normalizeConsolePushType,
  parseConsoleInboxEvent,
  type ConsoleInboxEvent,
  type ConsoleInboxEventKind,
  type ConsoleInboxNoticeRow,
  type ConsoleInboxNoticesQuery,
  type ConsoleInboxNoticesResult,
  type ConsoleEndpointPhase,
  type ConsoleEndpointSummary,
  type ConsoleEventActor,
  type ConsoleEventChannel,
  type EndpointManagementCapability,
  parseConsoleSseFrame,
  type ConsoleEventDelivery,
  type ConsoleEventData,
  type ConsoleEndpointEventData,
  type ConsoleEventEnvelope,
  type ConsoleEventHistoryPage,
  type ConsoleEventHistoryQuery,
  type ConsoleEventPayloadMap,
  type ConsoleMessageEventData,
  type ConsoleNoticeEventData,
  type ConsoleRequestEventData,
  type KnownConsoleEventType,
  type KnownConsoleEventEnvelope,
  type ParsedConsoleSseFrame,
} from "@zhin.js/console-protocol";

export {
  fetchConsoleEventHistory,
  type FetchConsoleEventHistoryOptions,
} from './console-events.js';

// Media URL resolution
export { resolveMediaSrc, pickMediaRawUrl, type MediaKind } from "./mediaSrc";

// Safe rich message rendering (Markdown + code blocks; no raw HTML execution)
export {
  MarkdownContent,
  CodeBlock,
  type MarkdownContentProps,
} from "./message-content/MarkdownContent.js";
export {
  parseMarkdown,
  parseMarkdownInline,
  highlightCodeLine,
  isSafeMarkdownHref,
  type MarkdownBlock,
  type MarkdownInline,
  type CodeToken,
  type CodeTokenKind,
} from "./message-content/markdown.js";

// Segment IM visibility (inbox vs agent panel)
export { segmentsForImDelivery, segmentsForAgentPanel } from "./segments.js";

// Owner-scoped Console client and application registry
export {
  ConsoleApp,
  createConsoleApp,
  type AddRouteInput,
  type AddToolInput,
  type ConsoleRouteRecord,
  type RouteTreeNode,
  type ToolTreeNode,
  type SidebarRenderer,
  type ToolbarRenderer,
  type ConsoleRouteRenderer,
} from "./app.js";
export {
  ConsoleClient,
  createConsoleClient,
  type ConsoleClientOptions,
} from './console-client.js';
export {
  ConsoleClientProvider,
  useConsoleClient,
  type ConsoleClientProviderProps,
} from './console-client-context.js';

// Owner-scoped REST/SSE transport
export * from "./transport/index.js";

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
} from "./console-utils/remoteApi.js";

export {
  fetchConsoleEntries,
  getRegisterFn,
  loadConsoleEntries,
  registerConsolePluginsFromEntries,
  resolveEntryRegister,
  type FetchConsoleEntriesOptions,
  type LoadConsoleEntriesOptions,
} from "./bootstrap/loadConsoleEntries.js";

export { registerWorkroomConsole } from "./workroom/registerWorkroomConsole.js";
export { default as WorkroomRunsPage } from "./workroom/WorkroomRunsPage.js";

export {
  startAgentSession,
  continueAgentSession,
  subscribeAgentStream,
  iterateAgentStreamNdjson,
  foldAgentStreamNdjson,
  type AgentStreamClientOptions,
  type SubscribeAgentStreamOptions,
} from "./agent-stream.js";
