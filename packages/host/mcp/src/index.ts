/**
 * Runtime-first public API for the MCP Host.
 *
 * MCP is mounted by the CLI composition root. Importing this package is now
 * inert: it never registers legacy plugin routes as a module side effect.
 */
export {
  handleRuntimeMcpRequest,
  installRuntimeMcp,
  type InstallRuntimeMcpOptions,
  type RuntimeMcpConfig,
  type RuntimeMcpTool,
  type RuntimeMcpToolProvider,
} from './runtime.js';
export type { RuntimeMcpConfig as McpConfig } from './runtime.js';
export {
  extractMcpToolName,
  isLocalhost,
  mcpAuthRequired,
  timingSafeEqualString,
  verifyMcpBearer,
} from './mesh-auth.js';
