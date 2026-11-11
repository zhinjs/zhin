export {
  createHttpRouter,
  httpHostToken,
  normalizePath,
  REMOTE_CONSOLE_ORIGIN,
  type HttpHandler,
  type HttpHost,
  type HttpRequestInfo,
  type HttpRouter,
  type HttpRouterOptions,
  type HttpRouteRegistration,
  type RouteContext,
  type WsConnection,
  type WsHandle,
  type WsRouteOptions,
  type WsTransport,
  type WsUpgradeDecision,
  type WsUpgradeRequest,
  type ListedWsRoute,
} from './http-host.js';
export type { HttpHostAddress, HttpHostOptions, HttpHostTlsOptions } from './host-options.js';
export { listHttpHostAddresses } from './addresses.js';
export {
  TokenRegistry,
  extractBearerToken,
  publicConsoleAccess,
  unrestrictedConsoleAccess,
  type AuthenticatedTokenPrincipal,
  type ConsoleAccess,
  type AuthScope,
  type TokenRegistryConfig,
} from './token-registry.js';
export {
  auditActor,
  authorizeConsoleHttp,
  authorizeConsoleRpc,
  authorizeConsoleWebSocket,
  globalPermissions,
  isUserPrincipal,
  pluginRpcWriteAllowed,
  principalAllows,
  requestMeta,
  rpcAuditDetail,
  rpcAuditTarget,
  type ConsoleAccessProvider,
  type ConsoleAuditEntry,
  type ConsoleBootstrapPrincipal,
  type ConsoleHttpDecision,
  type ConsolePrincipal,
  type ConsoleRequestMeta,
  type ConsoleRpcDecision,
  type ConsoleUserPrincipal,
} from './access-control.js';
export { timingSafeEqualString } from './timing-safe-equal.js';
export { isLoopbackAddress, verifyProtocolAccessToken, type ProtocolAuthRequest } from './protocol-auth.js';
export {
  createConsoleEventHub,
  consoleEventHubToken,
  type ConsoleEventHub,
} from './console-events.js';
export {
  buildOpenApiDocument,
  patternToOpenApiPath,
  routeRequiresBearerAuth,
  type BuildOpenApiOptions,
  type ListedRoute,
  type OpenApiParameter,
  type RouteMeta,
} from './openapi.js';
export {
  HttpBodyError,
  readBodyBytes,
  readJsonBody,
  readTextBody,
  type HttpBodyReadOptions,
} from './json-body.js';
export {
  createResponseStream,
  emptyResponse,
  jsonResponse,
  SSE_HEADERS,
  type HttpResponseStream,
  type HttpResponseStreamOptions,
} from '@zhin.js/host-http-contract';
export {
  dispatchRuntimeConsoleRpc,
  pickRpcReply,
  type RuntimeConsolePage,
  type RuntimeConsoleRpcContext,
  type RuntimeConsoleRpcMessage,
  type RuntimeConsoleRpcReply,
  type RuntimeEndpointSendInput,
  type PluginInstallPlan,
  type PluginUninstallPlan,
  type PluginUpdatePlan,
  type PluginManagementPort,
  type PluginManagementState,
  type PluginVerificationResult,
  type PluginVerificationPlan,
  type PluginConfigValidation,
} from './console-rpc.js';
export { dispatchPluginConsoleRpc } from './console-plugin-rpc.js';
export {
  buildProjectFileTree,
  FILE_MANAGER_ALLOWED,
  FILE_MANAGER_BLOCKED,
  isProjectPathAllowed,
  listEnvFiles,
  readProjectFile,
  saveProjectFile,
  type FileTreeNode,
} from './project-files.js';
export {
  registerConsoleRestPages,
  type ConsoleAgentIntrospection,
  type ConsoleAgentRuntime,
  type ConsoleAgentSessionTree,
  type ConsoleRestCtx,
  type ConsoleRestPagesOptions,
} from './console-rest-pages.js';
export {
  dispatchExtendedConsoleRpc,
  type ConsoleRpcExtendedCtx,
  type ConsoleScheduleEngine,
  type ConsoleWorkroomProfileControlPort,
  type ConsoleWorkroomKnowledgeControlPort,
  type ExtendedRpcResult,
} from './console-rpc-extended/index.js';
export * from './host-installer.js';

