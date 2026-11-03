import { createHash, randomBytes } from 'node:crypto';
import type { OAuthAuthentication, OAuthCredential } from '../provider/driver.js';
import type { FixedServiceOptions } from './schema.js';
import type { JsonObject } from '../provider/types.js';

export type AuthenticationFailure = 'rejected' | 'not-submitted' | 'outcome-unknown' | 'invalid-response';

/** Deliberately excludes response bodies, URLs and credentials from public errors. */
export class ProviderAuthenticationError extends Error {
  readonly code: AuthenticationFailure;
  readonly status?: number;
  readonly credentialInvalid: boolean;
  readonly oauthError?: string;
  constructor(code: AuthenticationFailure, status?: number, oauthError?: string) {
    super(`Provider authentication: ${code}`);
    this.name = 'ProviderAuthenticationError';
    this.code = code;
    this.status = status;
    this.oauthError = oauthError;
    this.credentialInvalid = code === 'rejected' && (status === 400 || status === 401)
      && (oauthError === 'invalid_grant' || oauthError === 'invalid_token');
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
    throw new ProviderAuthenticationError(response.status >= 400 && response.status < 500 ? 'rejected' : 'outcome-unknown', response.status, oauthError);
  }
  try { return await response.json(); }
  catch { throw new ProviderAuthenticationError('outcome-unknown'); }
}

/** Stateless OAuth protocol; transactions, secret storage and refresh ownership belong to Host. */
export function codeOAuth<S>(configuration: OAuthCodeConfiguration): OAuthAuthentication<S> {
  return {
    contractVersion: '1',
    redirectUri: configuration.redirectUri,
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

const codexCodeOAuth = codeOAuth<FixedServiceOptions>({
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

export const codexOAuth: OAuthAuthentication<FixedServiceOptions> = {
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

const antigravityCodeOAuth = codeOAuth<FixedServiceOptions>({
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token',
  clientId: '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
  requiresClientSecret: true, redirectUri: 'http://localhost:20127/callback',
  scopes: ['cloud-platform', 'userinfo.email', 'userinfo.profile', 'cclog', 'experimentsandconfigs'].map(scope => `https://www.googleapis.com/auth/${scope}`).join(' '),
  encoding: 'form', pkce: false, authorizeParameters: { access_type: 'offline', prompt: 'consent' },
});

/** Preparation failure retains the exchanged credential in Host; it never replays OAuth. */
export class ProviderPreparationError extends Error {
  readonly code: 'identity-unavailable' | 'project-unavailable';
  constructor(code: ProviderPreparationError['code']) {
    super(`Provider account preparation: ${code}`);
    this.name = 'ProviderPreparationError'; this.code = code;
  }
}

export const antigravityOAuth: OAuthAuthentication<FixedServiceOptions> = {
  ...antigravityCodeOAuth,
  async complete(input) {
    return { ...await antigravityCodeOAuth.complete(input), preparation: { status: 'required' } };
  },
  async prepare({ credential, fetch, signal }) {
    signal.throwIfAborted();
    const headers = { authorization: `Bearer ${credential.accessToken}`, accept: 'application/json' };
    let identity: Record<string, unknown>;
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v1/userinfo', { headers, signal, redirect: 'error' });
      if (!response.ok) throw new ProviderPreparationError('identity-unavailable');
      identity = tokenRecord(await response.json());
      if (typeof identity.id !== 'string' || !identity.id) throw new ProviderPreparationError('identity-unavailable');
    } catch { throw new ProviderPreparationError('identity-unavailable'); }
    let project: Record<string, unknown>;
    try {
      const response = await fetch('https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', {
        method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}', signal, redirect: 'error',
      });
      if (!response.ok) throw new ProviderPreparationError('project-unavailable');
      project = tokenRecord(await response.json());
    } catch { throw new ProviderPreparationError('project-unavailable'); }
    const value = project.cloudaicompanionProject;
    const projectId = typeof value === 'string' ? value
      : value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' ? value.id : undefined;
    if (!projectId) throw new ProviderPreparationError('project-unavailable');
    return { ...credential, subject: identity.id as string, preparation: { status: 'ready' },
      metadata: { ...credential.metadata, projectId } };
  },
};
