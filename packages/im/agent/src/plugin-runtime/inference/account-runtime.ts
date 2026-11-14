import { getLogger } from '@zhin.js/logger';
import type {
  CredentialPort,
  CredentialGrant,
  ProviderExecutionContext,
  ProviderDriverLease,
  ProviderAccount,
  ProviderDefinition,
  ProviderService,
  ProviderCredentialWrite,
  ProviderGraph,
} from '@zhin.js/ai/provider';
import {
  InferenceAuthenticationError,
  type CredentialPayload,
  type OpenCredential,
  type ApiKeyMaterial,
  type InferencePreparationFailure,
} from './credentials.js';
import { oauthRefreshDue } from './oauth-refresh-policy.js';
import {
  type AccountRuntimeContext,
  type AccountRuntimeOptions,
  type AccountStatusView,
  type Flight,
  type LoginChallengeView,
  type LoginStart,
  type PendingLogin,
  accountKey,
  identity,
  prepareAccountClient,
  prepareAccountKey,
  publishAccountCredential,
  readAccountStatus,
  ready,
  resolveAccountEnvironmentKey,
  waitFor,
} from './account-runtime-helpers.js';
import {
  completeAccountLogin,
  parseOAuthCallbackUrl,
  prepareAccountOAuth,
  runAccountRefresh,
  startAccountLogin,
} from './account-runtime-oauth.js';
import { migrateLegacyCredentialFingerprints } from './credential-fingerprint-migration.js';

export type { AccountRuntimeOptions, AccountStatusView, LoginChallengeView } from './account-runtime-helpers.js';

/** Process-owned account authority. Generation-owned Provider handles borrow it; HMR does not disconnect accounts. */
export class HostAccountRuntime {
  readonly #closed = new AbortController();
  readonly #accounts = new Map<string, AbortController>();
  readonly #flights = new Map<string, Flight>();
  readonly #logins = new Map<string, PendingLogin>();
  readonly #loginStarts = new Map<string, LoginStart>();
  readonly #uncertain = new Set<string>();
  readonly #preparationFailures = new Map<string, Readonly<{ revision: number; failure: InferencePreparationFailure }>>();
  readonly #fingerprintMigrations = new Map<string, Promise<void>>();

  constructor(private readonly options: AccountRuntimeOptions) {}

  #context(): AccountRuntimeContext {
    return {
      options: this.options,
      closedSignal: this.#closed.signal,
      uncertain: this.#uncertain,
      logins: this.#logins,
      loginStarts: this.#loginStarts,
      preparationFailures: this.#preparationFailures,
      assertOpen: () => this.#assertOpen(),
      verifyAccount: (account) => this.#account(account),
      signal: (account) => this.#signal(account),
      renewSignal: (account) => this.#renewSignal(account),
      withFetch: (input, run) => this.#withFetch(input, run),
      publish: (input) => this.#publish(input),
      release: (fn) => this.#release(fn),
      reportCleanup: (message) => this.#reportCleanup(message),
    };
  }

  createPort(input: ProviderExecutionContext): CredentialPort {
    return this.createAccountPort({
      account: input.binding.account,
      service: input.binding.service,
      definition: input.driver,
      retainDriver: input.retainDriver,
      purpose: 'inference',
    });
  }

  createAccountPort(
    input: Readonly<{
      account: ProviderAccount;
      service: ProviderService;
      definition: ProviderDefinition<unknown, unknown>;
      retainDriver: () => ProviderDriverLease;
      purpose: 'inference' | 'discovery';
    }>
  ): CredentialPort {
    const binding = { account: input.account, service: input.service },
      definition = input.definition;
    const issued = new WeakMap<CredentialGrant, string>();
    const authorize = async ({
      target,
      signal,
    }: Parameters<CredentialPort['authorize']>[0]): Promise<CredentialGrant> => {
      this.#assertOpen();
      signal.throwIfAborted();
      await this.#account(binding.account);
      if (
        binding.account.authentication.method === 'oauth' &&
        binding.account.ownerId !== this.options.hostOwnerId
      ) {
        throw new InferenceAuthenticationError('not-authorized');
      }
      if (
        binding.account.authentication.method === 'api-key' &&
        binding.account.authentication.source &&
        binding.account.ownerId !== this.options.hostOwnerId
      )
        throw new InferenceAuthenticationError('not-authorized');
      if (!definition.authentication.methods.includes(binding.account.authentication.method))
        throw new InferenceAuthenticationError('not-authorized');
      if (
        !this.options.allowTarget({
          service: binding.service,
          definition,
          target,
          purpose: input.purpose,
        })
      )
        throw new InferenceAuthenticationError('target-denied');
      if (binding.account.authentication.method === 'none')
        return { headers: {}, revision: 'none' };
      if (this.#uncertain.has(accountKey(binding.account)))
        throw new InferenceAuthenticationError('outcome-unknown');
      if (binding.account.authentication.method === 'api-key')
        await this.#migrateLegacyFingerprints(binding.account.rootId);
      let open = await this.options.credentials.read(binding.account);
      if (binding.account.authentication.method === 'api-key') {
        open = await resolveAccountEnvironmentKey(this.#context(), binding.account, definition.contractVersion, open);
        ready(open);
        if (open.payload.method !== 'api-key' || typeof open.payload.key !== 'string') throw new InferenceAuthenticationError('integrity');
        signal.throwIfAborted();
        return {
          token: open.payload.key,
          headers: {},
          revision: String(open.record.revision),
        };
      }
      const existingRefresh = this.#flights.get(accountKey(binding.account));
      if (existingRefresh) open = await waitFor(existingRefresh.promise, signal);
      ready(open);
      if (open.payload.method !== 'oauth' || !definition.authentication.oauth)
        throw new InferenceAuthenticationError('integrity');
      if (open.record.authContractVersion !== definition.authentication.oauth.contractVersion)
        throw new InferenceAuthenticationError('conflict');
      const now = this.options.now?.() ?? Date.now();
      if (open.payload.refresh && now < open.payload.refresh.nextAttemptAt)
        throw new InferenceAuthenticationError('rejected');
      if (oauthRefreshDue(open.payload, now)) {
        const refreshed = await waitFor(
          this.#refresh({
            account: binding.account,
            service: binding.service,
            current: open,
            retainDriver: input.retainDriver,
          }),
          signal
        );
        ready(refreshed);
        if (refreshed.payload.method !== 'oauth')
          throw new InferenceAuthenticationError('integrity');
        open = refreshed;
      }
      ready(open);
      if (open.payload.method !== 'oauth') throw new InferenceAuthenticationError('integrity');
      if (open.payload.credential.preparation?.status === 'required')
        throw new InferenceAuthenticationError('not-prepared');
      signal.throwIfAborted();
      return {
        token: open.payload.credential.accessToken,
        headers: {},
        revision: String(open.record.revision),
        ...(open.payload.credential.metadata ? { metadata: open.payload.credential.metadata } : {}),
      };
    };
    return Object.freeze({
      async authorize(input: Parameters<CredentialPort['authorize']>[0]) {
        const target = new URL(input.target);
        const grant = await authorize({ ...input, target });
        issued.set(grant, target.href);
        return grant;
      },
      bindRequest({ grant, request }: Parameters<CredentialPort['bindRequest']>[0]) {
        if (issued.get(grant) !== request.url)
          throw new InferenceAuthenticationError('target-denied');
        return request;
      },
    });
  }

  /** OAuth owns its complete response-body transaction, including every transport follower. */
  async #withFetch<T>(
    input: Omit<Parameters<AccountRuntimeOptions['fetch']>[0], 'retainTransportState'>,
    run: (fetch: typeof globalThis.fetch) => Promise<T>
  ): Promise<T> {
    const retained = new Set<Request | AbortSignal>();
    try {
      return await run(
        this.options.fetch({
          ...input,
          retainTransportState: (state) => {
            retained.add(state);
          },
        })
      );
    } finally {
      retained.clear();
    }
  }

  /** Binds disconnect cancellation to this identity, never to the latest same-named account. */
  bindFetch(
    account: ProviderAccount,
    fetch: typeof globalThis.fetch,
    retainTransportState?: (state: Request | AbortSignal) => void
  ): typeof globalThis.fetch {
    const signal = this.#signal(account);
    return (input, init) => {
      const request =
        input instanceof Request && (!init || Object.keys(init).every((key) => key === 'signal'))
          ? input
          : new Request(input, init);
      const active = AbortSignal.any([init?.signal ?? request.signal, signal, this.#closed.signal]);
      retainTransportState?.(request);
      retainTransportState?.(active);
      if (active.aborted) return Promise.reject(active.reason);
      return fetch(request, { signal: active });
    };
  }

  async status(account: ProviderAccount): Promise<AccountStatusView> {
    await this.#account(account);
    return readAccountStatus(this.#context(), account);
  }

  /** Host-private UI projection from its already-read graph, never an inference admission check. */
  async statuses(
    input: Readonly<{
      graph: ProviderGraph;
      accounts: readonly ProviderAccount[];
    }>
  ): Promise<Readonly<Record<string, AccountStatusView>>> {
    const ctx = this.#context();
    return Object.fromEntries(
      await Promise.all(
        input.accounts.map(async (account) => {
          const current = input.graph.accounts[account.id];
          if (
            input.graph.rootId !== account.rootId ||
            !current ||
            current.ownerId !== account.ownerId ||
            current.incarnation !== account.incarnation ||
            current.serviceId !== account.serviceId ||
            !input.graph.services[current.serviceId]
          )
            throw new InferenceAuthenticationError('conflict');
          return [account.id, await readAccountStatus(ctx, current)] as const;
        })
      )
    );
  }

  async putKey(
    input: Readonly<{
      account: ProviderAccount;
      expectedRevision: number;
      authContractVersion: string;
    }> & ApiKeyMaterial
  ): Promise<void> {
    const write = await this.prepareKey(input);
    const result = await this.options.repository.commitCredential({
      rootId: input.account.rootId,
      write,
    });
    if (result.status !== 'committed')
      throw new InferenceAuthenticationError(
        result.status === 'conflict'
          ? 'conflict'
          : result.status === 'commit-unknown'
          ? 'outcome-unknown'
          : 'unavailable'
      );
    this.#uncertain.delete(accountKey(input.account));
    this.#renewSignal(input.account);
  }

  /** Prepare an encrypted CAS write for the management mutation transaction; does not save or contact providers. */
  async prepareKey(
    input: Readonly<{
      account: ProviderAccount;
      expectedRevision: number;
      authContractVersion: string;
    }> & ApiKeyMaterial
  ): Promise<ProviderCredentialWrite> {
    return prepareAccountKey(this.#context(), input);
  }

  async disconnect(
    input: Readonly<{
      account: ProviderAccount;
      expectedRevision: number;
      authContractVersion: string;
    }>
  ): Promise<void> {
    this.#assertOpen();
    await this.#account(input.account);
    const current = await this.options.credentials.read(input.account);
    if ((current?.record.revision ?? 0) !== input.expectedRevision)
      throw new InferenceAuthenticationError('conflict');
    if (input.account.authentication.method === 'none') return;
    try {
      await this.#publish({
        account: input.account,
        previous: current,
        authContractVersion: input.authContractVersion,
        payload: {
          status: 'disconnected',
          method: input.account.authentication.method,
          ...identity(current),
        },
      });
      this.#uncertain.delete(accountKey(input.account));
    } finally {
      this.#signal(input.account);
      this.#accounts
        .get(accountKey(input.account))!
        .abort(new InferenceAuthenticationError('disconnected'));
      const starting = this.#loginStarts.get(accountKey(input.account));
      this.#loginStarts.delete(accountKey(input.account));
      starting?.controller.abort();
      for (const [id, login] of this.#logins)
        if (accountKey(login.account) === accountKey(input.account)) {
          this.#logins.delete(id);
          login.controller.abort();
          if (login.phase === 'ready') await this.#release(login.release);
        }
    }
  }

  /** OAuth desktop-client metadata is private and follows the same account CAS as its token bundle. */
  async prepareClient(
    input: Readonly<{
      account: ProviderAccount;
      clientSecret: string;
      expectedRevision: number;
      authContractVersion: string;
    }>
  ): Promise<ProviderCredentialWrite> {
    return prepareAccountClient(this.#context(), input);
  }

  async beginLogin(
    input: Readonly<{ account: ProviderAccount; signal: AbortSignal }>
  ): Promise<LoginChallengeView> {
    this.#assertOpen();
    if (input.account.ownerId !== this.options.hostOwnerId)
      throw new InferenceAuthenticationError('not-authorized');
    const key = accountKey(input.account),
      existing = this.#loginStarts.get(key);
    if (existing) {
      if (
        [...this.#logins.values()].some(
          (login) => accountKey(login.account) === key && login.phase === 'exchanging'
        )
      ) {
        throw new InferenceAuthenticationError('conflict');
      }
      return waitFor(existing.promise, input.signal);
    }
    const controller = new AbortController();
    const promise = startAccountLogin(this.#context(), {
      account: input.account,
      controller,
      signal: AbortSignal.any([controller.signal, this.#closed.signal]),
    });
    const entry = { controller, promise };
    this.#loginStarts.set(key, entry);
    void promise.catch(() => {
      if (this.#loginStarts.get(key) === entry) this.#loginStarts.delete(key);
    });
    return waitFor(promise, input.signal);
  }

  /** The pasted callback is parsed locally. It is never fetched or persisted. */
  async completeCallback(
    input: Readonly<{
      account: ProviderAccount;
      loginId: string;
      callbackUrl: string;
      signal: AbortSignal;
    }>
  ): Promise<void> {
    const login = this.#logins.get(input.loginId);
    const { code, state } = parseOAuthCallbackUrl(login, input.account, input.callbackUrl);
    await this.completeLogin({
      account: input.account,
      loginId: input.loginId,
      code,
      state,
      signal: input.signal,
    });
  }

  async completeLogin(
    input: Readonly<{
      account: ProviderAccount;
      loginId: string;
      code: string;
      state: string;
      signal: AbortSignal;
    }>
  ): Promise<void> {
    await completeAccountLogin(this.#context(), input);
  }

  async cancelLogin(input: Readonly<{ account: ProviderAccount; loginId: string }>): Promise<void> {
    const login = this.#logins.get(input.loginId);
    if (
      !login ||
      accountKey(login.account) !== accountKey(input.account) ||
      login.account.ownerId !== input.account.ownerId
    )
      throw new InferenceAuthenticationError('not-authorized');
    this.#logins.delete(input.loginId);
    if (this.#loginStarts.get(accountKey(input.account))?.controller === login.controller)
      this.#loginStarts.delete(accountKey(input.account));
    login.controller.abort();
    if (login.phase === 'ready') await this.#release(login.release);
  }

  async prepareLogin(
    input: Readonly<{
      account: ProviderAccount;
      expectedRevision: number;
      signal: AbortSignal;
    }>
  ): Promise<void> {
    this.#assertOpen();
    if (input.account.ownerId !== this.options.hostOwnerId)
      throw new InferenceAuthenticationError('not-authorized');
    const { service } = await this.#account(input.account);
    const current = await this.options.credentials.read(input.account);
    if ((current?.record.revision ?? 0) !== input.expectedRevision)
      throw new InferenceAuthenticationError('conflict');
    ready(current);
    const lease = await this.options.drivers.acquire({
      service,
      signal: input.signal,
    });
    try {
      await prepareAccountOAuth(this.#context(), {
        account: input.account,
        service,
        current,
        definition: lease.definition,
        signal: input.signal,
      });
    } finally {
      await this.#release(() => lease.release());
    }
  }

  async close(): Promise<void> {
    this.#closed.abort(new InferenceAuthenticationError('operation-closed'));
    for (const entry of this.#loginStarts.values()) entry.controller.abort();
    this.#loginStarts.clear();
    const logins = [...this.#logins.values()];
    this.#logins.clear();
    await Promise.all(
      logins.map(async (login) => {
        login.controller.abort();
        if (login.phase === 'ready') await this.#release(login.release);
      })
    );
  }

  /** Revoke exact removed identities immediately. Optional post-commit reads never change a proved save result. */
  async committed(
    input: Readonly<{
      graph: ProviderGraph;
      removedAccounts: readonly ProviderAccount[];
      credentials: readonly ProviderCredentialWrite[];
    }>
  ): Promise<void> {
    for (const account of input.removedAccounts) {
      const key = accountKey(account);
      this.#accounts.get(key)?.abort(new InferenceAuthenticationError('disconnected'));
      this.#accounts.delete(key);
      this.#uncertain.delete(key);
      const starting = this.#loginStarts.get(key);
      this.#loginStarts.delete(key);
      starting?.controller.abort();
      for (const [id, login] of this.#logins)
        if (accountKey(login.account) === key) {
          this.#logins.delete(id);
          login.controller.abort();
          if (login.phase === 'ready') await this.#release(login.release);
        }
    }
    try {
      for (const write of input.credentials) {
        if (!write.record) continue;
        const account = input.graph.accounts[write.accountId];
        if (!account) continue;
        await this.#account(account);
        const open = await this.options.credentials.read(account);
        if (open?.record.revision === write.record.revision && open.payload.status === 'ready') {
          this.#uncertain.delete(accountKey(account));
          this.#renewSignal(account);
        }
      }
    } catch {
      this.#reportCleanup('Provider state reconciliation is unavailable after a confirmed save');
    }
  }

  async #account(account: ProviderAccount): Promise<{ service: ProviderService }> {
    const graph = await this.options.repository.readGraph({
      rootId: account.rootId,
    });
    const current = graph?.accounts[account.id];
    if (
      !current ||
      current.ownerId !== account.ownerId ||
      current.incarnation !== account.incarnation ||
      current.serviceId !== account.serviceId
    ) {
      throw new InferenceAuthenticationError('conflict');
    }
    const service = graph!.services[current.serviceId];
    if (!service) throw new InferenceAuthenticationError('integrity');
    return { service };
  }

  #refresh(
    input: Readonly<{
      account: ProviderAccount;
      service: ProviderService;
      current: OpenCredential;
      retainDriver: () => ProviderDriverLease;
    }>
  ): Promise<OpenCredential> {
    const { account, service, current, retainDriver } = input;
    const key = accountKey(account);
    const existing = this.#flights.get(key);
    if (existing) return existing.promise;
    const promise = runAccountRefresh(this.#context(), {
      account,
      service,
      current,
      lease: retainDriver(),
    });
    const flight = { promise };
    this.#flights.set(key, flight);
    void promise
      .finally(() => {
        if (this.#flights.get(key) === flight) this.#flights.delete(key);
      })
      .catch(() => {});
    return promise;
  }

  /** Once per root and process: legacy sha256 material fingerprints become scrypt before any comparison. */
  #migrateLegacyFingerprints(rootId: string): Promise<void> {
    let migration = this.#fingerprintMigrations.get(rootId);
    if (!migration) {
      migration = migrateLegacyCredentialFingerprints(this.#context(), rootId).then(
        ({ migrated, skipped }) => {
          if (migrated)
            getLogger('inference').info(`Migrated ${migrated} inference credential fingerprint(s) from legacy sha256`);
          if (skipped)
            getLogger('inference').warn(`${skipped} inference credential(s) could not be checked for legacy fingerprint migration`);
        },
        (error: unknown) => {
          this.#fingerprintMigrations.delete(rootId);
          throw error;
        }
      );
      this.#fingerprintMigrations.set(rootId, migration);
    }
    return migration;
  }

  async #publish(
    input: Readonly<{
      account: ProviderAccount;
      previous: OpenCredential | undefined;
      authContractVersion: string;
      payload: CredentialPayload;
    }>
  ): Promise<OpenCredential> {
    return publishAccountCredential(this.#context(), input);
  }

  #signal(account: ProviderAccount): AbortSignal {
    const key = accountKey(account);
    let controller = this.#accounts.get(key);
    if (!controller) {
      controller = new AbortController();
      this.#accounts.set(key, controller);
    }
    return controller.signal;
  }

  #renewSignal(account: ProviderAccount): void {
    if (this.#accounts.get(accountKey(account))?.signal.aborted)
      this.#accounts.set(accountKey(account), new AbortController());
  }

  #assertOpen(): void {
    if (this.#closed.signal.aborted) throw new InferenceAuthenticationError('operation-closed');
  }

  #reportCleanup(message: string): void {
    try {
      if (this.options.cleanupFailed) this.options.cleanupFailed(message);
      else getLogger('inference').warn(message);
    } catch {
      /* Reporting cannot change an operation result. */
    }
  }

  async #release(release: () => void | Promise<void>): Promise<void> {
    try {
      await release();
    } catch {
      this.#reportCleanup('Provider lease cleanup failed');
    }
  }
}
