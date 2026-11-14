/**
 * McpClientConnection — single MCP server connection lifecycle.
 *
 * Uses @modelcontextprotocol/sdk Client when available.
 * Falls back to a placeholder when the SDK is not installed.
 */

import type { AgentTool } from '@zhin.js/ai';
import type { McpServerEntry, McpResource, McpPrompt } from '../resource-hub/types.js';
import { mcpToolToAgentTool, mcpResourceToInfo, mcpPromptToInfo } from './bridge.js';
import {
  classifyMcpFailure, McpConfigurationError, McpConnectionError, McpSdkMissingError, type McpConnectionFailure,
} from './failure.js';

// ── MCP 环境清理 ─────────────────────────────────────────────────────

/** stdio MCP 进程的敏感环境变量（与 sandbox.ts 保持一致） */
const SENSITIVE_ENV_VARS = [
  'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'AZURE_CLIENT_SECRET', 'AZURE_TENANT_SECRET',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GITHUB_TOKEN', 'GH_TOKEN',
  'NPM_TOKEN', 'NPM_AUTH_TOKEN',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY',
  'DATABASE_URL', 'REDIS_URL', 'MONGODB_URI',
  'JWT_SECRET', 'SESSION_SECRET', 'ENCRYPTION_KEY',
  'SSH_PRIVATE_KEY', 'GPG_PRIVATE_KEY',
];

/**
 * 为 stdio MCP 进程创建清洁环境
 * 过滤敏感环境变量，只传递必要的运行时变量
 */
function cleanMcpEnvironment(userEnv?: Record<string, string>): Record<string, string> {
  const safeVars: Record<string, string> = {};

  // 只传递必要的系统变量
  const essentialVars = ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'SHELL', 'TERM'];
  for (const key of essentialVars) {
    if (process.env[key]) safeVars[key] = process.env[key];
  }

  // 合并用户自定义环境变量（排除敏感变量）
  if (userEnv) {
    for (const [key, value] of Object.entries(userEnv)) {
      const isSensitive = SENSITIVE_ENV_VARS.some(sensitive =>
        key.toUpperCase().includes(sensitive) || key.toUpperCase().startsWith('TOKEN') || key.toUpperCase().startsWith('SECRET')
      );
      if (!isSensitive) {
        safeVars[key] = value;
      }
    }
  }

  return safeVars;
}

export interface McpClientConnectionState {
  connected: boolean;
  tools: AgentTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
  error?: string;
  /** Classified reason of the last failed attempt (#1250); cleared by a successful connect. */
  failure?: McpConnectionFailure;
}

export class McpClientConnection {
  readonly name: string;
  private entry: McpServerEntry;
  private client: any = null;
  private transport: any = null;
  private state: McpClientConnectionState = {
    connected: false,
    tools: [],
    resources: [],
    prompts: [],
  };

  constructor(entry: McpServerEntry) {
    this.name = entry.name;
    this.entry = entry;
  }

  get isConnected(): boolean { return this.state.connected; }
  get tools(): AgentTool[] { return this.state.tools; }
  get resources(): McpResource[] { return this.state.resources; }
  get prompts(): McpPrompt[] { return this.state.prompts; }
  get failure(): McpConnectionFailure | undefined { return this.state.failure; }

  async connect(): Promise<McpClientConnectionState> {
    if (this.state.connected) return this.state;

    try {
      const sdk = await this.loadSdk();
      if (!sdk) {
        const missing = new McpSdkMissingError();
        this.state.error = missing.message;
        this.state.failure = classifyMcpFailure(missing, this.entry);
        return this.state;
      }

      const { Client } = sdk;
      this.client = new Client({ name: `zhin-${this.name}`, version: '1.0.0' });

      this.transport = await this.createTransport(sdk);
      await this.client.connect(this.transport);

      await this.discoverCapabilities();
      this.state.connected = true;
      this.state.error = undefined;
      this.state.failure = undefined;
    } catch (err: unknown) {
      const failure = classifyMcpFailure(err, this.entry, this.exitCode());
      await this.disconnect();
      this.state.error = failure.message;
      this.state.failure = failure;
      throw new McpConnectionError(failure, err);
    }

    return this.state;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try { await this.client.close(); } catch { /* ignore */ }
      this.client = null;
    }
    if (this.transport) {
      try { if (this.transport.close) await this.transport.close(); } catch { /* ignore */ }
      this.transport = null;
    }
    this.state = { connected: false, tools: [], resources: [], prompts: [] };
  }

  async callTool(name: string, args: Record<string, any>): Promise<any> {
    if (!this.client || !this.state.connected) {
      throw new Error(`MCP server "${this.name}" is not connected`);
    }
    const result = await this.client.callTool({ name, arguments: args });
    return result;
  }

  /** Lightweight health check; fails if transport or child process died. */
  async ping(): Promise<void> {
    if (!this.client || !this.state.connected) {
      throw new Error(`MCP server "${this.name}" is not connected`);
    }
    await this.client.listTools();
  }

  /** Exit code of a stdio server process that already exited (SDK internals, read defensively). */
  private exitCode(): number | undefined {
    const child = this.transport && typeof this.transport === 'object'
      ? (this.transport as { _process?: { exitCode?: unknown } })._process
      : undefined;
    return typeof child?.exitCode === 'number' ? child.exitCode : undefined;
  }

  private async loadSdk(): Promise<any> {
    try {
      // Dynamic import — @modelcontextprotocol/sdk is an optional dependency
      return await (Function('return import("@modelcontextprotocol/sdk/client/index.js")')() as Promise<any>);
    } catch {
      return null;
    }
  }

  private async createTransport(_sdk: any): Promise<any> {
    const dynamicImport = (specifier: string): Promise<any> =>
      Function('s', 'return import(s)')(specifier);

    if ((this.entry.transport === 'streamable-http' || this.entry.transport === 'sse') && !this.entry.url) {
      throw new McpConfigurationError(`MCP server "${this.name}" (${this.entry.transport}) has no url`);
    }
    if (this.entry.transport === 'stdio' && !this.entry.command) {
      throw new McpConfigurationError(`MCP server "${this.name}" (stdio) has no command`);
    }
    switch (this.entry.transport) {
      case 'streamable-http': {
        const mod = await dynamicImport('@modelcontextprotocol/sdk/client/streamableHttp.js');
        return new mod.StreamableHTTPClientTransport(new URL(this.entry.url!), {
          requestInit: { headers: this.entry.headers },
        });
      }
      case 'sse': {
        const mod = await dynamicImport('@modelcontextprotocol/sdk/client/sse.js');
        return new mod.SSEClientTransport(new URL(this.entry.url!), {
          requestInit: { headers: this.entry.headers },
        });
      }
      case 'stdio': {
        const mod = await dynamicImport('@modelcontextprotocol/sdk/client/stdio.js');
        return new mod.StdioClientTransport({
          command: this.entry.command!,
          args: this.entry.args,
          env: cleanMcpEnvironment(this.entry.env),
        });
      }
      default:
        throw new McpConfigurationError(`Unknown MCP transport: ${this.entry.transport}`);
    }
  }

  private async discoverCapabilities(): Promise<void> {
    try {
      const toolsResult = await this.client.listTools();
      this.state.tools = (toolsResult.tools || []).map((t: any) =>
        mcpToolToAgentTool(t, this.name, (name, args) => this.callTool(name, args)),
      );
    } catch { /* server may not support tools */ }

    try {
      const resourcesResult = await this.client.listResources();
      this.state.resources = (resourcesResult.resources || []).map(mcpResourceToInfo);
    } catch { /* server may not support resources */ }

    try {
      const promptsResult = await this.client.listPrompts();
      this.state.prompts = (promptsResult.prompts || []).map(mcpPromptToInfo);
    } catch { /* server may not support prompts */ }
  }
}
