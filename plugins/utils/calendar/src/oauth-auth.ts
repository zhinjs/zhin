import { CalendarError } from './errors.js';
/**
 * OAuth authorization-code + PKCE helpers for the one-time auth CLI.
 */
import { createHash, randomBytes } from "node:crypto";

export const GOOGLE_AUTH_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
] as const;

export const MICROSOFT_AUTH_SCOPES = [
  "offline_access",
  "Calendars.ReadWrite",
  "User.Read",
] as const;

export interface PkcePair {
  readonly verifier: string;
  readonly challenge: string;
}

/** RFC 7636 S256 PKCE pair. */
export function createPkcePair(
  random: () => Buffer = () => randomBytes(32)
): PkcePair {
  const verifier = base64Url(random());
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function createOAuthState(
  random: () => Buffer = () => randomBytes(16)
): string {
  return base64Url(random());
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

export interface AuthUrlOptions {
  readonly provider: "google" | "microsoft";
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
  readonly tenant?: string;
}

/** Builds the browser authorize URL (PKCE S256). */
export function buildAuthorizeUrl(options: AuthUrlOptions): string {
  if (options.provider === "google") {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", options.clientId);
    url.searchParams.set("redirect_uri", options.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_AUTH_SCOPES.join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", options.state);
    url.searchParams.set("code_challenge", options.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }
  const tenant = options.tenant?.trim() || "common";
  const url = new URL(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`
  );
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", MICROSOFT_AUTH_SCOPES.join(" "));
  url.searchParams.set("state", options.state);
  url.searchParams.set("code_challenge", options.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export interface ExchangeOptions {
  readonly provider: "google" | "microsoft";
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly tenant?: string;
  readonly redirectUri: string;
  readonly code: string;
  readonly codeVerifier: string;
  readonly fetchImpl?: typeof fetch;
}

export interface ExchangedTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
}

/** Exchanges an authorization code for tokens (PKCE). */
export async function exchangeAuthorizationCode(
  options: ExchangeOptions
): Promise<ExchangedTokens> {
  const body = new URLSearchParams({
    client_id: options.clientId,
    code: options.code,
    redirect_uri: options.redirectUri,
    grant_type: "authorization_code",
    code_verifier: options.codeVerifier,
  });
  if (options.clientSecret?.trim())
    body.set("client_secret", options.clientSecret.trim());

  const url =
    options.provider === "google"
      ? "https://oauth2.googleapis.com/token"
      : `https://login.microsoftonline.com/${
          options.tenant?.trim() || "common"
        }/oauth2/v2.0/token`;

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const desc = String(
      data.error_description ?? data.error ?? response.statusText
    );
    throw new CalendarError('exchange', { provider: options.provider, detail: desc });
  }
  const refreshToken = String(data.refresh_token ?? "");
  const accessToken = String(data.access_token ?? "");
  if (!refreshToken) {
    throw new CalendarError('refreshMissing', { provider: options.provider });
  }
  if (!accessToken)
    throw new CalendarError('accessMissing', { provider: options.provider });
  return {
    accessToken,
    refreshToken,
    expiresIn: Number(data.expires_in ?? 3600),
  };
}
