/**
 * McpClientConnection — single MCP server connection lifecycle.
 *
 * Uses @modelcontextprotocol/sdk Client when available.
 * Falls back to a placeholder when the SDK is not installed.
 */

import type { AgentTool } from '@zhin.js/ai';
import type { McpServerEntry, McpResource, McpPrompt } from '../orchestrator/types.js';
import { mcpToolToAgentTool, mcpResourceToInfo, mcpPromptToInfo } from './bridge.js';

export interface McpClientConnectionState {
  connected: boolean;
  tools: AgentTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
  error?: string;
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

  async connect(): Promise<McpClientConnectionState> {
    if (this.state.connected) return this.state;

    try {
      const sdk = await this.loadSdk();
      if (!sdk) {
        this.state.error = '@modelcontextprotocol/sdk not installed — MCP client disabled';
        return this.state;
      }

      const { Client } = sdk;
      this.client = new Client({ name: `zhin-${this.name}`, version: '1.0.0' });

      this.transport = await this.createTransport(sdk);
      await this.client.connect(this.transport);

      await this.discoverCapabilities();
      this.state.connected = true;
      this.state.error = undefined;
    } catch (err: any) {
      this.state.error = err.message;
      throw err;
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
          env: this.entry.env,
        });
      }
      default:
        throw new Error(`Unknown MCP transport: ${this.entry.transport}`);
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
