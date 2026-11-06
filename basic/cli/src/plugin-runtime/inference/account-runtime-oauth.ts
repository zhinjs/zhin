import { randomUUID } from 'node:crypto';
import type {
  ProviderDriverLease,
  ProviderAccount,
  ProviderDefinition,
  ProviderService,
} from '@zhin.js/ai/provider';
import {
  InferenceAuthenticationError,
  type CredentialPayload,
  type OpenCredential,
} from './credentials.js';
import { oauthExchangeFailure, oauthRecovery, oauthRefreshCooldown } from './oauth-refresh-policy.js';
import {
  type AccountRuntimeContext,
  type LoginChallengeView,
  type PendingLogin,
  accountKey,
  authenticationFailure,
  exchangeFailure,
  identity,
  publicFailure,
  ready,
} from './account-runtime-helpers.js';

export async function startAccountLogin(
  ctx: AccountRuntimeContext,
  input: Readonly<{
    account: ProviderAccount;
    controller: AbortController;
    signal: AbortSignal;
  }>
): Promise<LoginChallengeView> {
  const { service } = await ctx.verifyAccount(input.account);
  ctx.renewSignal(input.account);
  if (input.account.authentication.method !== 'oauth')
    throw new InferenceAuthenticationError('not-authorized');
  const lease = await ctx.options.drivers.acquire({
    service,
    signal: input.signal,
  });
  const oauth = lease.definition.authentication.oauth;
  if (!oauth) {
    await ctx.release(() => lease.release());
    throw new InferenceAuthenticationError('not-authorized');
  }
  const controller = input.controller;
  const redirectUri = oauth.redirectUri;
  try {
    const current = await ctx.options.credentials.read(input.account);
    const signal = AbortSignal.any([input.signal, controller.signal, ctx.closedSignal]);
    const challenge = await ctx.withFetch(
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
    ctx.assertOpen();
    const id = randomUUID();
    ctx.logins.set(id, {
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
    await ctx.release(() => lease.release());
    throw error;
  }
}

export function parseOAuthCallbackUrl(
  login: PendingLogin | undefined,
  account: ProviderAccount,
  callbackUrl: string
): { code: string; state: string } {
  if (
    !login ||
    login.phase !== 'ready' ||
    accountKey(login.account) !== accountKey(account)
  )
    throw new InferenceAuthenticationError('not-authorized');
  let callback: URL, expected: URL;
  try {
    callback = new URL(callbackUrl);
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
  return {
    code: callback.searchParams.get('code')!,
    state: callback.searchParams.get('state')!,
  };
}

export async function completeAccountLogin(
  ctx: AccountRuntimeContext,
  input: Readonly<{
    account: ProviderAccount;
    loginId: string;
    code: string;
    state: string;
    signal: AbortSignal;
  }>
): Promise<void> {
  if (input.account.ownerId !== ctx.options.hostOwnerId)
    throw new InferenceAuthenticationError('not-authorized');
  ctx.assertOpen();
  await ctx.verifyAccount(input.account);
  const login = ctx.logins.get(input.loginId);
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
    const previous = await ctx.options.credentials.read(login.account);
    if ((previous?.record.revision ?? 0) !== login.expectedRevision)
      throw new InferenceAuthenticationError('conflict');
    const pending = await ctx.publish({
      account: login.account,
      previous,
      authContractVersion: login.contractVersion,
      payload: {
        status: 'exchange-pending',
        method: 'oauth',
        operationId: login.id,
        ...identity(previous),
        ...(oauthRecovery(previous?.payload) ? { recovery: oauthRecovery(previous?.payload) } : {}),
      },
    });
    const signal = AbortSignal.any([
      input.signal,
      login.controller.signal,
      ctx.closedSignal,
      ctx.signal(login.account),
    ]);
    let invoked = false;
    try {
      signal.throwIfAborted();
      const credential = await ctx.withFetch(
        {
          service: login.service,
          account: login.account,
          definition: login.definition,
        },
        (fetch) => {
          signal.throwIfAborted();
          invoked = true;
          return login.definition.authentication.oauth!.complete({
            service: login.service,
            redirectUri: login.redirectUri,
            code: input.code,
            state: input.state,
            challenge: login.challenge,
            signal,
            ...(previous?.payload.client ? { client: previous.payload.client } : {}),
            fetch,
          });
        }
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
      const saved = await ctx.publish({
        account: login.account,
        previous: pending,
        authContractVersion: login.contractVersion,
        payload: {
          status: 'ready',
          method: 'oauth',
          credential,
          receivedAt: ctx.options.now?.() ?? Date.now(),
          ...identity(previous),
          identityEstablished: true,
          ...(credential.subject ? { subject: credential.subject } : {}),
        },
      });
      ctx.uncertain.delete(accountKey(login.account));
      ctx.renewSignal(login.account);
      if (
        credential.preparation?.status === 'required' &&
        login.definition.authentication.oauth?.prepare
      ) {
        try {
          await prepareAccountOAuth(ctx, {
            account: login.account,
            service: login.service,
            current: saved,
            definition: login.definition,
            signal,
          });
        } catch {
          ctx.reportCleanup('Account authenticated; read-only preparation is incomplete');
        }
      }
    } catch (error) {
      const failure = exchangeFailure({ error, signal, invoked });
      await finishFailedExchange(ctx, {
        account: login.account,
        pending,
        contract: login.contractVersion,
        error: failure,
        previous,
      });
      throw failure instanceof InferenceAuthenticationError
        ? failure
        : new InferenceAuthenticationError(publicFailure(failure));
    }
  } finally {
    ctx.logins.delete(input.loginId);
    if (ctx.loginStarts.get(accountKey(login.account))?.controller === login.controller)
      ctx.loginStarts.delete(accountKey(login.account));
    await ctx.release(login.release);
  }
}

/** Preparation is read-only upstream. Its failure keeps the already committed token, never repeats code exchange. */
export async function prepareAccountOAuth(
  ctx: AccountRuntimeContext,
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
  const signal = AbortSignal.any([input.signal, ctx.signal(account), ctx.closedSignal]);
  const bundle = current.payload.credential;
  const credential = await ctx.withFetch(
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
  await ctx.publish({
    account,
    previous: current,
    authContractVersion: current.record.authContractVersion,
    payload: {
      ...current.payload,
      credential,
      ...identity(current),
      ...(credential.subject ? { subject: credential.subject } : {}),
    },
  });
}

export async function runAccountRefresh(
  ctx: AccountRuntimeContext,
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
    const signal = AbortSignal.any([ctx.signal(account), ctx.closedSignal]);
    const oauth = lease.definition.authentication.oauth;
    if (!oauth || oauth.contractVersion !== current.record.authContractVersion)
      throw new InferenceAuthenticationError('conflict');
    const pending = await ctx.publish({
      account,
      previous: current,
      authContractVersion: oauth.contractVersion,
      payload: {
        status: 'exchange-pending',
        method: 'oauth',
        operationId: randomUUID(),
        ...identity(current),
        recovery: oauthRecovery(current.payload),
      },
    });
    let invoked = false;
    try {
      signal.throwIfAborted();
      const bundle = current.payload.credential;
      const credential = await ctx.withFetch(
        { service, account, definition: lease.definition },
        (fetch) => {
          signal.throwIfAborted();
          invoked = true;
          return oauth.refresh({
            service,
            credential: bundle,
            signal,
            ...(current.payload.client ? { client: current.payload.client } : {}),
            fetch,
          });
        }
      );
      signal.throwIfAborted();
      const previousSubject = identity(current).subject;
      if (previousSubject && credential.subject && previousSubject !== credential.subject)
        throw new InferenceAuthenticationError('identity-change');
      return await ctx.publish({
        account,
        previous: pending,
        authContractVersion: oauth.contractVersion,
        payload: {
          status: 'ready',
          method: 'oauth',
          credential,
          receivedAt: ctx.options.now?.() ?? Date.now(),
          ...identity(current),
          ...(credential.subject ? { subject: credential.subject } : {}),
        },
      });
    } catch (error) {
      const failure = exchangeFailure({ error, signal, invoked });
      await finishFailedExchange(ctx, {
        account,
        pending,
        contract: oauth.contractVersion,
        error: failure,
        previous: current,
      });
      throw failure instanceof InferenceAuthenticationError
        ? failure
        : new InferenceAuthenticationError(publicFailure(failure));
    }
  } finally {
    await ctx.release(() => lease.release());
  }
}

export async function finishFailedExchange(
  ctx: AccountRuntimeContext,
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
  const cooldown = previous?.payload.status === 'ready' && previous.payload.method === 'oauth'
    ? oauthRefreshCooldown({ error, previous: previous.payload, now: ctx.options.now?.() ?? Date.now() }) : undefined;
  const recovery = oauthRecovery(previous?.payload);
  const payload: CredentialPayload =
    failure === 'rejected' || failure === 'not-submitted'
      ? previous ? { ...previous.payload, ...(cooldown ? { refresh: cooldown } : {}) } : { status: 'reauthorize', method: 'oauth' }
      : {
          status: failure === 'credential-invalid' ? 'reauthorize' : 'uncertain',
          method: 'oauth',
          ...identity(previous),
          ...(failure === 'credential-invalid' ? {} : {
            ...(recovery ? { recovery } : {}),
            failure: oauthExchangeFailure(error),
          }),
        };
  try {
    await ctx.publish({
      account,
      previous: pending,
      authContractVersion: contract,
      payload,
    });
  } catch (writeError) {
    if (!(writeError instanceof InferenceAuthenticationError && writeError.code === 'conflict'))
      ctx.uncertain.add(accountKey(account));
  }
}
