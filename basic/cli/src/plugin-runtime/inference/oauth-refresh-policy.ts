import { computeBackoffDelay } from '@zhin.js/ai';
import type { CredentialPayload, OAuthExchangeFailure, OAuthRecovery } from './credentials.js';

type ReadyOAuth = Extract<CredentialPayload, { status: 'ready'; method: 'oauth' }>;

/** Legacy bundles have no receipt time: retain their original expiry boundary once. */
export function oauthRefreshDue(payload: ReadyOAuth, now: number): boolean {
  const expiresAt = payload.credential.expiresAt;
  if (expiresAt === undefined) return false;
  const lead = payload.receivedAt === undefined ? 0 : Math.min(300_000, Math.max(0, expiresAt - payload.receivedAt) * 0.1);
  return now >= expiresAt - lead;
}

export function oauthRecovery(payload: CredentialPayload | undefined): OAuthRecovery | undefined {
  if (payload?.status === 'ready' && payload.method === 'oauth') return {
    credential: payload.credential,
    ...(payload.receivedAt === undefined ? {} : { receivedAt: payload.receivedAt }),
  };
  return payload && 'recovery' in payload ? payload.recovery : undefined;
}

function errorFacts(error: unknown): Record<string, unknown> {
  return error && typeof error === 'object' ? error as Record<string, unknown> : {};
}

/** Delay future demand; never loop or schedule token requests in the background. */
export function oauthRefreshCooldown(input: Readonly<{ error: unknown; previous: ReadyOAuth; now: number }>): ReadyOAuth['refresh'] {
  const facts = errorFacts(input.error);
  if (facts.status !== 429 && facts.oauthError !== 'slow_down') return undefined;
  // Saturating exponent state, not a count used for reporting or a retry limit.
  const failures = Math.min((input.previous.refresh?.failures ?? 0) + 1, 5);
  const retryAfterMs = typeof facts.retryAfterMs === 'number' && Number.isFinite(facts.retryAfterMs) && facts.retryAfterMs >= 0
    ? facts.retryAfterMs : undefined;
  return { failures, nextAttemptAt: input.now + computeBackoffDelay(failures - 1, { baseDelayMs: 1_000, maxDelayMs: 10_000 }, retryAfterMs) };
}

/** Only normalized protocol facts leave the encrypted bundle; never retain raw errors/bodies. */
export function oauthExchangeFailure(error: unknown): OAuthExchangeFailure {
  const facts = errorFacts(error);
  const status = typeof facts.status === 'number' && Number.isInteger(facts.status) && facts.status >= 100 && facts.status < 600 ? facts.status : undefined;
  const allowed = ['invalid_grant', 'invalid_token', 'invalid_client', 'unauthorized_client', 'access_denied', 'temporarily_unavailable', 'server_error', 'slow_down', 'invalid_request'];
  const oauthError = typeof facts.oauthError === 'string' && allowed.includes(facts.oauthError) ? facts.oauthError : undefined;
  return {
    kind: status !== undefined && status >= 500 && (oauthError === 'server_error' || oauthError === 'temporarily_unavailable')
      ? 'temporary-response' : facts.code === 'invalid-response' || facts.code === 'identity-change' || status !== undefined && status < 400 ? 'invalid-response'
      : status !== undefined ? 'response-error' : 'transport-unknown',
    ...(status === undefined ? {} : { status }),
    ...(oauthError ? { oauthError } : {}),
  };
}
