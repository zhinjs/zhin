import { rootPluginId, type SnapshotReader } from '@zhin.js/plugin-runtime';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { HttpHostOptions } from '@zhin.js/host-http';
import type { RuntimeMcpConfig } from '@zhin.js/mcp/runtime';
import type { RuntimeA2aConfig } from '@zhin.js/a2a/runtime';
import type {
  WorkroomRemoteAssignmentAuthorityInput,
  WorkroomRemoteAssignmentResolvedAuthority,
} from '@zhin.js/agent';
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
  readonly secureCredentialProvider?: Readonly<{
    resolve(secretRef: string): string | undefined;
  }>;
}

/**
 * Optional protocol composition boundary. Dynamic imports keep MCP/A2A SDKs
 * outside the default IM-only installation and load them only when configured.
 */
export function installProtocolHosts(options: InstallProtocolHostsOptions): RootResourceInstaller {
  return async ({ generation, resources, lifecycle, handoff, signal: candidateSignal }) => {
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
        WorkroomA2aHttpRemoteTransport,
      }, {
        agentHostToken,
        remoteAssignmentDispatchCommandServiceToken,
        remoteAssignmentDispatchSchedulerToken,
        remoteAssignmentDispatchServiceToken,
        createWorkroomGenerationAuthoritySnapshotFromRuntime,
        GenerationOwnedWorkroomAssignmentAuthorityProvider,
        GrantAwareRemoteAssignmentDispatchCommandService,
        WorkroomAssignmentAuthorityGrantApplication,
        workroomAssignmentAuthorityGrantToken,
        workroomAssignmentAuthorityGrantRepositoryToken,
        workroomAssignmentGrantClaimPreviewToken,
        workroomAssignmentGrantAuthorityMaterializerToken,
        workroomAssignmentWorkspaceAllocatorToken,
        workroomAssignmentDisclosureManifestAuthorityToken,
        workroomAssignmentAuthorityGrantApplicationToken,
        workroomProjectProfileRegistryToken,
        workroomRemoteEndpointAuthorityToken,
        workroomRemoteAssignmentAuthorityToken,
        workroomRemoteCallbackRuntimeToken,
        workroomRemoteExecutorToken,
        workroomSchedulerAssignmentRouteRegistryToken,
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
      const remoteExecutors = resolved.a2a.workroomRemoteExecutors;
      if (remoteExecutors?.enabled === true && callbacks?.enabled !== true) {
        throw new Error('a2a.workroomRemoteExecutors.enabled requires workroomCallbacks.enabled');
      }
      if (callbacks?.enabled === true) {
        if (!resources.has(workroomRemoteCallbackRuntimeToken)) {
          throw new Error('a2a.workroomCallbacks.enabled requires the Workroom Agent runtime');
        }
        if (!Array.isArray(callbacks.bindings) || callbacks.bindings.length === 0) {
          throw new Error('a2a.workroomCallbacks.bindings requires at least one endpoint credential');
        }
        const authRegistry = new WorkroomA2aAuthRegistry({
          generation,
          bindings: callbacks.bindings,
          ...(options.secureCredentialProvider
            ? { secureCredentialProvider: options.secureCredentialProvider }
            : {}),
        });
        const maxSequenceGap = callbacks.maxSequenceGap ?? 32;
        const maxBodyBytes = callbacks.maxBodyBytes ?? 1_048_576;
        const callbackRuntime = resources.use(workroomRemoteCallbackRuntimeToken);
        const callbackPath = normalizeProtocolPath(
          callbacks.path ?? '/workroom-a2a/callback',
          'a2a.workroomCallbacks.path',
        );
        const callbackUrl = resolveCallbackPublicUrl(
          resolved.a2a.publicUrl ?? resolved.publicBaseUrl,
          callbackPath,
          options.production,
        );
        const remoteTransport = remoteExecutors?.enabled === true
          ? new WorkroomA2aHttpRemoteTransport({
            authRegistry,
            callbackUrl,
            bindings: remoteExecutors.bindings,
            ...(options.secureCredentialProvider
              ? { secureCredentialProvider: options.secureCredentialProvider }
              : {}),
            ...(remoteExecutors.maxResponseBytes === undefined
              ? {}
              : { maxResponseBytes: remoteExecutors.maxResponseBytes }),
          })
          : undefined;
        const application = callbackRuntime.createApplication(maxSequenceGap, remoteTransport);
        let dispatchScheduler: ReturnType<typeof callbackRuntime.createDispatchScheduler> | undefined;
        let dispatchCommand: ReturnType<typeof callbackRuntime.createDispatchCommandService> | undefined;
        if (remoteTransport) {
          const dispatchService = callbackRuntime.createDispatchService(remoteTransport);
          const createdDispatchScheduler = callbackRuntime.createDispatchScheduler(
            dispatchService,
            {
              ownerId: `generation:${generation}`,
              onDispatchError: (item, error) => {
                logger.warn(formatCompact({
                  op: 'workroom_remote_dispatch_failed',
                  dispatchId: item.dispatchId,
                  status: item.status,
                  error: error instanceof Error ? error.message : String(error),
                }));
              },
            },
          );
          dispatchScheduler = createdDispatchScheduler;
          const createdDispatchCommand = callbackRuntime.createDispatchCommandService(
            dispatchService,
            createdDispatchScheduler,
          );
          dispatchCommand = createdDispatchCommand;
          resources.provide(workroomRemoteExecutorToken, remoteTransport);
          resources.provide(workroomRemoteEndpointAuthorityToken, remoteTransport);
          resources.provide(
            remoteAssignmentDispatchServiceToken,
            dispatchService,
          );
          resources.provide(
            remoteAssignmentDispatchSchedulerToken,
            createdDispatchScheduler,
          );
          if (!resources.has(workroomRemoteAssignmentAuthorityToken)
            && resources.has(workroomProjectProfileRegistryToken)
            && resources.has(workroomAssignmentAuthorityGrantToken)) {
            const agentHost = resources.use(agentHostToken);
            resources.provide(
              workroomRemoteAssignmentAuthorityToken,
              Object.freeze({
                resolve: async (
                  input: WorkroomRemoteAssignmentAuthorityInput,
                ): Promise<WorkroomRemoteAssignmentResolvedAuthority> => {
                  const lease = options.snapshots.acquire();
                  try {
                    if (lease.value.generation !== generation) {
                      throw new Error(
                        'Workroom Assignment authority generation is no longer current',
                      );
                    }
                    const generationSupply =
                      createWorkroomGenerationAuthoritySnapshotFromRuntime(
                        lease.value,
                        agentHost.protocol.listBindings(),
                      );
                    return await new GenerationOwnedWorkroomAssignmentAuthorityProvider({
                      generation: generationSupply,
                      profiles: resources.use(workroomProjectProfileRegistryToken),
                      catalog: agentHost.console.workroomCatalog,
                      grants: resources.use(workroomAssignmentAuthorityGrantToken),
                      endpoints: remoteTransport,
                    }).resolve(input);
                  } finally {
                    lease.release();
                  }
                },
              }),
            );
          }
          if (resources.has(workroomRemoteAssignmentAuthorityToken)) {
            if (!resources.has(workroomAssignmentAuthorityGrantRepositoryToken)
              || !resources.has(workroomAssignmentGrantClaimPreviewToken)) {
              throw new Error('Remote Assignment requires the durable Grant repository and exact claim preview');
            }
            const grantApplication = new WorkroomAssignmentAuthorityGrantApplication({
              generation,
              repository: resources.use(workroomAssignmentAuthorityGrantRepositoryToken),
              preview: resources.use(workroomAssignmentGrantClaimPreviewToken),
              ...(resources.has(workroomAssignmentGrantAuthorityMaterializerToken)
                ? { authority: resources.use(workroomAssignmentGrantAuthorityMaterializerToken) }
                : {}),
              ...(resources.has(workroomAssignmentWorkspaceAllocatorToken)
                ? { workspace: resources.use(workroomAssignmentWorkspaceAllocatorToken) }
                : {}),
              ...(resources.has(workroomAssignmentDisclosureManifestAuthorityToken)
                ? { disclosure: resources.use(workroomAssignmentDisclosureManifestAuthorityToken) }
                : {}),
            });
            resources.provide(
              workroomAssignmentAuthorityGrantApplicationToken,
              grantApplication,
            );
            const grantAwareDispatchCommand = new GrantAwareRemoteAssignmentDispatchCommandService({
              delegate: createdDispatchCommand,
              grants: grantApplication,
            });
            resources.provide(
              remoteAssignmentDispatchCommandServiceToken,
              grantAwareDispatchCommand,
            );
            if (resources.has(workroomSchedulerAssignmentRouteRegistryToken)) {
              const unregisterRemoteRoute = resources
                .use(workroomSchedulerAssignmentRouteRegistryToken)
                .register({
                  providerId: `remote-a2a-bindings:generation:${generation}`,
                  generation,
                  resolve: async ({ decision, catalog }) => {
                    const definition = catalog.definitions[decision.projectId];
                    const routes = (definition?.members ?? []).filter(member =>
                      member.role === decision.role
                      && member.assignmentRoute?.kind === 'remote');
                    if (routes.length !== 1) return null;
                    const route = routes[0]!;
                    const assignmentRoute = route.assignmentRoute;
                    if (!assignmentRoute || assignmentRoute.kind !== 'remote') return null;
                    const endpointId = assignmentRoute.endpointId;
                    const binding = remoteExecutors!.bindings.find(candidate =>
                      candidate.enabled && candidate.endpointId === endpointId);
                    if (!binding) return null;
                    const endpointAuthority = remoteTransport.resolve(endpointId);
                    if (!endpointAuthority || endpointAuthority.generation !== generation) return null;
                    return Object.freeze({
                      kind: 'remote' as const,
                      agentDefinitionId: route.agent,
                      endpointId,
                      authorityRef: `generation:${generation}:remote-a2a:${endpointAuthority.transportBindingDigest}`,
                    });
                  },
                });
              lifecycle.add(unregisterRemoteRoute);
            } else {
              logger.warn(formatCompact({
                op: 'workroom_remote_scheduler_route_unavailable',
                generation,
                reason: 'generation_owned_route_registry_not_installed',
              }));
            }
          } else {
            logger.warn(formatCompact({
              op: 'workroom_remote_assignment_issuer_unavailable',
              generation,
              reason: 'active_profile_capability_authority_not_installed',
            }));
          }
          lifecycle.add(() => createdDispatchScheduler.stop());
        }
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
          path: callbackPath,
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
              path: callbackPath,
              generation,
              bindings: callbacks.bindings.length,
              recovered: recovery.recovered,
              recoveryFailed: recovery.failed,
            }));
          },
        });
        if (dispatchScheduler) {
          if (!dispatchCommand) {
            throw new Error('Remote Assignment Dispatch command producer was not created');
          }
          const command = dispatchCommand;
          handoff.add({
            activateNext: async (signal) => {
              signal.throwIfAborted();
              const recovery = await command.recover();
              const blocked = recovery.filter(item => item.status === 'blocked');
              logger.info(formatCompact({
                op: 'workroom_remote_dispatch_recovery',
                generation,
                admitted: recovery.length - blocked.length,
                blocked: blocked.length,
              }));
            },
          });
          handoff.add({
            activateNext: async (signal) => {
              signal.throwIfAborted();
              dispatchScheduler?.start();
            },
          });
        }
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

function normalizeProtocolPath(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  const path = value.trim().startsWith('/') ? value.trim() : `/${value.trim()}`;
  if (path.includes('?') || path.includes('#') || path.includes('\\') || path.includes('//')) {
    throw new Error(`${field} must be a canonical absolute path`);
  }
  return path.length > 1 ? path.replace(/\/+$/u, '') : path;
}

function resolveCallbackPublicUrl(baseValue: string, path: string, production: boolean): string {
  let base: URL;
  try {
    base = new URL(baseValue);
  } catch (error) {
    throw new Error('A2A callback public URL is invalid', { cause: error });
  }
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new Error('A2A callback public URL must be an origin without credentials, path, query or fragment');
  }
  if (production && (base.protocol !== 'https:'
    || ['127.0.0.1', 'localhost', '::1'].includes(base.hostname))) {
    throw new Error('Production Workroom callbacks require a public HTTPS a2a.publicUrl');
  }
  return `${base.origin}${path}`;
}
