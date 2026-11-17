import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { readFeatureConversationOverrides, type DatabaseHost, type RuntimeSnapshot, type SnapshotLease, type SnapshotReader } from '@zhin.js/plugin-runtime';
import { AMBIENT_ENGAGE_FIELD, AMBIENT_FEATURE_ID } from '@zhin.js/core/runtime';
import { modelAvailability, type ModelAvailabilityRegistry } from '@zhin.js/ai';
import {
  ambientJudgeChain,
  createInferenceRuntime,
  createSnapshotProviderResolver,
  DEFAULT_AMBIENT_MIN_CONFIDENCE,
  effectiveAmbientJudgePolicy,
  type LegacyAmbientTrigger,
  type ProviderGraph,
  describeSnapshotAiProvider,
  listSnapshotAiProviders,
  normalizeProviderGraph,
  ProviderBindingResourceOwner,
  ProviderError,
  type ProviderDefinition,
  type ProviderService,
  type InferenceOperationScope,
  type ProviderExecutionContext,
} from '@zhin.js/ai/provider';
import { applyModelCapabilityDefaults } from '@zhin.js/ai/providers';
import { getLogger } from '@zhin.js/logger';
import { PersonalSessionService, type PersonalSessionOwner } from '../../personal-session/index.js';
import {
  createScopedPerceptionFactory,
  type ModelRuntimeServiceOptions,
  type ModelExecutionScope,
  type TurnModelPort,
} from '../../model-runtime/index.js';
import type { AIService } from '../../index.js';
import { runWithAgentTurnConfiguration } from '../../turn/index.js';
import { hostModelOwnerId } from './host-identity.js';
import { DatabaseInferenceRepository } from './repository.js';
import { InferenceCredentialStore, type EnvironmentExpressionSource, type OAuthExchangeFailure } from './credentials.js';
import { HostAccountRuntime } from './account-runtime.js';
import { createProviderNetwork, matchesProviderTarget } from './network.js';
import { InferenceManagementService, InferenceManagementError, inferencePurposeEffects, type AmbientDeploymentView, type InferencePurposeEffect } from './management.js';
import type { AccountStatusView } from './account-runtime-helpers.js';
import { pruneInferenceFailures, type InferenceFailureJournal } from './failure-journal.js';
import { projectProviderSupport } from './support-metadata.js';
import { InferenceSessionRepository } from './session-state.js';
import { resolveInferenceTurnContext } from './turn-context.js';
import { InferenceSessionManagement } from './session-management.js';
import { createInferenceTargetsReader, readAgentPurposeTargets, type InferenceTargetsReader } from './targets.js';
import { createPersonalSessionDirectory } from './session-directory.js';
import { createCredentialRequestAccess, type CredentialTransportFact } from './request-access.js';
import { probeLanguageProfile, type InferenceProbeResult } from './probe.js';

export interface InferenceManagementLease {
  readonly management: InferenceManagementService;
  readonly accounts: HostAccountRuntime;
  readonly sessions: InferenceSessionManagement;
  readonly targets?: InferenceTargetsReader;
  readonly authenticationContract: (accountId: string) => Promise<string>;
  /** One minimal tool-carrying request to a Host language Profile (connectivity test, #1250). */
  readonly probe?: (input: Readonly<{ profileId: string; signal: AbortSignal }>) => Promise<InferenceProbeResult>;
  release(): void | Promise<void>;
}

export interface HostInferenceOptions {
  readonly projectRoot: string;
  readonly database: DatabaseHost;
  readonly snapshots: () => SnapshotReader;
  readonly resolveSource: (source: string | EnvironmentExpressionSource) => string | undefined | Promise<string | undefined>;
  /**
   * Personal inference owners. ADR 0060 P3: a function is read on every management lease, so the
   * Host can answer from the person ↔ Console links (and the current adapters) instead of a list
   * fixed at start.
   */
  readonly personalOwners: readonly PersonalSessionOwner[] | (() => readonly PersonalSessionOwner[]);
  /** Trusted process-private in-flight evidence only; not a Console or persistent audit sink. */
  readonly observeCredentialTransport?: (fact: CredentialTransportFact) => void | Promise<void>;
  /** Instance runtime failure journal (#1270); preparation and model call failures survive a restart. */
  readonly failureJournal?: InferenceFailureJournal;
  /**
   * The current `ai.trigger.ambient` section (undefined when absent), for `purposeEffects.ambient`
   * (ADR 0066 D7). Without it the interjection judge is always reported as effective.
   */
  readonly ambientTrigger?: () => Readonly<{ conversations?: readonly string[] }> | undefined;
}

/**
 * A Host model account that needs an operator (#1270), for the Console attention inbox:
 * - `reauthorize` / `disconnected` / `uncertain`: the stored credential's state;
 * - `preparation-failed`: signed in, but the read-only preparation failed (with its reason).
 */
export interface InferenceAccountAttention {
  readonly accountId: string;
  readonly label: string;
  readonly serviceLabel: string;
  readonly state: 'reauthorize' | 'disconnected' | 'uncertain' | 'preparation-failed';
  readonly revision: number;
  readonly preparationFailure?: AccountStatusView['preparationFailure'];
  /** Uncertain sign-in exchanges: the classified failure kind and the upstream HTTP status. */
  readonly failure?: OAuthExchangeFailure['kind'];
  readonly failureStatus?: number;
}

/** One member of the interjection judge as the Console ambient status shows it (ADR 0066 D7). */
export interface AmbientJudgeMemberView {
  readonly profile: string;
  /** `<service>/<model>` for display. */
  readonly label: string;
  readonly kind?: 'language' | 'decision';
  readonly role: 'primary' | 'fallback' | 'compare';
  /** In the shared skip table until this time (epoch ms). */
  readonly skippedUntil?: number;
  readonly skipReason?: string;
}
/** The interjection judge in effect (ADR 0066 D7). */
export interface AmbientJudgeStatusView {
  readonly chain: readonly AmbientJudgeMemberView[];
  readonly inheritedFrom?: 'chat';
  readonly compare?: AmbientJudgeMemberView;
  readonly mode: 'active' | 'shadow';
  readonly minConfidence: number;
}

/**
 * The interjection judge in effect for `graph` (ADR 0066 D7): chain members in order with their
 * kind and skip period, the compared model, the mode and the threshold. Pure over the inputs.
 */
export function ambientJudgeStatusView(graph: ProviderGraph, trigger: LegacyAmbientTrigger | undefined, registry: ModelAvailabilityRegistry): AmbientJudgeStatusView {
  const { policy } = effectiveAmbientJudgePolicy(graph.purposes, trigger);
  const chain = ambientJudgeChain(graph.purposes);
  const member = (profileId: string, role: AmbientJudgeMemberView['role']): AmbientJudgeMemberView => {
    const profile = Object.hasOwn(graph.profiles, profileId) ? graph.profiles[profileId] : undefined;
    const account = profile ? graph.accounts[profile.accountId] : undefined;
    const service = account ? graph.services[account.serviceId] : undefined;
    const kinds = profile && service ? service.models[profile.model]?.kinds ?? [] : [];
    const kind = kinds.includes('language') ? 'language' as const : kinds.includes('decision') ? 'decision' as const : undefined;
    const skipped = profile && account ? registry.unavailable(account.id, profile.model) : undefined;
    return Object.freeze({ profile: profileId, ...(kind ? { kind } : {}), role,
      label: profile && service ? `${service.label ?? service.driver.id}/${profile.model}` : profileId,
      ...(skipped ? { skippedUntil: skipped.until, skipReason: skipped.reason } : {}) });
  };
  return Object.freeze({
    chain: Object.freeze(chain.ids.map((id, index) => member(id, index === 0 ? 'primary' : 'fallback'))),
    ...(chain.inheritedFrom ? { inheritedFrom: chain.inheritedFrom } : {}),
    ...(policy.compare ? { compare: member(policy.compare, 'compare') } : {}),
    mode: policy.mode ?? 'active',
    minConfidence: policy.minConfidence ?? DEFAULT_AMBIENT_MIN_CONFIDENCE,
  });
}

/** One process owns encrypted authentication; each invocation borrows exactly its operation generation. */
export class HostInference {
  readonly rootId: string;
  readonly hostOwnerId: string;
  readonly repository: DatabaseInferenceRepository;
  readonly accounts: HostAccountRuntime;
  readonly sessions: PersonalSessionService;
  readonly #resources = new ProviderBindingResourceOwner(() =>
    getLogger('inference').warn('Provider state cleanup failed')
  );
  constructor(private readonly options: HostInferenceOptions) {
    this.rootId = resolve(options.projectRoot);
    this.hostOwnerId = hostModelOwnerId(options.projectRoot);
    this.repository = new DatabaseInferenceRepository({
      database: options.database,
      normalizeGraph: normalizeProviderGraph,
    });
    this.sessions = new PersonalSessionService(
      new InferenceSessionRepository(() => options.database.state)
    );
    const credentials = new InferenceCredentialStore({
      directory: join(options.projectRoot, '.zhin', 'inference'),
      repository: this.repository,
    });
    this.accounts = new HostAccountRuntime({
      repository: this.repository,
      credentials,
      hostOwnerId: this.hostOwnerId,
      drivers: {
        acquire: async (input) => {
          const snapshots = options.snapshots(),
            lease = snapshots.acquire();
          try {
            return await createSnapshotProviderResolver({
              snapshots,
              lease,
            }).acquire(input);
          } finally {
            lease.release();
          }
        },
      },
      fetch: ({ service, account, definition, purpose, retainTransportState }) =>
        this.accounts.bindFetch(
          account,
          createProviderNetwork({
            account,
            service,
            definition,
            hostOwnerId: this.hostOwnerId,
            purpose: purpose ?? 'authentication',
            retainTransportState,
          }),
          retainTransportState
        ),
      allowTarget: ({ service, definition, target, purpose }) =>
        matchesProviderTarget(target, definition.targets(service)[purpose] ?? []),
      resolveSource: options.resolveSource,
      ...(options.failureJournal ? { failureJournal: options.failureJournal } : {}),
    });
  }

  /**
   * Drops journaled account / model failures that are no longer current (#1270): accounts removed
   * from the graph, and account entries of another credential revision than the stored one.
   */
  async pruneFailureJournal(): Promise<void> {
    const journal = this.options.failureJournal;
    if (!journal) return;
    const graph = await this.repository.readGraph({ rootId: this.rootId });
    if (!graph) return;
    pruneInferenceFailures(journal, await this.accounts.statuses({ graph, accounts: Object.values(graph.accounts) }));
  }

  #pruneFailureJournal(graph: Readonly<{ accounts: Readonly<Record<string, unknown>> }>): void {
    const journal = this.options.failureJournal;
    if (!journal?.retain) return;
    const exists = (subject: string) => Object.hasOwn(graph.accounts, subject);
    try {
      journal.retain('account', exists, { graceMs: 0 });
      journal.retain('model', exists, { graceMs: 0 });
    } catch { /* never breaks a read */ }
  }

  /** Host-owned accounts that need an operator (#1270); empty while inference storage is unavailable. */
  async accountAttention(): Promise<readonly InferenceAccountAttention[]> {
    const graph = await this.repository.readGraph({ rootId: this.rootId });
    if (!graph) return [];
    this.#pruneFailureJournal(graph);
    const accounts = Object.values(graph.accounts).filter(account => account.ownerId === this.hostOwnerId);
    const statuses = await this.accounts.statuses({ graph, accounts });
    const rows: InferenceAccountAttention[] = [];
    for (const account of accounts) {
      const status = statuses[account.id];
      if (!status) continue;
      const service = graph.services[account.serviceId];
      const common = {
        accountId: account.id,
        label: account.label ?? account.id,
        serviceLabel: service?.label ?? service?.driver.id ?? account.serviceId,
        revision: status.revision,
      };
      if (status.status === 'reauthorize' || status.status === 'disconnected' || status.status === 'uncertain') {
        rows.push(Object.freeze({ ...common, state: status.status,
          ...(status.failure ? { failure: status.failure.kind, ...(status.failure.status === undefined ? {} : { failureStatus: status.failure.status }) } : {}) }));
      } else if (status.status === 'authenticated' && status.preparation === 'required' && status.preparationFailure) {
        rows.push(Object.freeze({ ...common, state: 'preparation-failed', preparationFailure: status.preparationFailure }));
      }
    }
    return Object.freeze(rows);
  }

  /** Effect of each `purposes.agents` key in `lease`'s generation (#1270); empty without agent purposes. */
  async purposeEffects(lease: SnapshotLease): Promise<Readonly<Record<string, InferencePurposeEffect>>> {
    const graph = await this.repository.readGraph({ rootId: this.rootId });
    if (!graph?.purposes.agents) return Object.freeze({});
    return inferencePurposeEffects(graph.purposes.agents, readAgentPurposeTargets(lease.value));
  }

  modelRuntimeOptions(): ModelRuntimeServiceOptions {
    return {
      rootId: this.rootId,
      hostOwnerId: this.hostOwnerId,
      inferenceFactory: ({ lease }) => this.createInference(lease),
      context: ({ request }) =>
        resolveInferenceTurnContext(
          {
            rootId: this.rootId,
            hostOwnerId: this.hostOwnerId,
            sessions: this.sessions,
          },
          request
        ),
    };
  }

  turnPort(service: AIService): TurnModelPort {
    const perception = createScopedPerceptionFactory();
    return {
      acquire: (input) => service.getModelRuntime().acquireForTurn(input),
      createPerception: (scope, request) =>
        perception({
          scope,
          sessionKey: request.session.key,
          settings: service.getPerceptionConfig(),
          resilience: service.getAgentConfig()?.providerResilience,
        }),
    };
  }

  /** Independent Host work starts one real operation. Its lease is released with its model scope. */
  async acquireDeploymentModels(
    input: Readonly<{
      service: AIService;
      bindingName?: string;
      sessionKey?: string;
      operationId?: string;
      signal?: AbortSignal;
      lease?: SnapshotLease;
    }>
  ): Promise<ModelExecutionScope> {
    const snapshots = this.options.snapshots(),
      lease = input.lease ? snapshots.retain(input.lease) : snapshots.acquire();
    try {
      const models = await input.service.getModelRuntime().acquireForContext({
        lease,
        snapshots,
        context: {
          rootId: this.rootId,
          hostOwnerId: this.hostOwnerId,
          ownerId: this.hostOwnerId,
          operationId: input.operationId ?? randomUUID(),
          ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
        },
        bindingName: input.bindingName,
        signal: input.signal,
      });
      let released: Promise<void> | undefined;
      return Object.freeze({
        ...models,
        release: () =>
          (released ??= (async () => {
            try {
              await models.release();
            } finally {
              lease.release();
            }
          })()),
      });
    } catch (error) {
      lease.release();
      throw error;
    }
  }

  async withDeploymentModels<T>(
    input: Readonly<{
      service: AIService;
      lease?: SnapshotLease;
      sessionKey?: string;
      operationId?: string;
      signal?: AbortSignal;
    }>,
    operation: () => Promise<T>
  ): Promise<T> {
    const models = await this.acquireDeploymentModels(input);
    try {
      return await runWithAgentTurnConfiguration(
        {
          models,
          activeBinding: input.service.getBindingRegistry().requireZhinBinding(),
        },
        operation
      );
    } finally {
      await models.release();
    }
  }

  async withInferenceScope<T>(
    input: Readonly<{
      lease: SnapshotLease;
      sessionKey: string;
      signal: AbortSignal;
      operationId?: string;
    }>,
    operation: (scope: InferenceOperationScope) => Promise<T>
  ): Promise<T> {
    const runtime = this.createInference(input.lease);
    const scope = await runtime.openScope({
      context: {
        rootId: this.rootId,
        hostOwnerId: this.hostOwnerId,
        ownerId: this.hostOwnerId,
        operationId: input.operationId ?? randomUUID(),
        sessionKey: input.sessionKey,
      },
      signal: input.signal,
    });
    try {
      return await operation(scope);
    } finally {
      await scope.close();
      runtime.retire();
    }
  }

  /**
   * The interjection judge actually used in the Console request's generation (ADR 0066 D7): the
   * chain members in order (kind, whether in their skip period), the compared model, the mode and
   * the threshold. Metadata only.
   */
  async ambientModels(
    input: Readonly<{ lease: SnapshotLease; signal: AbortSignal }>
  ): Promise<AmbientJudgeStatusView> {
    // The graph of the Console request's own operation (its held generation), as the judge reads it.
    return this.withInferenceScope({ ...input, sessionKey: 'console:ambient-status' },
      async scope => ambientJudgeStatusView(scope.graph, this.options.ambientTrigger?.() as LegacyAmbientTrigger | undefined, modelAvailability));
  }

  createInference(lease: SnapshotLease, beforeSubmit?: () => void) {
    const snapshots = this.options.snapshots();
    if (!snapshots.owns(lease) || !lease.active)
      throw new Error('Inference requires this Host operation lease');
    const accesses = new WeakMap<
      ProviderExecutionContext,
      ReturnType<typeof createCredentialRequestAccess>
    >();
    const access = (execution: ProviderExecutionContext) => {
      let value = accesses.get(execution);
      if (!value) {
        const { account, service } = execution.binding;
        value = createCredentialRequestAccess({
          account,
          service,
          authenticationContract:
            account.authentication.method === 'oauth'
              ? execution.driver.authentication.oauth!.contractVersion
              : execution.driver.contractVersion,
          credentials: this.accounts.createPort(execution),
          beforeSubmit,
          observe: this.options.observeCredentialTransport,
          network: (submit, retainTransportState) =>
            this.accounts.observeCalls(account, this.accounts.bindFetch(
              account,
              createProviderNetwork({
                account,
                service,
                definition: execution.driver,
                hostOwnerId: this.hostOwnerId,
                purpose: 'inference',
                beforeSubmit: submit,
                retainTransportState,
              }),
              retainTransportState
            )),
        });
        accesses.set(execution, value);
      }
      return value;
    };
    return createInferenceRuntime({
      repository: this.repository,
      drivers: createSnapshotProviderResolver({ snapshots, lease }),
      resources: this.#resources,
      generationIdentity: lease.value,
      credentials: (execution) => access(execution).credentials,
      fetch: (execution) => access(execution).fetch,
    });
  }

  /** ADR 0066 D7: whether interjection can run in `snapshot`'s generation. */
  #ambientDeployment(snapshot: RuntimeSnapshot): AmbientDeploymentView | undefined {
    if (!this.options.ambientTrigger) return undefined;
    const trigger = this.options.ambientTrigger();
    // Stored feature switches (ADR 0062 §23): only a reader that can list them tells "none is on".
    const reader = readFeatureConversationOverrides(snapshot) as { list?: () => readonly Readonly<{ plugin: string; enabled?: boolean; patch?: Readonly<Record<string, unknown>> }>[] } | undefined;
    const switchesOn = typeof reader?.list === 'function'
      ? reader.list().some(row => row.plugin === AMBIENT_FEATURE_ID && row.enabled !== false && row.patch?.[AMBIENT_ENGAGE_FIELD] === true) : undefined;
    return Object.freeze({ configured: trigger !== undefined, conversations: trigger?.conversations?.length ?? 0,
      ...(switchesOn !== undefined ? { switchesOn } : {}) });
  }

  acquireManagement(): InferenceManagementLease {
    const snapshots = this.options.snapshots(),
      lease = snapshots.acquire();
    const definition = (service: ProviderService): ProviderDefinition<unknown, unknown> => {
      const entry = describeSnapshotAiProvider({
        snapshot: lease.value,
        id: service.driver.id,
        owner: service.driver.owner,
      });
      if (entry.definition.contractVersion !== service.driver.contractVersion)
        throw new ProviderError('driver-contract-mismatch');
      return entry.definition;
    };
    const management = new InferenceManagementService({
      agentTargets: () => readAgentPurposeTargets(lease.value),
      ambientDeployment: () => this.#ambientDeployment(lease.value),
      ...(this.options.ambientTrigger ? { ambientTrigger: this.options.ambientTrigger as () => LegacyAmbientTrigger | undefined } : {}),
      rootId: this.rootId,
      hostOwnerId: this.hostOwnerId,
      directory: join(this.options.projectRoot, '.zhin', 'inference'),
      repository: this.repository,
      accounts: this.accounts,
      drivers: () =>
        listSnapshotAiProviders(lease.value).map(({ owner, definition }) => {
          const support = projectProviderSupport(definition.support);
          return {
            owner,
            id: definition.id,
            contractVersion: definition.contractVersion,
            label: definition.label ?? definition.id,
            source: lease.value.tree.get(owner)?.packageName ?? String(owner),
            authentication: definition.authentication.methods,
            discovery: typeof definition.discover === 'function',
            ...(definition.authentication.oauth?.requiresClientSecret ? { requiresClientSecret: true } : {}),
            ...(definition.modelSuggestions?.length
              ? { modelSuggestions: definition.modelSuggestions.map(({ id, label }) => ({ id, ...(label ? { label } : {}) })) }
              : {}),
            ...(definition.serviceSchema.inputSchema
              ? { serviceSchema: definition.serviceSchema.inputSchema }
              : {}),
            modelContracts: definition.modelContracts ?? [],
            ...(support ? { support } : {}),
          };
        }),
      profileSchema: ({ service, model }) => {
        const driver = definition(service);
        try {
          return driver.profileSchema?.({
            service: {
              ...service,
              options: driver.serviceSchema.parse(service.options),
            },
            model,
          });
        } catch {
          throw new InferenceManagementError('invalid-input');
        }
      },
      authenticationContract: (account, service) => {
        const driver = definition(service);
        if (
          !driver.authentication.methods.includes(account.authentication.method) ||
          (account.authentication.method === 'oauth' && !driver.authentication.oauth)
        )
          throw new InferenceManagementError('invalid-input');
        return account.authentication.method === 'oauth'
          ? driver.authentication.oauth!.contractVersion
          : driver.contractVersion;
      },
      discover: async ({ account, service, signal }) => {
        const driver = definition(service);
        if (!driver.discover) throw new InferenceManagementError('unsupported');
        const credentials = this.accounts.createAccountPort({
          account,
          service,
          definition: driver,
          purpose: 'discovery',
          retainDriver: () => {
            const retained = snapshots.retain(lease);
            return {
              definition: driver,
              reference: service.driver,
              release: () => retained.release(),
            };
          },
        });
        const retained = new Set<Request | AbortSignal>();
        const access = createCredentialRequestAccess({
          account,
          service,
          credentials,
          retainBoundRequest: (request) => {
            retained.add(request);
          },
          authenticationContract:
            account.authentication.method === 'oauth'
              ? driver.authentication.oauth!.contractVersion
              : driver.contractVersion,
          observe: this.options.observeCredentialTransport,
          network: (beforeSubmit, retainTransportState) =>
            this.accounts.bindFetch(
              account,
              createProviderNetwork({
                account,
                service,
                definition: driver,
                hostOwnerId: this.hostOwnerId,
                purpose: 'discovery',
                beforeSubmit,
                retainTransportState,
              }),
              retainTransportState
            ),
        });
        try {
          return await driver.discover({
            service,
            credentials: access.credentials,
            signal,
            fetch: access.fetch,
          });
        } finally {
          retained.clear();
        }
      },
      resolveService: (input) => {
        const reference =
          typeof input.driver === 'string'
            ? {
                id: input.driver,
                ...(input.existing ? { owner: input.existing.driver.owner } : {}),
              }
            : input.driver;
        const entry = describeSnapshotAiProvider({
          snapshot: lease.value,
          id: reference.id,
          ...(reference.owner ? { owner: reference.owner } : {}),
        });
        if (
          'contractVersion' in reference &&
          reference.contractVersion !== entry.definition.contractVersion
        )
          throw new ProviderError('driver-contract-mismatch');
        const options = entry.definition.serviceSchema.parse(input.options);
        const enrichedModels = Object.fromEntries(
          Object.entries(input.models).map(([id, model]) => [
            id,
            applyModelCapabilityDefaults(model),
          ]),
        );
        const service: ProviderService<unknown> = {
          id: input.existing?.id ?? `preview:${randomUUID()}`,
          rootId: this.rootId,
          ownerId: input.existing?.ownerId ?? this.hostOwnerId,
          revision: input.existing?.revision ?? 1,
          driver: {
            id: entry.definition.id,
            owner: entry.owner,
            contractVersion: entry.definition.contractVersion,
          },
          options,
          models: enrichedModels,
        };
        return {
          driver: service.driver,
          options: options as ProviderService['options'],
          models: entry.definition.models(service),
          ...(entry.definition.identity
            ? {
                identity: (candidate: ProviderService) =>
                  entry.definition.identity!({
                    ...candidate,
                    options: entry.definition.serviceSchema.parse(candidate.options),
                  }),
              }
            : {}),
        };
      },
    });
    return {
      management,
      accounts: this.accounts,
      targets: createInferenceTargetsReader({
        rootId: this.rootId,
        lease,
        database: this.options.database,
      }),
      sessions: new InferenceSessionManagement({
        rootId: this.rootId,
        hostOwnerId: this.hostOwnerId,
        owners: typeof this.options.personalOwners === 'function' ? this.options.personalOwners() : this.options.personalOwners,
        sessions: this.sessions,
        repository: this.repository,
        directory: createPersonalSessionDirectory(() => this.options.database),
      }),
      authenticationContract: async (accountId) => {
        const graph = await management.graph(),
          account = graph.accounts[accountId];
        if (!account) throw new Error('Account no longer exists');
        const driver = definition(graph.services[account.serviceId]!);
        return account.authentication.method === 'oauth'
          ? driver.authentication.oauth!.contractVersion
          : driver.contractVersion;
      },
      probe: ({ profileId, signal }) =>
        this.withInferenceScope({ lease, sessionKey: 'console:connectivity-probe', signal },
          scope => probeLanguageProfile({ client: scope.client, profileId, signal })),
      release: () => lease.release(),
    };
  }
  retireDriver(definition: ProviderDefinition<unknown, unknown>): void {
    this.#resources.retireDriver(definition);
  }
  retireUnusedDrivers(definitions: readonly ProviderDefinition<unknown, unknown>[]): void {
    let lease: SnapshotLease | undefined;
    try {
      lease = this.options.snapshots().acquire();
      const retained = new Set(
        listSnapshotAiProviders(lease.value).map((entry) => entry.definition)
      );
      for (const definition of definitions)
        if (!retained.has(definition)) this.#resources.retireDriver(definition);
    } catch {
      for (const definition of definitions) this.#resources.retireDriver(definition);
    } finally {
      lease?.release();
    }
  }
  async close(): Promise<void> {
    this.#resources.retire();
    await this.accounts.close();
  }
}
