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
  type ProviderSupportMetadata,
  normalizeProviderJson,
} from '@zhin.js/ai/provider';
import { applyModelCapabilityDefaults } from '@zhin.js/ai/providers';
import { createHostDocumentCipher } from '@zhin.js/plugin-runtime';
import { InferenceAuthenticationError, InferenceCredentialStore, credentialMaterialFingerprint, environmentExpressionSource, normalizeApiKeyMaterial, type EnvironmentExpressionSource } from './credentials.js';
import { createPersonalModelFetch } from './personal-network.js';
import { HostAccountRuntime, type AccountStatusView } from './account-runtime.js';
import { DatabaseInferenceRepository } from './repository.js';

/**
 * Who may make a Host API-key account read a Host environment variable (`env://NAME` account
 * source, `${NAME}` key expression), or change the service such an account sends it to (#1250):
 * - absent: a trusted in-process caller (startup `ai.plan.yml` seed, offline migration);
 * - `local-cli`: the project owner's CLI over the gateway control socket;
 * - `console-owner`: a global Console owner — only `*_API_KEY` names, toward any service address
 *   (custom relays included: an owner can already read `.env`; the suffix keeps unrelated
 *   secrets such as `ZHIN_CONSOLE_TOKEN` or `GITHUB_TOKEN` from being sent anywhere);
 * - `none`: any other Console user — no Host environment references at all.
 */
export type InferenceEnvironmentAuthority = 'local-cli' | 'console-owner' | 'none';

/** Constructed by the authenticated Host route, never accepted from a request body. */
export interface InferenceManagementPrincipal {
  readonly ownerId: string;
  readonly hostAdministrator: boolean;
  readonly environmentReferences?: InferenceEnvironmentAuthority;
}
/** User-facing reasons (closed set) for a refused Host environment reference. */
export const INFERENCE_ENVIRONMENT_REFUSALS = Object.freeze({
  'environment-console-user': '只有全局 owner 可以在 Console 中引用 Host 环境变量；请直接填写密钥，或请全局 owner 添加（也可由 Host 管理员在本机运行 zhin ai account add）',
  'environment-name': '只能引用以 _API_KEY 结尾的环境变量（例如 OPENAI_API_KEY）',
  'environment-local-only': '该操作只能由 Host 管理员在本机用 zhin 命令完成',
  'environment-missing': '新的环境变量在 Host 上未设置或为空',
  'environment-mismatch': '新变量的值与当前凭据的指纹不一致；确认是同一账号的新密钥后加 --reauthorize 重试',
  'environment-account': '只有引用环境变量（env://）的 Host API Key 账号可以修改引用名，且原变量名必须一致',
} as const);
export type InferenceEnvironmentRefusal = keyof typeof INFERENCE_ENVIRONMENT_REFUSALS;

export class InferenceManagementError extends Error {
  constructor(
    readonly code: 'invalid-input' | 'forbidden' | 'conflict' | 'unavailable' | 'unsupported',
    /** Closed-set reason with a user-facing message; never carries a value or provider text. */
    readonly reason?: InferenceEnvironmentRefusal,
  ) {
    super(`Inference management: ${code}${reason ? ` (${reason})` : ''}`);
    this.name = 'InferenceManagementError';
  }
}

const API_KEY_VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*_API_KEY$/u;
/** The variable an `env://NAME` source or a `${NAME…}` expression reads. */
export function environmentVariableName(source: string | EnvironmentExpressionSource): string | undefined {
  const text = typeof source === 'string' ? source : source.expression;
  return /^env:\/\/([A-Za-z_][A-Za-z0-9_]*)$/u.exec(text)?.[1] ?? /^\$\{([A-Za-z_][A-Za-z0-9_]*)/u.exec(text)?.[1];
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
  readonly support?: ProviderSupportMetadata;
  readonly authentication: readonly AuthenticationMethod[];
  /** True only when this held declaration implements model discovery. Metadata reads never probe it. */
  readonly discovery: boolean;
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
    support?: ProviderSupportMetadata;
  }>[];
  readonly drivers: readonly InferenceDriverView[];
  readonly purposes?: PurposePolicy;
  /** What this caller may do with Host environment variables (absent for in-process callers). */
  readonly environmentReferences?: InferenceEnvironmentAuthority;
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
    const drivers = this.options.drivers();
    // Host Profiles are consumable, but their account configuration and authentication state are not personal management data.
    const deployment = Object.values(graph.profiles)
      .filter((profile) => profile.ownerId === this.options.hostOwnerId)
      .map((profile) => {
        const account = graph.accounts[profile.accountId];
        const service = graph.services[account.serviceId];
        const driver = drivers.find((candidate) =>
          candidate.id === service.driver.id && candidate.owner === service.driver.owner
          && candidate.contractVersion === service.driver.contractVersion);
        return {
          id: profile.id,
          label: profile.label,
          model: profile.model,
          accountId: profile.accountId,
          accountIncarnation: account.incarnation,
          definition: service.models[profile.model],
          ...(driver?.support ? { support: driver.support } : {}),
        };
      });
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
      drivers,
      ...(principal.hostAdministrator ? { purposes: graph.purposes } : {}),
      ...(principal.environmentReferences ? { environmentReferences: principal.environmentReferences } : {}),
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
    keys: ReadonlyMap<string, string | EnvironmentExpressionSource>
  ): Promise<PreparedInferenceChange> {
    return this.#review(principal, value, keys);
  }
  async #review(
    principal: InferenceManagementPrincipal,
    value: unknown,
    importedKeys: ReadonlyMap<string, string | EnvironmentExpressionSource> = new Map()
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
    this.#checkEnvironmentAuthority(principal, graph, reviewed.graph);
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
      const material = normalizeApiKeyMaterial(typeof key === 'string' ? { key } : { source: key });
      const id = reviewed.bindings.accounts[alias],
        account = reviewed.graph.accounts[id];
      if (
        !account ||
        account.ownerId !== principal.ownerId ||
        !reviewed.changes.accounts.created.includes(id) ||
        account.authentication.method !== 'api-key' ||
        account.authentication.source ||
        (material.source !== undefined && account.ownerId !== this.options.hostOwnerId)
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
          ...material,
          ...(material.key === undefined ? {} : { materialFingerprint: credentialMaterialFingerprint(material.key) }),
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
  /**
   * `zhin ai account add` (#1250 host-account-add-path): a Host API-key account reading `env://NAME`,
   * on an existing Host service (id or label) or a new service of a built-in Driver at its default
   * address. Local CLI only; the value is never read here (it is activated by the first call or a test).
   */
  async addEnvironmentAccount(
    principal: InferenceManagementPrincipal,
    value: unknown
  ): Promise<Readonly<{ accountId: string; serviceId: string; createdService: boolean; result: ProviderMutationResult }>> {
    this.#principal(principal);
    if (!principal.hostAdministrator || principal.environmentReferences !== 'local-cli')
      throw new InferenceManagementError('forbidden', 'environment-local-only');
    const input = record(value);
    const reference = text(input.service), variable = text(input.env);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(variable)) throw new InferenceManagementError('invalid-input');
    const label = input.label === undefined ? undefined : text(input.label);
    const graph = await this.graph();
    const matches = Object.values(graph.services).filter((service) => service.ownerId === this.options.hostOwnerId
      && (service.id === reference || service.label === reference));
    if (matches.length > 1) throw new InferenceManagementError('conflict');
    const existing = matches[0];
    const plan = {
      version: 1,
      ...(existing ? {} : { services: { service: { driver: reference, options: {}, models: {} } } }),
      accounts: { account: { service: 'service', ...(label ? { label } : {}), auth: { method: 'api-key', source: `env://${variable}` } } },
    };
    const prepared = await this.#review(principal, { plan, ...(existing ? { bindings: { services: { service: existing.id } } } : {}) });
    const result = await this.apply(principal, { prepared: prepared.prepared, mutationId: `cli-account-add:${randomUUID()}` });
    return {
      accountId: prepared.bindings!.accounts.account!,
      serviceId: prepared.bindings!.services.service!,
      createdService: !existing,
      result,
    };
  }
  /** `zhin ai account rename-env` (#1250 account-env-ref-immutable): same account identity, new `env://` variable. */
  async renameEnvironmentReference(
    principal: InferenceManagementPrincipal,
    value: unknown
  ): Promise<Readonly<{ accountId: string; credential: 'pending' | 'kept' | 'reset'; result: ProviderMutationResult }>> {
    this.#principal(principal);
    const authority = principal.environmentReferences;
    if (!principal.hostAdministrator || (authority !== undefined && authority !== 'local-cli' && authority !== 'console-owner'))
      throw new InferenceManagementError('forbidden', 'environment-local-only');
    const input = record(value);
    const from = text(input.from), to = text(input.to);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(from) || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(to) || from === to)
      throw new InferenceManagementError('invalid-input');
    if (input.reauthorize !== undefined && typeof input.reauthorize !== 'boolean') throw new InferenceManagementError('invalid-input');
    const nextSource = `env://${to}`;
    this.#authorizeEnvironmentName(principal, nextSource);
    const graph = await this.graph();
    const reference = text(input.account);
    const matches = Object.values(graph.accounts).filter((account) => account.ownerId === this.options.hostOwnerId
      && (account.id === reference || account.label === reference));
    if (matches.length > 1) throw new InferenceManagementError('conflict');
    const account = matches[0];
    if (!account || account.authentication.method !== 'api-key' || account.authentication.source !== `env://${from}`)
      throw new InferenceManagementError('invalid-input', 'environment-account');
    let prepared;
    try {
      prepared = await this.options.accounts.prepareEnvironmentRename({ account, nextSource, reauthorize: input.reauthorize === true });
    } catch (error) {
      if (error instanceof InferenceAuthenticationError && error.code === 'not-authorized')
        throw new InferenceManagementError('invalid-input', 'environment-missing');
      if (error instanceof InferenceAuthenticationError && error.code === 'identity-change')
        throw new InferenceManagementError('conflict', 'environment-mismatch');
      throw error;
    }
    const next = normalizeProviderGraph({
      ...graph,
      revision: graph.revision + 1,
      accounts: {
        ...graph.accounts,
        [account.id]: { ...account, revision: account.revision + 1, authentication: { method: 'api-key', source: nextSource } },
      },
    });
    const credentials = prepared.write ? [prepared.write] : [];
    const result = await this.options.repository.commit({
      rootId: this.options.rootId,
      mutationId: `cli-account-rename-env:${randomUUID()}`,
      fingerprint: providerPlanFingerprint(next),
      expectedRevision: graph.revision,
      graph: next,
      credentials,
      result: { ownerId: principal.ownerId, accountId: account.id },
    });
    if (result.status === 'committed')
      await this.options.accounts.committed({ graph: next, removedAccounts: [], credentials });
    return { accountId: account.id, credential: prepared.outcome, result };
  }
  async prepareKey(
    principal: InferenceManagementPrincipal,
    value: unknown
  ): Promise<PreparedInferenceChange> {
    const input = record(value);
    if (input.source !== undefined && input.key !== undefined)
      throw new InferenceManagementError('invalid-input');
    const account = await this.account(principal, text(input.accountId));
    const graph = await this.graph();
    const service = graph.services[account.serviceId];
    if (input.source !== undefined || (typeof input.key === 'string' && input.key.includes('${'))) {
      const material = normalizeApiKeyMaterial(input.source === undefined ? { key: text(input.key) } : { source: environmentExpressionSource(input.source) });
      if (material.source) this.#authorizeEnvironmentName(principal, material.source);
    }
    const write = await this.options.accounts.prepareKey({
      account,
      ...(input.source === undefined ? { key: text(input.key) } : { source: environmentExpressionSource(input.source) }),
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
    const model = applyModelCapabilityDefaults(checked.services[service.id].models[modelId]);
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
  #authorizeEnvironmentName(principal: InferenceManagementPrincipal, source: string | EnvironmentExpressionSource): void {
    const authority = principal.environmentReferences;
    if (authority === undefined || authority === 'local-cli') return;
    if (authority !== 'console-owner') throw new InferenceManagementError('forbidden', 'environment-console-user');
    const name = environmentVariableName(source);
    if (!name || !API_KEY_VARIABLE.test(name)) throw new InferenceManagementError('forbidden', 'environment-name');
  }
  /**
   * A Host environment reference that is new, renamed, or whose service changes needs the caller's
   * environment authority; the destination address itself is not restricted for a global owner.
   */
  #checkEnvironmentAuthority(principal: InferenceManagementPrincipal, before: ProviderGraph, after: ProviderGraph): void {
    const authority = principal.environmentReferences;
    if (authority === undefined || authority === 'local-cli') return;
    for (const account of Object.values(after.accounts)) {
      const source = account.authentication.method === 'api-key' ? account.authentication.source : undefined;
      if (!source || account.ownerId !== this.options.hostOwnerId) continue;
      const previous = before.accounts[account.id];
      const service = after.services[account.serviceId];
      const previousService = previous && before.services[previous.serviceId];
      const touched = !previous || previous.authentication.method !== 'api-key' || previous.authentication.source !== source
        || previous.serviceId !== account.serviceId || !service || !previousService
        || providerPlanFingerprint(previousService.driver) !== providerPlanFingerprint(service.driver)
        || providerPlanFingerprint(previousService.options as JsonObject) !== providerPlanFingerprint(service.options as JsonObject);
      if (!touched) continue;
      // Owners may point a `*_API_KEY` reference at any address, custom relays included (#1250).
      this.#authorizeEnvironmentName(principal, source);
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
