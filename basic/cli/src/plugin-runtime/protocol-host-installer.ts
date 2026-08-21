import { rootPluginId, type SnapshotReader } from '@zhin.js/plugin-runtime';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { formatCompact, getLogger } from '@zhin.js/logger';
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

const logger = getLogger('protocol-host');

export interface InstallProtocolHostsOptions {
  readonly config: RuntimeConfigDocument | ConfigDocumentPort;
  readonly http: HttpHostOptions;
  readonly snapshots: SnapshotReader;
  readonly production: boolean;
  readonly projectRoot: string;
}

/**
 * Optional protocol composition boundary. Dynamic imports keep MCP/A2A SDKs
 * outside the default IM-only installation and load them only when configured.
 */
export function installProtocolHosts(options: InstallProtocolHostsOptions): RootResourceInstaller {
  return async ({ resources, lifecycle, handoff, signal: candidateSignal }) => {
    const resolved = await resolveProtocolConfig(options.config, options.http);
    const { httpHostToken } = await import('@zhin.js/host-http');
    const http = resources.use(httpHostToken);

    if (resolved.mcp && resolved.mcp.enabled !== false) {
      const [{ installRuntimeMcp }, { FileJournalStore, ToolIngressRuntime, turnJournalStoreToken }] = await Promise.all([
        import('@zhin.js/mcp/runtime'),
        import('@zhin.js/agent/runtime'),
      ]);
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
        fallbackToken: resolved.httpToken,
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
      const [{
        installRuntimeA2a,
        installRuntimeWorkroomCallbacks,
        WorkroomA2aAuthRegistry,
      }, {
        agentHostToken,
        workroomRemoteCallbackRuntimeToken,
      }, {
        WorkroomRemoteCallbackGateway,
      }] = await Promise.all([
        import('@zhin.js/a2a/runtime'),
        import('@zhin.js/agent/runtime'),
        import('@zhin.js/agent'),
      ]);
      if (resolved.a2a.enabled !== false) {
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
      const callbacks = resolved.a2a.workroomCallbacks;
      if (callbacks?.enabled === true) {
        if (!resources.has(workroomRemoteCallbackRuntimeToken)) {
          throw new Error('a2a.workroomCallbacks.enabled requires the Workroom Agent runtime');
        }
        if (!Array.isArray(callbacks.bindings) || callbacks.bindings.length === 0) {
          throw new Error('a2a.workroomCallbacks.bindings requires at least one endpoint credential');
        }
        const generation = nextGeneration(options.snapshots);
        const authRegistry = new WorkroomA2aAuthRegistry({
          generation,
          bindings: callbacks.bindings,
        });
        const maxSequenceGap = callbacks.maxSequenceGap ?? 32;
        const maxBodyBytes = callbacks.maxBodyBytes ?? 1_048_576;
        const callbackRuntime = resources.use(workroomRemoteCallbackRuntimeToken);
        const application = callbackRuntime.createApplication(maxSequenceGap);
        const gateway = new WorkroomRemoteCallbackGateway({
          authRegistry,
          linkRegistry: callbackRuntime.linkRegistry,
          inboxRepository: callbackRuntime.inboxRepository,
          application,
          clock: { now: () => Date.now() },
          receiptIds: {
            create: identity => `workroom-callback:${identity.endpointId}:${randomUUID()}`,
          },
          maxBodyBytes,
          maxSequenceGap,
        });
        const installed = await installRuntimeWorkroomCallbacks({
          http,
          path: callbacks.path ?? '/workroom-a2a/callback',
          ordinaryA2aBasePath: resolved.a2a.path ?? '/a2a',
          dependencies: {
            authRegistry,
            gateway,
            linkRegistry: callbackRuntime.linkRegistry,
            application,
          },
          maxBodyBytes,
          signal: candidateSignal,
          deferRecovery: true,
          onRecoveryError: (linkId, error) => {
            logger.warn(formatCompact({
              op: 'workroom_remote_callback_recovery_failed',
              linkId,
              error: error instanceof Error ? error.message : String(error),
            }));
          },
        });
        lifecycle.add(installed.dispose);
        handoff.add({
          activateNext: async signal => {
            const recovery = await installed.recover(signal);
            logger.info(formatCompact({
              op: 'workroom_remote_callback_ready',
              path: callbacks.path ?? '/workroom-a2a/callback',
              generation,
              bindings: callbacks.bindings.length,
              recovered: recovery.recovered,
              recoveryFailed: recovery.failed,
            }));
          },
        });
      }
    }
  };
}

function nextGeneration(snapshots: SnapshotReader): number {
  const lease = snapshots.acquire();
  try {
    const candidate = lease.value.generation + 1;
    if (!Number.isSafeInteger(candidate) || candidate < 1) {
      throw new Error('A2A callback generation is invalid');
    }
    return candidate;
  } finally {
    lease.release();
  }
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
