import { createHash, randomBytes } from 'node:crypto';
import type { OAuthAuthentication, OAuthCredential } from '../provider/driver.js';
import type { AntigravityServiceOptions, CodexServiceOptions, FixedServiceOptions } from './schema.js';
import type { JsonObject } from '../provider/types.js';
import { parseRetryAfterMs } from '../llm/provider-resilience.js';

export type AuthenticationFailure = 'rejected' | 'not-submitted' | 'outcome-unknown' | 'invalid-response';

/** Deliberately excludes response bodies, URLs and credentials from public errors. */
export class ProviderAuthenticationError extends Error {
  readonly code: AuthenticationFailure;
  readonly status?: number;
  readonly credentialInvalid: boolean;
  readonly oauthError?: string;
  readonly retryAfterMs?: number;
  constructor(code: AuthenticationFailure, response?: Readonly<{
    status: number;
    oauthError?: string;
    retryAfterMs?: number;
  }>) {
    super(`Provider authentication: ${code}`);
    this.name = 'ProviderAuthenticationError';
    this.code = code;
    this.status = response?.status;
    this.oauthError = response?.oauthError;
    this.retryAfterMs = response?.retryAfterMs;
    this.credentialInvalid = code === 'rejected' && (response?.status === 400 || response?.status === 401)
      && (response.oauthError === 'invalid_grant' || response.oauthError === 'invalid_token');
  }
}

interface OAuthCodeConfiguration {
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly requiresClientSecret?: boolean;
  readonly redirectUri: string;
  readonly scopes: string;
  readonly encoding: 'form' | 'json';
  readonly pkce: boolean;
  readonly authorizeParameters?: Readonly<Record<string, string>>;
}

function tokenRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProviderAuthenticationError('invalid-response');
  return value as Record<string, unknown>;
}

export function parseOAuthCredential(raw: unknown, previous?: OAuthCredential): OAuthCredential {
  const value = tokenRecord(raw);
  if (typeof value.access_token !== 'string' || !value.access_token) throw new ProviderAuthenticationError('invalid-response');
  if (value.refresh_token !== undefined && typeof value.refresh_token !== 'string') throw new ProviderAuthenticationError('invalid-response');
  if (value.expires_in !== undefined && (typeof value.expires_in !== 'number' || !Number.isFinite(value.expires_in) || value.expires_in <= 0)) throw new ProviderAuthenticationError('invalid-response');
  const refreshToken = typeof value.refresh_token === 'string' ? value.refresh_token : previous?.refreshToken;
  const metadata: JsonObject = {
    ...previous?.metadata,
    ...(typeof value.id_token === 'string' ? { idToken: value.id_token } : {}),
  };
  return {
    accessToken: value.access_token,
    ...(refreshToken ? { refreshToken } : {}),
    ...(typeof value.expires_in === 'number' ? { expiresAt: Date.now() + value.expires_in * 1000 } : {}),
    ...(previous?.subject ? { subject: previous.subject } : {}),
    ...(previous?.preparation ? { preparation: previous.preparation } : {}),
    ...(Object.keys(metadata).length ? { metadata } : {}),
  };
}

async function exchange(input: {
  configuration: OAuthCodeConfiguration;
  fields: Record<string, string>;
  fetch: typeof globalThis.fetch;
  signal: AbortSignal;
}): Promise<unknown> {
  if (input.signal.aborted) throw new ProviderAuthenticationError('not-submitted');
  const { configuration } = input;
  let response: Response;
  try {
    response = await input.fetch(configuration.tokenUrl, {
      method: 'POST', redirect: 'error', signal: input.signal,
      headers: { 'content-type': configuration.encoding === 'json' ? 'application/json' : 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: configuration.encoding === 'json' ? JSON.stringify(input.fields) : new URLSearchParams(input.fields),
    });
  } catch { throw new ProviderAuthenticationError('outcome-unknown'); }
  if (!response.ok) {
    let oauthError: string | undefined;
    try {
      const value: unknown = await response.json();
      const error = value && typeof value === 'object' && 'error' in value ? value.error : undefined;
      const codes = ['invalid_grant', 'invalid_token', 'invalid_client', 'unauthorized_client', 'access_denied', 'temporarily_unavailable', 'server_error', 'slow_down', 'invalid_request'];
      if (typeof error === 'string' && codes.includes(error)) oauthError = error;
    } catch { /* HTTP rejection remains a fact; an unreadable body cannot invalidate credentials. */ }
    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after') ?? undefined);
    throw new ProviderAuthenticationError(response.status >= 400 && response.status < 500 ? 'rejected' : 'outcome-unknown', {
      status: response.status,
      ...(oauthError ? { oauthError } : {}),
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
  }
  try { return await response.json(); }
  catch { throw new ProviderAuthenticationError('outcome-unknown', { status: response.status }); }
}

/** Stateless OAuth protocol; transactions, secret storage and refresh ownership belong to Host. */
export function codeOAuth<S>(configuration: OAuthCodeConfiguration): OAuthAuthentication<S> {
  return {
    contractVersion: '1',
    redirectUri: configuration.redirectUri,
    ...(configuration.requiresClientSecret ? { requiresClientSecret: true } : {}),
    async begin({ redirectUri, client }) {
      if (redirectUri !== configuration.redirectUri || configuration.requiresClientSecret && !client?.clientSecret) throw new ProviderAuthenticationError('not-submitted');
      const state = randomBytes(32).toString('base64url');
      const verifier = randomBytes(32).toString('base64url');
      const params = new URLSearchParams({
        response_type: 'code', client_id: configuration.clientId,
        redirect_uri: redirectUri, scope: configuration.scopes, state,
        ...configuration.authorizeParameters,
        ...(configuration.pkce ? {
          code_challenge: createHash('sha256').update(verifier).digest('base64url'),
          code_challenge_method: 'S256',
        } : {}),
      });
      return { authorizationUrl: `${configuration.authorizeUrl}?${params}`, state, privateState: { verifier, redirectUri } };
    },
    async complete({ code, redirectUri, state, challenge, fetch, signal, client }) {
      if (configuration.requiresClientSecret && !client?.clientSecret) throw new ProviderAuthenticationError('not-submitted');
      if (state !== challenge.state || redirectUri !== challenge.privateState.redirectUri) throw new ProviderAuthenticationError('not-submitted');
      const verifier = challenge.privateState.verifier;
      if (configuration.pkce && typeof verifier !== 'string') throw new ProviderAuthenticationError('not-submitted');
      const parts = code.split('#');
      if (parts.length > 1 && parts[1] !== state) throw new ProviderAuthenticationError('not-submitted');
      return parseOAuthCredential(await exchange({ configuration, fetch, signal, fields: {
        grant_type: 'authorization_code', client_id: configuration.clientId,
        code: parts[0]!, redirect_uri: redirectUri,
        ...(configuration.requiresClientSecret ? { client_secret: client!.clientSecret! } : {}),
        ...(configuration.pkce ? { code_verifier: verifier as string } : {}),
        ...(configuration.encoding === 'json' ? { state } : {}),
      } }));
    },
    async refresh({ credential, fetch, signal, client }) {
      if (configuration.requiresClientSecret && !client?.clientSecret) throw new ProviderAuthenticationError('not-submitted');
      if (!credential.refreshToken) throw new ProviderAuthenticationError('not-submitted');
      return parseOAuthCredential(await exchange({ configuration, fetch, signal, fields: {
        grant_type: 'refresh_token', client_id: configuration.clientId, refresh_token: credential.refreshToken,
        ...(configuration.requiresClientSecret ? { client_secret: client!.clientSecret! } : {}),
      } }), credential);
    },
  };
}

const codexCodeOAuth = codeOAuth<CodexServiceOptions>({
  authorizeUrl: 'https://auth.openai.com/oauth/authorize', tokenUrl: 'https://auth.openai.com/oauth/token',
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann', scopes: 'openid profile email offline_access',
  redirectUri: 'http://localhost:1455/auth/callback',
  encoding: 'form', pkce: true,
  authorizeParameters: { id_token_add_organizations: 'true', codex_cli_simplified_flow: 'true' },
});

/** These JWT claims are routing hints from the token exchange, not verified identity evidence. */
function codexRoutingHints(credential: OAuthCredential): OAuthCredential {
  const idToken = credential.metadata?.idToken;
  if (typeof idToken !== 'string') return credential;
  try {
    const payload: unknown = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
    const claims = tokenRecord(payload);
    const auth = claims['https://api.openai.com/auth'];
    if (!auth || typeof auth !== 'object' || !('chatgpt_account_id' in auth) || typeof auth.chatgpt_account_id !== 'string') return credential;
    return { ...credential, metadata: { ...credential.metadata, chatgptAccountId: auth.chatgpt_account_id } };
  } catch { return credential; }
}

export const codexOAuth: OAuthAuthentication<CodexServiceOptions> = {
  ...codexCodeOAuth,
  async complete(input) { return codexRoutingHints(await codexCodeOAuth.complete(input)); },
  async refresh(input) { return codexRoutingHints(await codexCodeOAuth.refresh(input)); },
};

export const claudeOAuth = codeOAuth<FixedServiceOptions>({
  authorizeUrl: 'https://claude.ai/oauth/authorize', tokenUrl: 'https://api.anthropic.com/v1/oauth/token',
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e', scopes: 'user:profile user:inference',
  redirectUri: 'http://localhost:20127/callback',
  encoding: 'json', pkce: true, authorizeParameters: { code: 'true' },
});

const antigravityCodeOAuth = codeOAuth<AntigravityServiceOptions>({
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token',
  clientId: '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
  requiresClientSecret: true, redirectUri: 'http://localhost:20127/callback',
  scopes: ['cloud-platform', 'userinfo.email', 'userinfo.profile', 'cclog', 'experimentsandconfigs'].map(scope => `https://www.googleapis.com/auth/${scope}`).join(' '),
  encoding: 'form', pkce: false, authorizeParameters: { access_type: 'offline', prompt: 'consent' },
});

/** Upstream preparation step that failed; diagnostic only, never a credential or URL. */
export type ProviderPreparationStep = 'identity' | 'load-code-assist' | 'onboard-user' | 'onboard-operation';

/** Preparation failure retains the exchanged credential in Host; it never replays OAuth.
 * `status` is the upstream HTTP status and `reason` a sanitized upstream reason code
 * (e.g. Google `PERMISSION_DENIED` / `SERVICE_DISABLED`); response bodies, messages and tokens never escape. */
export class ProviderPreparationError extends Error {
  readonly code: 'identity-unavailable' | 'project-unavailable';
  readonly status?: number;
  readonly reason?: string;
  readonly step?: ProviderPreparationStep;
  constructor(code: ProviderPreparationError['code'], detail?: Readonly<{ status?: number; reason?: string; step?: ProviderPreparationStep }>) {
    super(`Provider account preparation: ${code}`);
    this.name = 'ProviderPreparationError'; this.code = code;
    if (detail?.status !== undefined) this.status = detail.status;
    const reason = safeReasonCode(detail?.reason);
    if (reason) this.reason = reason;
    if (detail?.step) this.step = detail.step;
  }
}

/** Only enum-like upstream codes (`PERMISSION_DENIED`, `INELIGIBLE_ACCOUNT`, `project-required`) are kept. */
function safeReasonCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(value) ? value : undefined;
}

/** Google RPC error: prefer `ErrorInfo.reason`, then `error.status`; never the free-text message. */
function googleErrorReason(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const error = 'error' in value && value.error && typeof value.error === 'object' ? value.error as Record<string, unknown> : value as Record<string, unknown>;
  const details = Array.isArray(error.details) ? error.details : [];
  for (const detail of details) {
    if (detail && typeof detail === 'object' && 'reason' in detail) {
      const reason = safeReasonCode(detail.reason);
      if (reason) return reason;
    }
  }
  return safeReasonCode(error.status);
}

const CODE_ASSIST_BASE = 'https://cloudcode-pa.googleapis.com/v1internal';
/** Client metadata shape used by the official open-source Code Assist client (google-gemini/gemini-cli). */
const CODE_ASSIST_METADATA = Object.freeze({ ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' });
/** Tier gemini-cli onboards when `allowedTiers` has no `isDefault` entry (`UserTierId.LEGACY`, code_assist/setup.ts `getOnboardTier`). */
const CODE_ASSIST_LEGACY_TIER = 'legacy-tier';
/** `UserTierId.FREE`: uses a Google-managed project; naming a project in its onboardUser request is rejected upstream. */
const CODE_ASSIST_FREE_TIER = 'free-tier';
const TRANSIENT_PREPARATION_REASONS: ReadonlySet<string> = new Set(['preparation-timeout', 'onboarding-timeout', 'request-timeout', 'transport']);
/** Long-running operation names are a single `operations/<id>` segment: no `/`, no dot-only (`.` / `..`) id. */
const OPERATION_NAME = /^operations\/(?=[A-Za-z0-9_.-]*[A-Za-z0-9])[A-Za-z0-9_-][A-Za-z0-9_.-]{0,255}$/u;

export interface AntigravityPreparationOptions {
  /** Delay between long-running onboarding polls. */
  readonly pollIntervalMs?: number;
  /** Bounded number of polls after the initial onboardUser call. */
  readonly maxPollAttempts?: number;
  /** Deadline for the whole preparation (identity, loadCodeAssist, onboarding and polling). */
  readonly overallTimeoutMs?: number;
  /** Deadline for each upstream request, including reading its body. */
  readonly requestTimeoutMs?: number;
}

function projectIdOf(value: unknown): string | undefined {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' && value.id) return value.id;
  return undefined;
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) { signal.throwIfAborted(); return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Antigravity OAuth with Code Assist project preparation; exported for tests with short polling. */
export function createAntigravityOAuth(options: AntigravityPreparationOptions = {}): OAuthAuthentication<AntigravityServiceOptions> {
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const maxPollAttempts = options.maxPollAttempts ?? 12;
  const overallTimeoutMs = options.overallTimeoutMs ?? 90_000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
  return {
    ...antigravityCodeOAuth,
    async complete(input) {
      return { ...await antigravityCodeOAuth.complete(input), preparation: { status: 'required' } };
    },
    async prepare({ service, credential, fetch, signal }) {
      signal.throwIfAborted();
      // The caller's abort propagates unchanged; our own deadlines become sanitized preparation failures.
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(overallTimeoutMs)]);
      const requestSignal = () => AbortSignal.any([deadline, AbortSignal.timeout(requestTimeoutMs)]);
      const timeoutReason = (request: AbortSignal): string | undefined => {
        signal.throwIfAborted();
        return deadline.aborted ? 'preparation-timeout' : request.aborted ? 'request-timeout' : undefined;
      };
      const headers = { authorization: `Bearer ${credential.accessToken}`, accept: 'application/json' };
      let identity: Record<string, unknown>;
      let status: number | undefined;
      const identitySignal = requestSignal();
      try {
        const response = await fetch('https://www.googleapis.com/oauth2/v1/userinfo', { headers, signal: identitySignal, redirect: 'error' });
        status = response.status;
        if (!response.ok) {
          throw new ProviderPreparationError('identity-unavailable', { status: response.status, reason: googleErrorReason(await response.json().catch(() => undefined)), step: 'identity' });
        }
        identity = tokenRecord(await response.json());
        if (typeof identity.id !== 'string' || !identity.id) throw new ProviderPreparationError('identity-unavailable', { status: response.status, reason: 'missing-subject', step: 'identity' });
      } catch (error) {
        const timeout = timeoutReason(identitySignal);
        if (error instanceof ProviderPreparationError && !timeout) throw error;
        throw new ProviderPreparationError('identity-unavailable', timeout ? { ...(status === undefined ? {} : { status }), reason: timeout, step: 'identity' }
          : status === undefined ? { reason: 'transport', step: 'identity' } : { status, reason: 'invalid-response', step: 'identity' });
      }

      /** One Code Assist call; non-2xx, transport failures and timeouts become project-unavailable with status/reason. */
      const call = async (step: ProviderPreparationStep, url: string, body?: unknown): Promise<Record<string, unknown>> => {
        const request = requestSignal();
        let response: Response;
        try {
          response = await fetch(url, body === undefined
            ? { method: 'GET', headers, signal: request, redirect: 'error' }
            : { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: request, redirect: 'error' });
        } catch {
          throw new ProviderPreparationError('project-unavailable', { reason: timeoutReason(request) ?? 'transport', step });
        }
        let value: unknown;
        try { value = await response.json(); } catch {
          const timeout = timeoutReason(request);
          if (timeout) throw new ProviderPreparationError('project-unavailable', { status: response.status, reason: timeout, step });
          value = undefined;
        }
        if (!response.ok) throw new ProviderPreparationError('project-unavailable', { status: response.status, reason: googleErrorReason(value), step });
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProviderPreparationError('project-unavailable', { status: response.status, reason: 'invalid-response', step });
        return value as Record<string, unknown>;
      };

      // Optional user-chosen Google Cloud project (gemini-cli `GOOGLE_CLOUD_PROJECT`), sent exactly as gemini-cli
      // code_assist/setup.ts does: top-level `cloudaicompanionProject` plus `metadata.duetProject`.
      const configuredProject = service.options.projectId;
      const projectFields = (tierId?: string) => configuredProject && tierId !== CODE_ASSIST_FREE_TIER
        ? { cloudaicompanionProject: configuredProject, metadata: { ...CODE_ASSIST_METADATA, duetProject: configuredProject } }
        : { metadata: CODE_ASSIST_METADATA };
      /** onboardUser plus bounded long-running-operation polling; returns the project the operation reports, if any. */
      const onboard = async (tierId: string): Promise<string | undefined> => {
        const request = { tierId, ...projectFields(tierId) };
        let operation = await call('onboard-user', `${CODE_ASSIST_BASE}:onboardUser`, request);
        for (let attempt = 0; operation.done !== true; attempt++) {
          if (attempt >= maxPollAttempts) throw new ProviderPreparationError('project-unavailable', { reason: 'onboarding-timeout', step: 'onboard-operation' });
          try { await abortableDelay(pollIntervalMs, deadline); } catch {
            throw new ProviderPreparationError('project-unavailable', { reason: timeoutReason(deadline) ?? 'preparation-timeout', step: 'onboard-operation' });
          }
          const name = typeof operation.name === 'string' && OPERATION_NAME.test(operation.name) ? operation.name : undefined;
          // Prefer polling the named long-running operation; repeat onboardUser when no operation name is returned.
          operation = name
            ? await call('onboard-operation', `${CODE_ASSIST_BASE}/${name}`)
            : await call('onboard-user', `${CODE_ASSIST_BASE}:onboardUser`, request);
        }
        if (operation.error) {
          const code = operation.error && typeof operation.error === 'object' && 'code' in operation.error && typeof operation.error.code === 'number' ? operation.error.code : undefined;
          throw new ProviderPreparationError('project-unavailable', { reason: googleErrorReason(operation.error) ?? (code === undefined ? 'onboarding-failed' : `rpc-${code}`), step: 'onboard-operation' });
        }
        const response = operation.response && typeof operation.response === 'object' ? operation.response as Record<string, unknown> : {};
        return projectIdOf(response.cloudaicompanionProject);
      };

      const loaded = await call('load-code-assist', `${CODE_ASSIST_BASE}:loadCodeAssist`, projectFields());
      let projectId = projectIdOf(loaded.cloudaicompanionProject);
      if (!projectId) {
        const ineligible = Array.isArray(loaded.ineligibleTiers) ? loaded.ineligibleTiers : [];
        const ineligibleReason = ineligible.map(tier => tier && typeof tier === 'object' && 'reasonCode' in tier ? safeReasonCode(tier.reasonCode) : undefined).find(Boolean);
        const currentTier = loaded.currentTier && typeof loaded.currentTier === 'object' ? loaded.currentTier as Record<string, unknown> : undefined;
        if (currentTier) {
          // Already on a tier but no managed project (reported in #1250 for accounts that work in the Antigravity app):
          // try onboarding once more on the current tier, which may provision or return the project.
          const currentTierId = typeof currentTier.id === 'string' && currentTier.id ? currentTier.id : undefined;
          let onboardFailure: ProviderPreparationError | undefined;
          if (currentTierId) {
            try { projectId = await onboard(currentTierId); } catch (error) {
              if (!(error instanceof ProviderPreparationError)) throw error;
              signal.throwIfAborted();
              onboardFailure = error;
            }
          }
          // gemini-cli: a tiered account without a managed project uses the user-chosen Cloud project.
          projectId ??= configuredProject;
          if (!projectId) {
            // Transient onboarding failures (deadlines, transport, upstream 5xx) are reported as such so a retry is suggested;
            // an upstream refusal ends as project-required (keeping its HTTP status and step), since a configured project is the remedy.
            if (onboardFailure && (TRANSIENT_PREPARATION_REASONS.has(onboardFailure.reason ?? '') || (onboardFailure.status ?? 0) >= 500)) throw onboardFailure;
            throw new ProviderPreparationError('project-unavailable', { status: onboardFailure?.status ?? 200, reason: ineligibleReason ?? 'project-required',
              step: onboardFailure?.step ?? (currentTierId ? 'onboard-operation' : 'load-code-assist') });
          }
        } else {
          // gemini-cli `validateLoadCodeAssistResponse`: the account must first be verified in a browser
          // (`ineligibleTiers[].reasonCode === 'VALIDATION_REQUIRED'` with a `validationUrl`); onboarding is not attempted.
          // The validation URL itself is never surfaced.
          if (ineligible.some(tier => !!tier && typeof tier === 'object' && (tier as Record<string, unknown>).reasonCode === 'VALIDATION_REQUIRED'
            && typeof (tier as Record<string, unknown>).validationUrl === 'string' && !!(tier as Record<string, unknown>).validationUrl)) {
            throw new ProviderPreparationError('project-unavailable', { status: 200, reason: 'validation-required', step: 'load-code-assist' });
          }
          const tiers = Array.isArray(loaded.allowedTiers) ? loaded.allowedTiers as unknown[] : [];
          const tier = tiers.find((item): item is Record<string, unknown> => !!item && typeof item === 'object' && (item as Record<string, unknown>).isDefault === true);
          // gemini-cli `getOnboardTier`: without an `isDefault` tier it onboards the legacy tier.
          const tierId = tier ? typeof tier.id === 'string' && tier.id ? tier.id : undefined : CODE_ASSIST_LEGACY_TIER;
          if (!tierId) throw new ProviderPreparationError('project-unavailable', { status: 200, reason: ineligibleReason ?? 'no-default-tier', step: 'load-code-assist' });
          // The free tier uses a Google-managed project (naming one there is rejected upstream); other tiers
          // name the configured project, and fall back to it when onboarding reports none (gemini-cli).
          projectId = await onboard(tierId) ?? (tierId === CODE_ASSIST_FREE_TIER ? undefined : configuredProject);
          if (!projectId) throw new ProviderPreparationError('project-unavailable', { status: 200, reason: ineligibleReason ?? 'project-required', step: 'onboard-operation' });
        }
      }
      return { ...credential, subject: identity.id as string, preparation: { status: 'ready' },
        metadata: { ...credential.metadata, projectId } };
    },
  };
}

export const antigravityOAuth: OAuthAuthentication<AntigravityServiceOptions> = createAntigravityOAuth();
