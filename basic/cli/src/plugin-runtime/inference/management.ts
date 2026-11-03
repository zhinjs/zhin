import { randomUUID } from 'node:crypto';
import {
  normalizeProviderGraph,
  providerPlanFingerprint,
  reviewProviderPlan,
  changedPurposeProfileIds,
  type JsonObject,
  type ProviderAccount,
  type ProviderCredentialWrite,
  type ProviderGraph,
  type ProviderMutationResult,
  type ReviewProviderPlanOptions,
  type ReviewedProviderPlan,
  type ProviderModelObservation,
  type AuthenticationMethod,
  type ModelKind,
  type ModelDefinition,
  type ModelProfile,
  type ProviderService,
  type PurposePolicy,
  type ProviderSchema,
  normalizeProviderJson,
} from '@zhin.js/ai/provider';
import { createHostDocumentCipher } from '../host-credential-storage.js';
import { InferenceCredentialStore, credentialMaterialFingerprint } from './credentials.js';
import { createPersonalModelFetch } from './personal-network.js';
import { HostAccountRuntime, type AccountStatusView } from './account-runtime.js';
import { DatabaseInferenceRepository } from './repository.js';

/** Constructed by the authenticated Host route, never accepted from a request body. */
export interface InferenceManagementPrincipal {
  readonly ownerId: string;
  readonly hostAdministrator: boolean;
}
export class InferenceManagementError extends Error {
  constructor(
    readonly code: 'invalid-input' | 'forbidden' | 'conflict' | 'unavailable' | 'unsupported'
  ) {
    super(`Inference management: ${code}`);
    this.name = 'InferenceManagementError';
  }
}
/** A rejected apply carries its original error and proof that no mutation was invoked. */
export class InferenceApplyRejectedError extends Error {
  readonly code?: string;
  constructor(readonly rejection: unknown) {
    super('Inference apply was not submitted', { cause: rejection });
    this.name = 'InferenceApplyRejectedError';
    if (rejection instanceof Error && 'code' in rejection && typeof rejection.code === 'string')
      this.code = rejection.code;
  }
}
export interface InferenceManagementOptions {
  readonly rootId: string;
  readonly hostOwnerId: string;
  readonly directory: string;
  readonly repository: DatabaseInferenceRepository;
  readonly accounts: HostAccountRuntime;
  /** Acquires a held generation outside this service; compilation is pure local. */
  readonly resolveService: ReviewProviderPlanOptions['resolveService'];
  readonly profileSchema: (
    input: Readonly<{ service: ProviderService; model: ModelDefinition }>
  ) => ProviderSchema<unknown> | undefined;
  /** Validates the method against the exact held Driver before resolving its private contract. */
  readonly authenticationContract: (
    account: ProviderAccount,
    service: ProviderGraph['services'][string]
  ) => string;
  readonly discover: (
    input: Readonly<{
      account: ProviderAccount;
      service: ProviderGraph['services'][string];
      signal: AbortSignal;
    }>
  ) => Promise<readonly ProviderModelObservation[]>;
  readonly drivers: () => readonly InferenceDriverView[];
}
/** Serializable authoring metadata from the held declaration; no parser functions or credentials. */
export interface InferenceDriverView {
  readonly id: string;
  readonly owner: string;
  readonly contractVersion: string;
  readonly label: string;
  readonly source?: string;
  readonly authentication: readonly AuthenticationMethod[];
  readonly serviceSchema?: Readonly<Record<string, unknown>>;
  readonly modelContracts: readonly Readonly<{
    protocol: string;
    kinds: readonly ModelKind[];
  }>[];
}
export interface InferenceManagementView {
  readonly rootId: string;
  readonly revision: number;
  readonly ownerId: string;
  readonly hostAdministrator: boolean;
  readonly services: Readonly<Record<string, ProviderService>>;
  readonly accounts: Readonly<Record<string, ProviderAccount>>;
  readonly profiles: Readonly<Record<string, ModelProfile>>;
  readonly statuses: Readonly<Record<string, AccountStatusView>>;
  readonly deployment: readonly Readonly<{
    id: string;
    label?: string;
    model: string;
    accountId: string;
    accountIncarnation: string;
    definition: ModelDefinition;
  }>[];
  readonly drivers: readonly InferenceDriverView[];
  readonly purposes?: PurposePolicy;
}
interface PreparedMutation {
  readonly kind: 'graph' | 'credential';
  readonly rootId: string;
  readonly ownerId: string;
  readonly baseRevision: number;
  readonly graph: ProviderGraph;
  readonly credentials: readonly ProviderCredentialWrite[];
  readonly removedAccounts: readonly ProviderAccount[];
  readonly requiredServices: readonly string[];
  readonly requiredAccounts: readonly string[];
  readonly requiredProfiles: readonly string[];
  readonly result: JsonObject;
}
export interface PreparedInferenceChange {
  /** Opaque Host-encrypted input. It contains no bearer credential usable at a provider. */
  readonly prepared: JsonObject;
  readonly fingerprint: string;
  readonly baseRevision: number;
  readonly changes?: ReviewedProviderPlan['changes'];
  readonly bindings?: ReviewedProviderPlan['bindings'];
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new InferenceManagementError('invalid-input');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim())
    throw new InferenceManagementError('invalid-input');
  return value;
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new InferenceManagementError('invalid-input');
  return Number(value);
}

/** Runtime graph is authoritative. Plans are explicit imports, never startup configuration overlays. */
export class InferenceManagementService {
  readonly #cipher: ReturnType<typeof createHostDocumentCipher>;
  constructor(private readonly options: InferenceManagementOptions) {
    this.#cipher = createHostDocumentCipher(options.directory);
  }
  async graph(): Promise<ProviderGraph> {
    return (
      (await this.options.repository.readGraph({
        rootId: this.options.rootId,
      })) ?? {
        rootId: this.options.rootId,
        revision: 0,
        services: {},
        accounts: {},
        profiles: {},
        purposes: { defaults: {} },
      }
    );
  }
  #principal(principal: InferenceManagementPrincipal): void {
    text(principal.ownerId);
    if (principal.hostAdministrator !== (principal.ownerId === this.options.hostOwnerId))
      throw new InferenceManagementError('forbidden');
  }
  async account(principal: InferenceManagementPrincipal, id: string): Promise<ProviderAccount> {
    this.#principal(principal);
    const account = (await this.graph()).accounts[text(id)];
    if (!account || account.ownerId !== principal.ownerId)
      throw new InferenceManagementError('forbidden');
    if (account.authentication.method === 'oauth' && !principal.hostAdministrator)
      throw new InferenceManagementError('forbidden');
    return account;
  }
  async view(principal: InferenceManagementPrincipal): Promise<InferenceManagementView> {
    this.#principal(principal);
    const graph = await this.graph();
    const accounts = Object.fromEntries(
      Object.entries(graph.accounts).filter(([, value]) => value.ownerId === principal.ownerId)
    );
    const profiles = Object.fromEntries(
      Object.entries(graph.profiles).filter(([, value]) => value.ownerId === principal.ownerId)
    );
    const serviceIds = new Set(Object.values(accounts).map((account) => account.serviceId));
    const services = Object.fromEntries(
      Object.entries(graph.services).filter(
        ([id, value]) => value.ownerId === principal.ownerId || serviceIds.has(id)
      )
    );
    const statuses = await this.options.accounts.statuses({
      graph,
      accounts: Object.values(accounts),
    });
    // Host Profiles are consumable, but their account configuration and authentication state are not personal management data.
    const deployment = Object.values(graph.profiles)
      .filter((profile) => profile.ownerId === this.options.hostOwnerId)
      .map((profile) => ({
        id: profile.id,
        label: profile.label,
        model: profile.model,
        accountId: profile.accountId,
        accountIncarnation: graph.accounts[profile.accountId].incarnation,
        definition:
          graph.services[graph.accounts[profile.accountId].serviceId].models[profile.model],
      }));
    return {
      rootId: graph.rootId,
      revision: graph.revision,
      ownerId: principal.ownerId,
      hostAdministrator: principal.hostAdministrator,
      services,
      accounts,
      profiles,
      statuses,
      deployment,
      drivers: this.options.drivers(),
      ...(principal.hostAdministrator ? { purposes: graph.purposes } : {}),
    };
  }
  async review(
    principal: InferenceManagementPrincipal,
    value: unknown
  ): Promise<PreparedInferenceChange> {
    return this.#review(principal, value);
  }
  /** Explicit offline migration only; raw key material never comes from a public plan or HTTP route. */
  async reviewImportedKeys(
    principal: InferenceManagementPrincipal,
    value: unknown,
    keys: ReadonlyMap<string, string>
  ): Promise<PreparedInferenceChange> {
    return this.#review(principal, value, keys);
  }
  async #review(
    principal: InferenceManagementPrincipal,
    value: unknown,
    importedKeys: ReadonlyMap<string, string> = new Map()
  ): Promise<PreparedInferenceChange> {
    this.#principal(principal);
    const input = record(value),
      graph = await this.graph();
    const reviewed = await reviewProviderPlan({
      input: input.plan,
      graph,
      ownerId: principal.ownerId,
      hostOwnerId: this.options.hostOwnerId,
      bindings: input.bindings as ReviewProviderPlanOptions['bindings'],
      createId: (kind) => `${kind}:${randomUUID()}`,
      resolveService: this.options.resolveService,
      validateProfile: (input) => this.#normalizeProfile(input),
    });
    this.#checkEnvironmentSources(reviewed.graph);
    const dependencies = mutationDependencies({
      before: graph,
      after: reviewed.graph,
      changes: reviewed.changes,
    });
    this.#validateAccountAuthentication(reviewed.graph, dependencies.requiredAccounts);
    const credentials: ProviderCredentialWrite[] = [];
    for (const id of reviewed.changes.accounts.removed) {
      const account = graph.accounts[id];
      const current = await this.options.repository.readCredential({
        rootId: graph.rootId,
        accountId: id,
      });
      credentials.push({
        accountId: id,
        expectedIncarnation: account.incarnation,
        expectedRevision: current?.revision ?? 0,
        ...(current ? { expectedAuthContractVersion: current.authContractVersion } : {}),
        record: null,
      });
    }
    const vault = new InferenceCredentialStore({
      directory: this.options.directory,
      repository: this.options.repository,
    });
    for (const [alias, key] of importedKeys) {
      const id = reviewed.bindings.accounts[alias],
        account = reviewed.graph.accounts[id];
      if (
        !account ||
        account.ownerId !== principal.ownerId ||
        !reviewed.changes.accounts.created.includes(id) ||
        account.authentication.method !== 'api-key' ||
        account.authentication.source ||
        !key.trim()
      )
        throw new InferenceManagementError('forbidden');
      const record = await vault.seal({
        account,
        revision: 1,
        authContractVersion: this.options.authenticationContract(
          account,
          reviewed.graph.services[account.serviceId]
        ),
        payload: {
          status: 'ready',
          method: 'api-key',
          key,
          materialFingerprint: credentialMaterialFingerprint(key),
        },
      });
      credentials.push({
        accountId: id,
        expectedIncarnation: account.incarnation,
        expectedRevision: 0,
        record,
      });
    }
    const result: JsonObject = {
      ownerId: principal.ownerId,
      bindings: reviewed.bindings as unknown as JsonObject,
    };
    return {
      ...(await this.#prepare({
        kind: 'graph',
        rootId: graph.rootId,
        ownerId: principal.ownerId,
        baseRevision: graph.revision,
        graph: reviewed.graph,
        credentials,
        removedAccounts: reviewed.changes.accounts.removed.map((id) => graph.accounts[id]!),
        ...dependencies,
        result,
      })),
      changes: reviewed.changes,
      bindings: reviewed.bindings,
    };
  }
  async prepareKey(
    principal: InferenceManagementPrincipal,
    value: unknown
  ): Promise<PreparedInferenceChange> {
    const input = record(value),
      account = await this.account(principal, text(input.accountId));
    const graph = await this.graph();
    const service = graph.services[account.serviceId];
    const write = await this.options.accounts.prepareKey({
      account,
      key: text(input.key),
      expectedRevision: revision(input.expectedRevision),
      authContractVersion: this.options.authenticationContract(account, service),
    });
    return this.#prepare({
      kind: 'credential',
      rootId: graph.rootId,
      ownerId: principal.ownerId,
      baseRevision: graph.revision,
      graph,
      credentials: [write],
      removedAccounts: [],
      requiredServices: [account.serviceId],
      requiredAccounts: [account.id],
      requiredProfiles: [],
      result: {
        ownerId: principal.ownerId,
        accountId: account.id,
        credentialRevision: write.record!.revision,
      },
    });
  }
  async prepareClient(
    principal: InferenceManagementPrincipal,
    value: unknown
  ): Promise<PreparedInferenceChange> {
    const input = record(value),
      account = await this.account(principal, text(input.accountId));
    const graph = await this.graph(),
      service = graph.services[account.serviceId];
    const write = await this.options.accounts.prepareClient({
      account,
      clientSecret: text(input.clientSecret),
      expectedRevision: revision(input.expectedRevision),
      authContractVersion: this.options.authenticationContract(account, service),
    });
    return this.#prepare({
      kind: 'credential',
      rootId: graph.rootId,
      ownerId: principal.ownerId,
      baseRevision: graph.revision,
      graph,
      credentials: [write],
      removedAccounts: [],
      requiredServices: [account.serviceId],
      requiredAccounts: [account.id],
      requiredProfiles: [],
      result: {
        ownerId: principal.ownerId,
        accountId: account.id,
        credentialRevision: write.record!.revision,
      },
    });
  }
  async discover(principal: InferenceManagementPrincipal, value: unknown, signal: AbortSignal) {
    const input = record(value),
      account = await this.account(principal, text(input.accountId));
    const graph = await this.graph(),
      service = graph.services[account.serviceId];
    if (!service || service.ownerId !== principal.ownerId)
      throw new InferenceManagementError('forbidden');
    const observations = await this.options.discover({
      account,
      service,
      signal,
    });
    // Observations are not capability declarations. The user reviews a model Profile/plan separately.
    return {
      serviceId: service.id,
      baseRevision: graph.revision,
      observations,
    };
  }
  /** Authenticated, pure display metadata for a chosen or not-yet-saved model. */
  async profileSchema(principal: InferenceManagementPrincipal, value: unknown) {
    const input = record(value),
      account = await this.account(principal, text(input.accountId));
    const graph = await this.graph(),
      service = graph.services[account.serviceId];
    const candidate = record(input.model),
      modelId = text(candidate.id);
    const checked = normalizeProviderGraph({
      ...graph,
      services: {
        ...graph.services,
        [service.id]: {
          ...service,
          models: { ...service.models, [modelId]: candidate },
        },
      },
    });
    const model = checked.services[service.id].models[modelId];
    const schema = this.options.profileSchema({ service, model });
    return {
      serviceId: service.id,
      driver: service.driver,
      model,
      inputSchema: schema?.inputSchema ?? {
        type: 'object',
        properties: {},
        additionalProperties: true,
      },
    };
  }
  #normalizeProfile(
    input: Readonly<{
      service: ProviderService;
      account: ProviderAccount;
      profile: ModelProfile;
    }>
  ): JsonObject {
    const model = input.service.models[input.profile.model];
    if (!model) throw new InferenceManagementError('invalid-input');
    const schema = this.options.profileSchema({
      service: input.service,
      model,
    });
    try {
      const parsed = normalizeProviderJson(
        schema ? schema.parse(input.profile.parameters) : input.profile.parameters
      );
      return record(parsed) as JsonObject;
    } catch {
      throw new InferenceManagementError('invalid-input');
    }
  }
  async apply(
    principal: InferenceManagementPrincipal,
    value: unknown
  ): Promise<ProviderMutationResult> {
    let persistenceInvoked = false;
    try {
      return await this.#apply(principal, value, () => {
        persistenceInvoked = true;
      });
    } catch (error) {
      if (!persistenceInvoked) throw new InferenceApplyRejectedError(error);
      throw error;
    }
  }
  async #apply(
    principal: InferenceManagementPrincipal,
    value: unknown,
    submitting: () => void
  ): Promise<ProviderMutationResult> {
    this.#principal(principal);
    const input = record(value),
      prepared = record(input.prepared) as JsonObject;
    let mutation: PreparedMutation;
    try {
      mutation = record(
        JSON.parse(await this.#cipher.open(prepared, this.#aad(principal.ownerId)))
      ) as unknown as PreparedMutation;
    } catch {
      throw new InferenceManagementError('invalid-input');
    }
    if (
      mutation.rootId !== this.options.rootId ||
      mutation.ownerId !== principal.ownerId ||
      !['graph', 'credential'].includes(mutation.kind)
    )
      throw new InferenceManagementError('forbidden');
    const common = {
      rootId: this.options.rootId,
      mutationId: text(input.mutationId),
      fingerprint: providerPlanFingerprint(prepared),
      result: mutation.result,
      credentials: mutation.credentials,
    };
    // The old transaction's proven result does not depend on today's Driver generation.
    let receipt;
    try {
      receipt = await this.options.repository.readMutation(common);
    } catch {
      return { status: 'commit-unknown' };
    }
    if (receipt) {
      if (receipt.fingerprint !== common.fingerprint)
        return { status: 'conflict', reason: 'mutation-content' };
      if (mutationOwner(receipt.result) !== principal.ownerId)
        throw new InferenceManagementError('forbidden');
      submitting(); // A saved receipt is already proof of a committed outcome.
      await this.options.accounts.committed({
        graph: mutation.graph,
        removedAccounts: mutation.removedAccounts,
        credentials: mutation.credentials,
      });
      return { status: 'committed', receipt, replayed: true };
    }
    const graph = normalizeProviderGraph(mutation.graph);
    this.#checkEnvironmentSources(graph);
    const current = await this.graph();
    if (current.revision !== mutation.baseRevision)
      return { status: 'conflict', reason: 'revision' };
    if (!Array.isArray(mutation.requiredServices))
      throw new InferenceManagementError('invalid-input');
    for (const id of mutation.requiredServices) {
      const service = graph.services[id];
      if (!service) throw new InferenceManagementError('invalid-input');
      const resolved = await this.options.resolveService({
        driver: service.driver,
        options: service.options,
        models: service.models,
        requestedModels: [],
        existing: service,
      });
      if (providerPlanFingerprint(resolved.driver) !== providerPlanFingerprint(service.driver))
        throw new InferenceManagementError('conflict');
    }
    if (!Array.isArray(mutation.requiredAccounts))
      throw new InferenceManagementError('invalid-input');
    this.#validateAccountAuthentication(graph, mutation.requiredAccounts);
    if (!Array.isArray(mutation.requiredProfiles))
      throw new InferenceManagementError('invalid-input');
    for (const id of mutation.requiredProfiles) {
      const profile = graph.profiles[id],
        account = profile && graph.accounts[profile.accountId];
      if (!profile || !account) throw new InferenceManagementError('invalid-input');
      const parameters = this.#normalizeProfile({
        service: graph.services[account.serviceId],
        account,
        profile,
      });
      if (providerPlanFingerprint(parameters) !== providerPlanFingerprint(profile.parameters))
        throw new InferenceManagementError('conflict');
    }
    for (const write of mutation.credentials) {
      if (!write.record) continue;
      const account = graph.accounts[write.accountId],
        service = account && graph.services[account.serviceId];
      if (
        !account ||
        !service ||
        write.record.authContractVersion !== this.options.authenticationContract(account, service)
      ) {
        throw new InferenceManagementError('conflict');
      }
    }
    submitting();
    const result =
      mutation.kind === 'graph'
        ? await this.options.repository.commit({
            ...common,
            expectedRevision: mutation.baseRevision,
            graph,
          })
        : await this.options.repository.commitCredentialMutation({
            ...common,
            expectedGraphRevision: mutation.baseRevision,
          });
    if (result.status === 'committed')
      await this.options.accounts.committed({
        graph,
        removedAccounts: mutation.removedAccounts,
        credentials: mutation.credentials,
      });
    return result;
  }
  async mutation(principal: InferenceManagementPrincipal, mutationId: string): Promise<unknown> {
    this.#principal(principal);
    const receipt = await this.options.repository.readMutation({
      rootId: this.options.rootId,
      mutationId: text(mutationId),
    });
    if (receipt && mutationOwner(receipt.result) !== principal.ownerId)
      throw new InferenceManagementError('forbidden');
    return receipt ?? null;
  }
  /** Export metadata only; imported credentials are always authorized and entered separately. */
  async export(principal: InferenceManagementPrincipal): Promise<unknown> {
    this.#principal(principal);
    const graph = await this.graph();
    const own = <T extends { ownerId: string }>(values: Readonly<Record<string, T>>) =>
      Object.entries(values).filter(([, value]) => value.ownerId === principal.ownerId);
    const services = Object.fromEntries(
      own(graph.services).map(([id, service]) => [
        id,
        {
          driver: service.driver,
          options: service.options,
          models: service.models,
          ...(service.label ? { label: service.label } : {}),
        },
      ])
    );
    const accounts = Object.fromEntries(
      own(graph.accounts).map(([id, account]) => [
        id,
        {
          service: account.serviceId,
          auth: account.authentication,
          ...(account.label ? { label: account.label } : {}),
        },
      ])
    );
    const profiles = Object.fromEntries(
      own(graph.profiles).map(([id, profile]) => [
        id,
        {
          account: profile.accountId,
          model: profile.model,
          parameters: profile.parameters,
          ...(profile.label ? { label: profile.label } : {}),
        },
      ])
    );
    const reference = (id: string | undefined) => (id ? { profile: id } : undefined);
    const selection = (value: { chat?: string; perception?: unknown }) => ({
      ...(value.chat ? { chat: reference(value.chat) } : {}),
      ...(value.perception ? { perception: value.perception } : {}),
    });
    const purposes = {
      ...selection(graph.purposes.defaults),
      ...(graph.purposes.defaults.summary
        ? { summary: reference(graph.purposes.defaults.summary) }
        : {}),
      ...(graph.purposes.defaults.ambient
        ? { ambient: reference(graph.purposes.defaults.ambient) }
        : {}),
      ...(graph.purposes.defaults.image ? { image: reference(graph.purposes.defaults.image) } : {}),
      ...(graph.purposes.decisions ? { decisions: graph.purposes.decisions } : {}),
      ...(graph.purposes.agents
        ? {
            agents: Object.fromEntries(
              Object.entries(graph.purposes.agents).map(([key, id]) => [key, reference(id)])
            ),
          }
        : {}),
      ...Object.fromEntries(
        (['adapters', 'endpoints', 'scenes'] as const)
          .filter((key) => graph.purposes[key])
          .map((key) => [
            key,
            Object.fromEntries(
              Object.entries(graph.purposes[key]!).map(([id, value]) => [id, selection(value)])
            ),
          ])
      ),
    };
    const serviceIds = new Set([
      ...Object.keys(services),
      ...own(graph.accounts).map(([, account]) => account.serviceId),
    ]);
    return {
      plan: {
        version: 1,
        services,
        accounts,
        profiles,
        ...(principal.hostAdministrator ? { purposes } : {}),
      },
      bindings: {
        services: Object.fromEntries([...serviceIds].map((id) => [id, id])),
        accounts: Object.fromEntries(Object.keys(accounts).map((id) => [id, id])),
        profiles: Object.fromEntries(Object.keys(profiles).map((id) => [id, id])),
      },
    };
  }
  async #prepare(mutation: PreparedMutation): Promise<PreparedInferenceChange> {
    const sealed = await this.#cipher.seal(JSON.stringify(mutation), this.#aad(mutation.ownerId));
    const prepared = {
      version: sealed.version,
      iv: sealed.iv,
      tag: sealed.tag,
      ciphertext: sealed.ciphertext,
    };
    return {
      prepared,
      fingerprint: providerPlanFingerprint(prepared),
      baseRevision: mutation.baseRevision,
    };
  }
  #aad(ownerId: string): Buffer {
    return Buffer.from(JSON.stringify(['inference-management', 1, this.options.rootId, ownerId]));
  }
  #validateAccountAuthentication(graph: ProviderGraph, ids: readonly string[]): void {
    for (const id of ids) {
      const account = graph.accounts[id],
        service = account && graph.services[account.serviceId];
      if (!account || !service) throw new InferenceManagementError('invalid-input');
      this.options.authenticationContract(account, service);
    }
  }
  #checkEnvironmentSources(graph: ProviderGraph): void {
    for (const account of Object.values(graph.accounts)) {
      if (account.ownerId === this.options.hostOwnerId) continue;
      if (
        account.authentication.method === 'oauth' ||
        (account.authentication.method === 'api-key' && account.authentication.source)
      ) {
        // Personal subscription OAuth is outside the approved rollout; Host environment access is never personal authority.
        throw new InferenceManagementError('forbidden');
      }
      const address = graph.services[account.serviceId]?.options.baseUrl;
      if (typeof address === 'string') {
        try {
          createPersonalModelFetch({ baseUrl: address });
        } catch {
          throw new InferenceManagementError('invalid-input');
        }
      }
    }
  }
}

interface MutationServicesInput {
  readonly before: ProviderGraph;
  readonly after: ProviderGraph;
  readonly changes: ReviewedProviderPlan['changes'];
}
/** Capture only references changed by this review, including newly selected existing Profiles. */
function mutationDependencies({ before, after, changes }: MutationServicesInput): Readonly<{
  requiredServices: readonly string[];
  requiredAccounts: readonly string[];
  requiredProfiles: readonly string[];
}> {
  const changedServices = new Set([...changes.services.created, ...changes.services.updated]);
  const services = new Set(changedServices);
  const accounts = new Set<string>();
  const profiles = new Set([...changes.profiles.created, ...changes.profiles.updated]);
  const account = (id: string) => {
    if (after.accounts[id]) {
      accounts.add(id);
      services.add(after.accounts[id].serviceId);
    }
  };
  for (const value of Object.values(after.accounts))
    if (changedServices.has(value.serviceId)) account(value.id);
  for (const id of [...changes.accounts.created, ...changes.accounts.updated]) account(id);
  for (const id of profiles) account(after.profiles[id].accountId);
  for (const profile of Object.values(after.profiles)) {
    if (
      services.has(after.accounts[profile.accountId].serviceId) &&
      profile.ownerId === after.services[after.accounts[profile.accountId].serviceId].ownerId
    ) {
      profiles.add(profile.id);
      account(profile.accountId);
    }
  }
  for (const id of changedPurposeProfileIds(before.purposes, after.purposes)) {
    const profile = after.profiles[id];
    if (profile) {
      profiles.add(id);
      account(profile.accountId);
    }
  }
  return {
    requiredServices: [...services],
    requiredAccounts: [...accounts],
    requiredProfiles: [...profiles],
  };
}

function mutationOwner(value: unknown): string | undefined {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'ownerId' in value &&
    typeof value.ownerId === 'string'
    ? value.ownerId
    : undefined;
}
