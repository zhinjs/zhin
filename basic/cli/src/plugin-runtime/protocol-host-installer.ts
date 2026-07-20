import { rootPluginId, type SnapshotStore } from '@zhin.js/plugin-runtime';
import type { HttpHostOptions } from '@zhin.js/host-http';
import type { RuntimeMcpConfig } from '@zhin.js/mcp/runtime';
import type { RuntimeA2aConfig } from '@zhin.js/a2a/runtime';
import {
  expandEnvironmentValue,
  type ConfigDocumentPort,
  type RootResourceInstaller,
  type RuntimeConfigDocument,
} from '@zhin.js/runtime';

interface ProtocolConfig {
  readonly mcp?: RuntimeMcpConfig;
  readonly a2a?: RuntimeA2aConfig;
  readonly httpToken?: string;
  readonly publicBaseUrl: string;
}

export interface InstallProtocolHostsOptions {
  readonly config: RuntimeConfigDocument | ConfigDocumentPort;
  readonly http: HttpHostOptions;
  readonly snapshots: SnapshotStore;
  readonly production: boolean;
}

/**
 * Optional protocol composition boundary. Dynamic imports keep MCP/A2A SDKs
 * outside the default IM-only installation and load them only when configured.
 */
export function installProtocolHosts(options: InstallProtocolHostsOptions): RootResourceInstaller {
  return async ({ resources, lifecycle }) => {
    const resolved = await resolveProtocolConfig(options.config, options.http);
    const { httpHostToken } = await import('@zhin.js/host-http');
    const http = resources.use(httpHostToken);

    if (resolved.mcp && resolved.mcp.enabled !== false) {
      const [{ installRuntimeMcp }, { AgentRuntime }] = await Promise.all([
        import('@zhin.js/mcp/runtime'),
        import('@zhin.js/agent/runtime'),
      ]);
      const runtime = new AgentRuntime();
      runtime.attach(options.snapshots);
      lifecycle.add(installRuntimeMcp({
        http,
        config: resolved.mcp,
        fallbackToken: resolved.httpToken,
        production: options.production,
        tools: {
          withTools: (operation) => runtime.runTurn(rootPluginId(), async (capabilities) => {
            const tools = capabilities.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
              approval: tool.approval,
              execute: (input: unknown) => tool.execute(input),
            }));
            return operation(tools);
          }),
        },
      }));
    }

    if (resolved.a2a && resolved.a2a.enabled !== false) {
      const [{ installRuntimeA2a }, { agentHostToken }] = await Promise.all([
        import('@zhin.js/a2a/runtime'),
        import('@zhin.js/agent/runtime'),
      ]);
      if (!resources.has(agentHostToken)) {
        throw new Error('a2a.enabled requires a ready Agent Host (configure ai.providers and ai.agents.zhin)');
      }
      lifecycle.add(installRuntimeA2a({
        http,
        agentHost: resources.use(agentHostToken),
        config: resolved.a2a,
        fallbackToken: resolved.httpToken,
        fallbackPublicUrl: resolved.publicBaseUrl,
        production: options.production,
      }));
    }
  };
}

async function resolveProtocolConfig(
  config: RuntimeConfigDocument | ConfigDocumentPort,
  http: HttpHostOptions,
): Promise<ProtocolConfig> {
  const raw = isConfigPort(config) ? (await config.read()).document : config;
  const document = expandEnvironmentValue(raw, (key) => process.env[key]) as Record<string, unknown>;
  const httpDocument = asRecord(document.http);
  const publicUrl = typeof httpDocument?.publicUrl === 'string'
    ? httpDocument.publicUrl.trim().replace(/\/+$/u, '')
    : '';
  const host = http.host === '0.0.0.0' || http.host === '::'
    ? '127.0.0.1'
    : http.host ?? '127.0.0.1';
  return Object.freeze({
    mcp: asRecord(document.mcp) as RuntimeMcpConfig | undefined,
    a2a: asRecord(document.a2a) as RuntimeA2aConfig | undefined,
    httpToken: typeof httpDocument?.token === 'string' ? httpDocument.token : http.token,
    publicBaseUrl: publicUrl || `http://${host}:${http.port ?? 8086}`,
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isConfigPort(value: RuntimeConfigDocument | ConfigDocumentPort): value is ConfigDocumentPort {
  return typeof (value as ConfigDocumentPort).read === 'function';
}
