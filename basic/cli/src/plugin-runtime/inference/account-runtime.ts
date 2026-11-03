import { randomUUID } from 'node:crypto';
import { getLogger } from '@zhin.js/logger';
import type {
  CredentialPort,
  CredentialGrant,
  OAuthChallenge,
  ProviderExecutionContext,
  ProviderDriverLease,
  ProviderAccount,
  ProviderDefinition,
  ProviderDriverResolver,
  ProviderRepository,
  ProviderService,
  ProviderCredentialWrite,
  ProviderGraph,
} from '@zhin.js/ai/provider';
import {
  credentialMaterialFingerprint,
  InferenceAuthenticationError,
  InferenceCredentialStore,
  type CredentialPayload,
  type OpenCredential,
} from './credentials.js';

interface AccountRuntimeOptions {
  readonly hostOwnerId: string;
  readonly repository: ProviderRepository;
  readonly credentials: InferenceCredentialStore;
  readonly drivers: ProviderDriverResolver;
  readonly fetch: (
    input: Readonly<{
      service: ProviderService;
      account: ProviderAccount;
      definition: ProviderDefinition<unknown, unknown>;
      purpose?: 'preparation';
      retainTransportState?: (state: Request | AbortSignal) => void;
    }>
  ) => typeof globalThis.fetch;
  readonly allowTarget: (
    input: Readonly<{
      service: ProviderService;
      definition: ProviderDefinition<unknown, unknown>;
      target: URL;
      purpose: 'inference' | 'discovery';
    }>
  ) => boolean;
  /** Explicit Host environment port. Never reads .env or another client's credential cache. */
  readonly resolveSource: (source: string) => string | undefined | Promise<string | undefined>;
  readonly now?: () => number;
  readonly cleanupFailed?: () => void;
}
interface Flight {
  readonly promise: Promise<OpenCredential>;
}
interface PendingLogin {
  readonly id: string;
  readonly account: ProviderAccount;
  readonly service: ProviderService;
  readonly expectedRevision: number;
  readonly redirectUri: string;
  readonly challenge: OAuthChallenge;
  readonly contractVersion: string;
  readonly controller: AbortController;
  readonly definition: ProviderDefinition<unknown, unknown>;
  readonly release: () => void | Promise<void>;
  phase: 'ready' | 'exchanging';
}
interface LoginStart {
  readonly controller: AbortController;
  readonly promise: Promise<LoginChallengeView>;
}
export interface AccountStatusView {
  readonly status: CredentialPayload['status'] | 'authenticated';
  readonly revision: number;
  readonly preparation?: 'required' | 'ready';
}
export interface LoginChallengeView {
  readonly loginId: string;
  readonly authorizationUrl: string;
  readonly redirectUri: string;
  readonly state: string;
}

function accountKey(account: ProviderAccount): string {
  return JSON.stringify([account.rootId, account.id, account.incarnation]);
}
function identity(open: OpenCredential | undefined): Readonly<{
  identityEstablished?: boolean;
  materialFingerprint?: string;
  subject?: string;
  client?: Readonly<{ clientSecret?: string }>;
}> {
  const payload = open?.payload;
  const subject =
    payload?.subject ??
    (payload?.status === 'ready' && payload.method === 'oauth'
      ? payload.credential.subject
      : undefined);
  return {
    ...(payload?.identityEstablished || payload?.status === 'ready'
      ? { identityEstablished: true }
      : {}),
    ...(payload?.materialFingerprint ? { materialFingerprint: payload.materialFingerprint } : {}),
    ...(subject ? { subject } : {}),
    ...(payload?.client ? { client: payload.client } : {}),
  };
}
async function waitFor<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let cancel: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        cancel = () => reject(signal.reason);
        signal.addEventListener('abort', cancel, { once: true });
      }),
    ]);
  } finally {
    if (cancel) signal.removeEventListener('abort', cancel);
  }
}
function authenticationFailure(
  error: unknown
): 'credential-invalid' | 'rejected' | 'not-submitted' | 'outcome-unknown' {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (
    code === 'rejected' &&
    error &&
    typeof error === 'object' &&
    'credentialInvalid' in error &&
    error.credentialInvalid === true
  ) {
    return 'credential-invalid';
  }
  return code === 'rejected' || code === 'not-submitted' ? code : 'outcome-unknown';
}
function publicFailure(
  error: unknown
): 'reauthorize' | 'rejected' | 'not-submitted' | 'outcome-unknown' {
  const result = authenticationFailure(error);
  return result === 'credential-invalid' ? 'reauthorize' : result;
}
function ready(open: OpenCredential | undefined): asserts open is OpenCredential & {
  payload: Extract<CredentialPayload, { status: 'ready' }>;
} {
  if (!open) throw new InferenceAuthenticationError('not-authorized');
  if (open.payload.status === 'not-authorized')
    throw new InferenceAuthenticationError('not-authorized');
  if (open.payload.status === 'exchange-pending' || open.payload.status === 'uncertain')
    throw new InferenceAuthenticationError('outcome-unknown');
  if (open.payload.status === 'disconnected')
    throw new InferenceAuthenticationError('disconnected');
  if (open.payload.status === 'reauthorize') throw new InferenceAuthenticationError('reauthorize');
}

/** Process-owned account authority. Generation-owned Provider handles borrow it; HMR does not disconnect accounts. */
export class HostAccountRuntime {
  readonly #closed = new AbortController();
  readonly #accounts = new Map<string, AbortController>();
  readonly #flights = new Map<string, Flight>();
  readonly #logins = new Map<string, PendingLogin>();
  readonly #loginStarts = new Map<string, LoginStart>();
  readonly #uncertain = new Set<string>();

  constructor(private readonly options: AccountRuntimeOptions) {}

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
      let open = await this.options.credentials.read(binding.account);
      if (binding.account.authentication.method === 'api-key') {
        open = await this.#environmentKey(binding.account, definition.contractVersion, open);
        ready(open);
        if (open.payload.method !== 'api-key') throw new InferenceAuthenticationError('integrity');
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
      const expiresAt = open.payload.credential.expiresAt;
      if (expiresAt !== undefined && expiresAt <= (this.options.now?.() ?? Date.now())) {
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
    return this.#status(account);
  }

  /** Host-private UI projection from its already-read graph, never an inference admission check. */
  async statuses(
    input: Readonly<{
      graph: ProviderGraph;
      accounts: readonly ProviderAccount[];
    }>
  ): Promise<Readonly<Record<string, AccountStatusView>>> {
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
          return [account.id, await this.#status(current)] as const;
        })
      )
    );
  }

  async #status(account: ProviderAccount): Promise<AccountStatusView> {
    if (account.authentication.method === 'none') return { status: 'ready', revision: 0 };
    const open = await this.options.credentials.read(account);
    if (this.#uncertain.has(accountKey(account)))
      return { status: 'uncertain', revision: open?.record.revision ?? 0 };
    if (
      open?.payload.status === 'ready' &&
      open.payload.method === 'oauth' &&
      open.payload.credential.preparation?.status === 'required'
    ) {
      return {
        status: 'authenticated',
        preparation: 'required',
        revision: open.record.revision,
      };
    }
    return {
      status: this.#uncertain.has(accountKey(account))
        ? 'uncertain'
        : open?.payload.status ?? 'not-authorized',
      revision: open?.record.revision ?? 0,
    };
  }

  async putKey(
    input: Readonly<{
      account: ProviderAccount;
      key: string;
      expectedRevision: number;
      authContractVersion: string;
    }>
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
      key: string;
      expectedRevision: number;
      authContractVersion: string;
    }>
  ): Promise<ProviderCredentialWrite> {
    this.#assertOpen();
    await this.#account(input.account);
    if (
      input.account.authentication.method !== 'api-key' ||
      input.account.authentication.source ||
      !input.key.trim()
    ) {
      throw new InferenceAuthenticationError('not-authorized');
    }
    const current = await this.options.credentials.read(input.account);
    if ((current?.record.revision ?? 0) !== input.expectedRevision)
      throw new InferenceAuthenticationError('conflict');
    const fingerprint = credentialMaterialFingerprint(input.key);
    if (
      current?.payload.materialFingerprint &&
      current.payload.materialFingerprint !== fingerprint
    ) {
      throw new InferenceAuthenticationError('identity-change');
    }
    const record = await this.options.credentials.seal({
      account: input.account,
      revision: input.expectedRevision + 1,
      authContractVersion: input.authContractVersion,
      payload: {
        status: 'ready',
        method: 'api-key',
        key: input.key,
        materialFingerprint: fingerprint,
      },
    });
    return {
      accountId: input.account.id,
      expectedRevision: input.expectedRevision,
      expectedIncarnation: input.account.incarnation,
      ...(current ? { expectedAuthContractVersion: current.record.authContractVersion } : {}),
      record,
    };
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
    this.#assertOpen();
    await this.#account(input.account);
    if (input.account.authentication.method !== 'oauth' || !input.clientSecret.trim())
      throw new InferenceAuthenticationError('not-authorized');
    const current = await this.options.credentials.read(input.account);
    if (
      (current?.record.revision ?? 0) !== input.expectedRevision ||
      current?.payload.status === 'exchange-pending'
    ) {
      throw new InferenceAuthenticationError('conflict');
    }
    const record = await this.options.credentials.seal({
      account: input.account,
      revision: input.expectedRevision + 1,
      authContractVersion: current?.record.authContractVersion ?? input.authContractVersion,
      payload: {
        ...(current?.payload ?? { status: 'not-authorized', method: 'oauth' }),
        client: { clientSecret: input.clientSecret },
      },
    });
    return {
      accountId: input.account.id,
      expectedRevision: input.expectedRevision,
      expectedIncarnation: input.account.incarnation,
      ...(current ? { expectedAuthContractVersion: current.record.authContractVersion } : {}),
      record,
    };
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
    const promise = this.#startLogin({
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

  async #startLogin(
    input: Readonly<{
      account: ProviderAccount;
      controller: AbortController;
      signal: AbortSignal;
    }>
  ): Promise<LoginChallengeView> {
    const { service } = await this.#account(input.account);
    this.#renewSignal(input.account);
    if (input.account.authentication.method !== 'oauth')
      throw new InferenceAuthenticationError('not-authorized');
    const lease = await this.options.drivers.acquire({
      service,
      signal: input.signal,
    });
    const oauth = lease.definition.authentication.oauth;
    if (!oauth) {
      await this.#release(() => lease.release());
      throw new InferenceAuthenticationError('not-authorized');
    }
    const controller = input.controller;
    const redirectUri = oauth.redirectUri;
    try {
      const current = await this.options.credentials.read(input.account);
      const signal = AbortSignal.any([input.signal, controller.signal, this.#closed.signal]);
      const challenge = await this.#withFetch(
        { service, account: input.account, definition: lease.definition },
        (fetch) =>
          oauth.begin({
            service,
            redirectUri,
            signal,
            ...(current?.payload.client ? { client: current.payload.client } : {}),
            fetch,
          })
      );
      input.signal.throwIfAborted();
      this.#assertOpen();
      const id = randomUUID();
      this.#logins.set(id, {
        id,
        account: input.account,
        service,
        expectedRevision: current?.record.revision ?? 0,
        redirectUri,
        challenge,
        contractVersion: oauth.contractVersion,
        controller,
        definition: lease.definition,
        release: () => lease.release(),
        phase: 'ready',
      });
      return {
        loginId: id,
        authorizationUrl: challenge.authorizationUrl,
        redirectUri,
        state: challenge.state,
      };
    } catch (error) {
      await this.#release(() => lease.release());
      throw error;
    }
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
    if (
      !login ||
      login.phase !== 'ready' ||
      accountKey(login.account) !== accountKey(input.account)
    )
      throw new InferenceAuthenticationError('not-authorized');
    let callback: URL, expected: URL;
    try {
      callback = new URL(input.callbackUrl);
      expected = new URL(login.redirectUri);
    } catch {
      throw new InferenceAuthenticationError('not-authorized');
    }
    if (
      callback.origin !== expected.origin ||
      callback.pathname !== expected.pathname ||
      callback.username ||
      callback.password ||
      callback.hash ||
      callback.searchParams.getAll('code').length !== 1 ||
      callback.searchParams.getAll('state').length !== 1 ||
      !callback.searchParams.get('code') ||
      callback.searchParams.get('state') !== login.challenge.state
    ) {
      throw new InferenceAuthenticationError('not-authorized');
    }
    await this.completeLogin({
      account: input.account,
      loginId: input.loginId,
      code: callback.searchParams.get('code')!,
      state: callback.searchParams.get('state')!,
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
    if (input.account.ownerId !== this.options.hostOwnerId)
      throw new InferenceAuthenticationError('not-authorized');
    this.#assertOpen();
    await this.#account(input.account);
    const login = this.#logins.get(input.loginId);
    if (
      !login ||
      login.phase !== 'ready' ||
      accountKey(login.account) !== accountKey(input.account) ||
      login.challenge.state !== input.state
    ) {
      throw new InferenceAuthenticationError('not-authorized');
    }
    login.phase = 'exchanging'; // One-time exchange, including when the result becomes unknown.
    try {
      const previous = await this.options.credentials.read(login.account);
      if ((previous?.record.revision ?? 0) !== login.expectedRevision)
        throw new InferenceAuthenticationError('conflict');
      const pending = await this.#publish({
        account: login.account,
        previous,
        authContractVersion: login.contractVersion,
        payload: {
          status: 'exchange-pending',
          method: 'oauth',
          operationId: login.id,
          ...identity(previous),
        },
      });
      const signal = AbortSignal.any([
        input.signal,
        login.controller.signal,
        this.#closed.signal,
        this.#signal(login.account),
      ]);
      try {
        signal.throwIfAborted();
        const credential = await this.#withFetch(
          {
            service: login.service,
            account: login.account,
            definition: login.definition,
          },
          (fetch) =>
            login.definition.authentication.oauth!.complete({
              service: login.service,
              redirectUri: login.redirectUri,
              code: input.code,
              state: input.state,
              challenge: login.challenge,
              signal,
              ...(previous?.payload.client ? { client: previous.payload.client } : {}),
              fetch,
            })
        );
        signal.throwIfAborted();
        const previousSubject = identity(previous).subject;
        if (previousSubject && credential.subject && previousSubject !== credential.subject) {
          throw new InferenceAuthenticationError('identity-change');
        }
        if (
          identity(previous).identityEstablished &&
          (!previousSubject ||
            (!credential.subject &&
              !(
                credential.preparation?.status === 'required' &&
                login.definition.authentication.oauth?.prepare
              )))
        ) {
          throw new InferenceAuthenticationError('identity-change');
        }
        const saved = await this.#publish({
          account: login.account,
          previous: pending,
          authContractVersion: login.contractVersion,
          payload: {
            status: 'ready',
            method: 'oauth',
            credential,
            ...identity(previous),
            identityEstablished: true,
            ...(credential.subject ? { subject: credential.subject } : {}),
          },
        });
        this.#uncertain.delete(accountKey(login.account));
        this.#renewSignal(login.account);
        if (
          credential.preparation?.status === 'required' &&
          login.definition.authentication.oauth?.prepare
        ) {
          try {
            await this.#prepare({
              account: login.account,
              service: login.service,
              current: saved,
              definition: login.definition,
              signal,
            });
          } catch {
            this.#reportCleanup('Account authenticated; read-only preparation is incomplete');
          }
        }
      } catch (error) {
        await this.#finishFailedExchange({
          account: login.account,
          pending,
          contract: login.contractVersion,
          error,
          previous,
        });
        throw error instanceof InferenceAuthenticationError
          ? error
          : new InferenceAuthenticationError(publicFailure(error));
      }
    } finally {
      this.#logins.delete(input.loginId);
      if (this.#loginStarts.get(accountKey(login.account))?.controller === login.controller)
        this.#loginStarts.delete(accountKey(login.account));
      await this.#release(login.release);
    }
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
      await this.#prepare({
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

  /** Preparation is read-only upstream. Its failure keeps the already committed token, never repeats code exchange. */
  async #prepare(
    input: Readonly<{
      account: ProviderAccount;
      service: ProviderService;
      current: OpenCredential;
      definition: ProviderDefinition<unknown, unknown>;
      signal: AbortSignal;
    }>
  ): Promise<void> {
    const { account, service, current, definition } = input;
    ready(current);
    const oauth = definition.authentication.oauth;
    if (current.payload.method !== 'oauth' || !oauth?.prepare)
      throw new InferenceAuthenticationError('not-prepared');
    if (current.record.authContractVersion !== oauth.contractVersion)
      throw new InferenceAuthenticationError('conflict');
    const signal = AbortSignal.any([input.signal, this.#signal(account), this.#closed.signal]);
    const bundle = current.payload.credential;
    const credential = await this.#withFetch(
      { service, account, definition, purpose: 'preparation' },
      (fetch) =>
        oauth.prepare!({
          service,
          credential: bundle,
          signal,
          ...(current.payload.client ? { client: current.payload.client } : {}),
          fetch,
        })
    );
    signal.throwIfAborted();
    if (
      credential.accessToken !== current.payload.credential.accessToken ||
      credential.refreshToken !== current.payload.credential.refreshToken ||
      credential.expiresAt !== current.payload.credential.expiresAt
    )
      throw new InferenceAuthenticationError('integrity');
    const subject = identity(current).subject;
    if (subject && credential.subject && subject !== credential.subject)
      throw new InferenceAuthenticationError('identity-change');
    await this.#publish({
      account,
      previous: current,
      authContractVersion: current.record.authContractVersion,
      payload: {
        status: 'ready',
        method: 'oauth',
        credential,
        ...identity(current),
        ...(credential.subject ? { subject: credential.subject } : {}),
      },
    });
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

  async #environmentKey(
    account: ProviderAccount,
    contract: string,
    current: OpenCredential | undefined
  ): Promise<OpenCredential | undefined> {
    if (account.authentication.method !== 'api-key' || !account.authentication.source)
      return current;
    const source = account.authentication.source;
    if (account.ownerId !== this.options.hostOwnerId)
      throw new InferenceAuthenticationError('not-authorized');
    if (!/^env:\/\/[A-Za-z_][A-Za-z0-9_]*$/u.test(source))
      throw new InferenceAuthenticationError('integrity');
    const key = await this.options.resolveSource(source);
    if (!key?.trim()) throw new InferenceAuthenticationError('not-authorized');
    if (current?.payload.status !== 'ready' && current !== undefined) return current;
    const fingerprint = credentialMaterialFingerprint(key);
    if (current?.payload.status === 'ready' && current.payload.method === 'api-key') {
      if (current.payload.materialFingerprint === fingerprint) return current;
      await this.#publish({
        account,
        previous: current,
        authContractVersion: contract,
        payload: {
          status: 'reauthorize',
          method: 'api-key',
          ...identity(current),
        },
      });
      throw new InferenceAuthenticationError('identity-change');
    }
    return this.#publish({
      account,
      previous: current,
      authContractVersion: contract,
      payload: {
        status: 'ready',
        method: 'api-key',
        key,
        materialFingerprint: fingerprint,
      },
    });
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
    const promise = this.#runRefresh({
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
  async #runRefresh(
    input: Readonly<{
      account: ProviderAccount;
      service: ProviderService;
      current: OpenCredential;
      lease: ProviderDriverLease;
    }>
  ): Promise<OpenCredential> {
    const { account, service, current, lease } = input;
    // This retained exact lease belongs to the shared refresh, independently of its first waiter.
    try {
      ready(current);
      if (current.payload.method !== 'oauth' || !current.payload.credential.refreshToken)
        throw new InferenceAuthenticationError('reauthorize');
      const signal = AbortSignal.any([this.#signal(account), this.#closed.signal]);
      const oauth = lease.definition.authentication.oauth;
      if (!oauth || oauth.contractVersion !== current.record.authContractVersion)
        throw new InferenceAuthenticationError('conflict');
      const pending = await this.#publish({
        account,
        previous: current,
        authContractVersion: oauth.contractVersion,
        payload: {
          status: 'exchange-pending',
          method: 'oauth',
          operationId: randomUUID(),
          ...identity(current),
        },
      });
      try {
        signal.throwIfAborted();
        const bundle = current.payload.credential;
        const credential = await this.#withFetch(
          { service, account, definition: lease.definition },
          (fetch) =>
            oauth.refresh({
              service,
              credential: bundle,
              signal,
              ...(current.payload.client ? { client: current.payload.client } : {}),
              fetch,
            })
        );
        const previousSubject = identity(current).subject;
        if (previousSubject && credential.subject && previousSubject !== credential.subject)
          throw new InferenceAuthenticationError('identity-change');
        return await this.#publish({
          account,
          previous: pending,
          authContractVersion: oauth.contractVersion,
          payload: {
            status: 'ready',
            method: 'oauth',
            credential,
            ...identity(current),
            ...(credential.subject ? { subject: credential.subject } : {}),
          },
        });
      } catch (error) {
        await this.#finishFailedExchange({
          account,
          pending,
          contract: oauth.contractVersion,
          error,
          previous: current,
        });
        throw error instanceof InferenceAuthenticationError
          ? error
          : new InferenceAuthenticationError(publicFailure(error));
      }
    } finally {
      await this.#release(() => lease.release());
    }
  }

  async #finishFailedExchange(
    input: Readonly<{
      account: ProviderAccount;
      pending: OpenCredential;
      contract: string;
      error: unknown;
      previous: OpenCredential | undefined;
    }>
  ): Promise<void> {
    const { account, pending, contract, error, previous } = input;
    const failure = authenticationFailure(error);
    const payload: CredentialPayload =
      failure === 'rejected' || failure === 'not-submitted'
        ? previous?.payload ?? { status: 'reauthorize', method: 'oauth' }
        : {
            status: failure === 'credential-invalid' ? 'reauthorize' : 'uncertain',
            method: 'oauth',
            ...identity(previous),
          };
    try {
      await this.#publish({
        account,
        previous: pending,
        authContractVersion: contract,
        payload,
      });
    } catch (writeError) {
      if (!(writeError instanceof InferenceAuthenticationError && writeError.code === 'conflict'))
        this.#uncertain.add(accountKey(account));
    }
  }
  async #publish(
    input: Readonly<{
      account: ProviderAccount;
      previous: OpenCredential | undefined;
      authContractVersion: string;
      payload: CredentialPayload;
    }>
  ): Promise<OpenCredential> {
    const record = await this.options.credentials.seal({
      account: input.account,
      revision: (input.previous?.record.revision ?? 0) + 1,
      authContractVersion: input.authContractVersion,
      payload: input.payload,
    });
    const result = await this.options.repository.commitCredential({
      rootId: input.account.rootId,
      write: {
        accountId: input.account.id,
        expectedRevision: input.previous?.record.revision ?? 0,
        expectedIncarnation: input.account.incarnation,
        ...(input.previous
          ? {
              expectedAuthContractVersion: input.previous.record.authContractVersion,
            }
          : {}),
        record,
      },
    });
    if (result.status === 'committed') return { record, payload: input.payload };
    if (result.status === 'conflict') throw new InferenceAuthenticationError('conflict');
    if (result.status === 'commit-unknown') {
      try {
        const observed = await this.options.credentials.read(input.account);
        if (observed && JSON.stringify(observed.record) === JSON.stringify(record)) return observed;
      } catch {
        /* An unavailable lookup cannot prove that an external exchange was not performed. */
      }
      this.#uncertain.add(accountKey(input.account));
      throw new InferenceAuthenticationError('outcome-unknown');
    }
    throw new InferenceAuthenticationError('unavailable');
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
      if (this.options.cleanupFailed) this.options.cleanupFailed();
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
