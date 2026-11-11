// Types
export * from "./types.js";
export {
  AGENT_COLLABORATION_RPC,
  ENDPOINT_RPC,
  CONSOLE_EVENT_RECOVERY_GAP_EVENT,
  ENDPOINT_MANAGEMENT_CAPABILITIES,
  INBOX_RPC,
  SIDE_EVENT_PUSH,
  SIDE_EVENT_RPC,
  parseConsoleInboxEvent,
  type ConsoleEngagementDetail,
  type ConsoleEngagementSummary,
  type ConsoleVenueDefinition,
  type ConsoleInboxEvent,
  type ConsoleInboxEventKind,
  type ConsoleInboxMessageRow,
  type ConsoleInboxNoticeRow,
  type ConsoleInboxNoticesQuery,
  type ConsoleInboxNoticesResult,
  type ConsoleInboxRequestRow,
  type ConsoleEndpointPhase,
  type ConsoleEndpointSummary,
  type ConsoleEventActor,
  type ConsoleEventChannel,
  type ConsoleEventParent,
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
export { resolveMediaSrc, pickMediaRawUrl, type MediaKind } from "./mediaSrc.js";

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
  consoleRpc,
  getApiBase,
  getToken,
  handleUnauthorized,
  pluginRpc,
  PluginRpcError,
  resolveApiUrl,
} from "./console-utils/remoteApi.js";

export { resolveAdapterConsolePluginId, resolvePluginId, resolveSyncPluginId, type ResolvePluginIdOptions } from './ui/plugin-id.js';
export {
  usePluginRpc,
  usePluginData,
  useRpcResource,
  type RpcResource,
  type RpcResourceState,
  type RpcResourceOptions,
  type UsePluginRpcOptions,
  type UsePluginDataOptions,
} from './ui/rpc.js';
export {
  createDeclarativePage,
  DeclarativePageView,
  type DeclarativePageSpec,
  type DeclarativePageContext,
  type DeclarativePageComponentProps,
  type DeclarativeBadgeSpec,
  type DeclarativeStatSpec,
  type DeclarativeActionSpec,
  type DeclarativeActionFieldSpec,
  type DeclarativeColumnSpec,
  type DeclarativeSectionSpec,
  type DeclarativeI18nText,
} from './ui/declarative-page.js';
export { adapterConsoleStyles } from './adapter-console/styles.js';

export {
  AdapterConsolePage,
  createAdapterConsolePage,
  type AdapterConsolePageProps,
} from "./adapter-console/AdapterConsolePage.js";
export {
  createCommentReviewPage,
  ReviewResourceList,
  type CommentReviewSpec,
  type ReviewContext,
  type ReviewDraftBase,
  type ReviewEndpointBase,
  type ReviewStatus,
} from './review-console/index.js';

export type {
  AdapterConsoleActionResult,
  AdapterConsoleActionView,
  AdapterConsoleConfiguredEndpoint,
  AdapterConsoleConnectionTest,
  AdapterConsoleEndpoint,
  AdapterConsoleFieldView,
  AdapterConsoleLoginTask,
  AdapterConsolePageEntry,
  AdapterConsoleStatus,
} from "./adapter-console/types.js";

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
export { registerAgentTraceConsole } from "./agent-trace/registerAgentTraceConsole.js";
export { buildWaterfall } from "./agent-trace/traceView.js";
export { default as TraceArchivePage } from "./agent-trace/TraceArchivePage.js";
export {
  default as WorkroomRunsPage,
  useEngagements,
  useEngagementDetail,
  useVenues,
} from "./workroom/WorkroomRunsPage.js";
