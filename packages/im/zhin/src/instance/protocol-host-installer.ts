import {
  createToken,
  rootPluginId,
  type ConfigDocumentPort,
  type RuntimeConfigDocument,
  type SnapshotReader,
  type Token,
} from '@zhin.js/plugin-runtime';
import { join } from 'node:path';
import type { HttpHostOptions } from '@zhin.js/host-http';
import type { A2AMailboxTransport, RuntimeA2aConfig } from '@zhin.js/a2a/runtime';
import {
  expandEnvironmentValue,
  type RootResourceInstaller,
} from '@zhin.js/runtime';

/**
 * The `@zhin.js/mcp/runtime` surface used here, typed locally: `@zhin.js/mcp` dev-depends on
 * `zhin.js`, so `zhin.js` cannot take a build edge back to it (it stays an optional peer).
 */
interface RuntimeMcpConfig {
  readonly enabled?: boolean;
  readonly path?: string;
  readonly token?: string;
  readonly allowUnauthenticatedLocalhost?: boolean;
}
interface McpToolInvocation {
  readonly traceId: string;
  readonly turnId: string;
  readonly sessionKey: string;
  readonly signal: AbortSignal;
  readonly principal: { readonly subjectId: string; readonly displayName?: string; readonly roles: readonly string[] };
}
interface McpRuntimeModule {
  installRuntimeMcp(options: {
    readonly http: unknown;
    readonly config: RuntimeMcpConfig;
    readonly authenticateBearer?: (token: string, request: Request, remoteAddress?: string) => Promise<boolean>;
    readonly production?: boolean;
    readonly tools: {
      withTools<TResult>(
        invocation: McpToolInvocation,
        operation: (tools: readonly unknown[]) => Promise<TResult>,
      ): Promise<TResult>;
    };
  }): () => void;
}
const MCP_RUNTIME_SPECIFIER = '@zhin.js/mcp/runtime';

export const a2aMailboxTransportToken: Token<A2AMailboxTransport> = createToken<A2AMailboxTransport>(
  'zhin.host.a2a.mailbox-transport',
  'Generation-owned A2A remote mailbox transport',
);

interface ProtocolConfig {
  readonly mcp?: RuntimeMcpConfig;
  readonly a2a?: RuntimeA2aConfig;
  readonly httpToken?: string;
  readonly publicBaseUrl: string;
}

export interface InstallProtocolHostsOptions {
  readonly config: RuntimeConfigDocument | ConfigDocumentPort;
  readonly http: HttpHostOptions;
  readonly snapshots: SnapshotReader;
  readonly production: boolean;
  readonly projectRoot: string;
  readonly secureCredentialProvider?: Readonly<{
    resolve(secretRef: string): string | undefined;
  }>;
}

/**
 * Optional protocol composition boundary. Dynamic imports keep MCP/A2A SDKs
 * outside the default IM-only installation and load them only when configured.
 */
export function installProtocolHosts(options: InstallProtocolHostsOptions): RootResourceInstaller {
  return async ({ resources, lifecycle }) => {
    const resolved = await resolveProtocolConfig(options.config, options.http);
    const { httpHostToken, requestMeta } = await import('@zhin.js/host-http');
    const http = resources.use(httpHostToken);

    if (resolved.mcp && resolved.mcp.enabled !== false) {
      let installRuntimeMcp: McpRuntimeModule['installRuntimeMcp'];
      let FileJournalStore: typeof import('@zhin.js/agent/runtime')['FileJournalStore'];
      let ToolIngressRuntime: typeof import('@zhin.js/agent/runtime')['ToolIngressRuntime'];
      let turnJournalStoreToken: typeof import('@zhin.js/agent/runtime')['turnJournalStoreToken'];
      try {
        [{ installRuntimeMcp }, { FileJournalStore, ToolIngressRuntime, turnJournalStoreToken }] = await Promise.all([
          import(/* @vite-ignore */ MCP_RUNTIME_SPECIFIER) as Promise<McpRuntimeModule>,
          import('@zhin.js/agent/runtime'),
        ]);
      } catch (error) {
        if (isModuleNotFoundError(error)) {
          throw new Error(
            'MCP host requires @zhin.js/agent and @zhin.js/mcp to be installed (pnpm add @zhin.js/agent @zhin.js/mcp)',
            { cause: error },
          );
        }
        throw error;
      }
      if (!resources.has(turnJournalStoreToken)) {
        resources.provide(
          turnJournalStoreToken,
          new FileJournalStore(join(options.projectRoot, '.zhin', 'agent-journal')),
        );
      }
      const runtime = new ToolIngressRuntime();
      runtime.attach(options.snapshots);
      lifecycle.add(installRuntimeMcp({
        http,
        config: resolved.mcp,
        // http.token is only a bootstrap credential now (ADR 0049): it goes through the registry.
        authenticateBearer: (token, request, remoteAddress) => http.tokenRegistry.authorizeBearer(token, 'mcp.access', requestMeta(request, remoteAddress)),
        production: options.production,
        tools: {
          withTools: (invocation, operation) => runtime.withTools(rootPluginId(), {
            identity: { traceId: invocation.traceId, turnId: invocation.turnId },
            origin: { kind: 'http', sessionId: invocation.sessionKey },
            intent: { kind: 'new' },
            principal: invocation.principal,
            input: { text: 'MCP tool protocol request' },
            session: { key: invocation.sessionKey },
            policy: { permissions: invocation.principal.roles, unattended: true },
            signal: invocation.signal,
            ports: {},
          }, async (capabilities) => {
            const tools = capabilities.map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
              execute: async (input: unknown) => {
                const outcome = await tool.execute(
                  (input ?? {}) as Readonly<Record<string, unknown>>,
                  `${invocation.turnId}:${tool.name}`,
                );
                if (outcome.status === 'completed') return outcome.output;
                throw new Error(outcome.status === 'failed' ? outcome.error : outcome.reason);
              },
            }));
            return operation(tools);
          }),
        },
      }));
    }

    if (resolved.a2a) {
      const rawA2a = resolved.a2a as Record<string, unknown>;
      if (Object.hasOwn(rawA2a, 'workroomCallbacks') || Object.hasOwn(rawA2a, 'workroomRemoteExecutors')) {
        throw new Error(
          'Configuration keys "a2a.workroomCallbacks" and "a2a.workroomRemoteExecutors" have been removed in ADR 0048. Declare remote peer mail transport under "a2a.mailbox".',
        );
      }
      let installRuntimeA2a: typeof import('@zhin.js/a2a/runtime')['installRuntimeA2a'];
      let installRuntimeA2aMailbox: typeof import('@zhin.js/a2a/runtime')['installRuntimeA2aMailbox'];
      let agentHostToken: typeof import('@zhin.js/agent/runtime')['agentHostToken'];
      try {
        [{
          installRuntimeA2a,
          installRuntimeA2aMailbox,
        }, {
          agentHostToken,
        }] = await Promise.all([
          import('@zhin.js/a2a/runtime'),
          import('@zhin.js/agent/runtime'),
        ]);
      } catch (error) {
        if (isModuleNotFoundError(error)) {
          throw new Error(
            'A2A host requires @zhin.js/agent and @zhin.js/a2a to be installed (pnpm add @zhin.js/agent @zhin.js/a2a)',
            { cause: error },
          );
        }
        throw error;
      }
      if (resolved.a2a.enabled !== false) {
        if (!resources.has(agentHostToken)) {
          throw new Error('a2a.enabled requires a ready Agent Host (enable AI Host and select a chat Profile in Console)');
        }
        lifecycle.add(installRuntimeA2a({
          http,
          agentHost: resources.use(agentHostToken),
          config: resolved.a2a,
          authenticateBearer: (token, request, remoteAddress) => http.tokenRegistry.authorizeBearer(token, 'a2a.access', requestMeta(request, remoteAddress)),
          fallbackPublicUrl: resolved.publicBaseUrl,
          production: options.production,
        }));
      }
      const mailbox = resolved.a2a.mailbox;
      if (mailbox && mailbox.enabled !== false) {
        if (!resources.has(agentHostToken)) {
          throw new Error('a2a.mailbox.enabled requires a ready Agent Host');
        }
        const installed = installRuntimeA2aMailbox({
          http,
          agentHost: resources.use(agentHostToken),
          config: mailbox,
          // Without this the transport's production check (a mailbox must have a secret) never runs.
          production: options.production,
        });
        resources.provide(a2aMailboxTransportToken, installed.transport);
        lifecycle.add(installed.dispose);
      }
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

function isModuleNotFoundError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND'),
  );
}
