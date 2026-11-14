import { scryptSync } from 'node:crypto';
import {
  parseCredentialEnvironmentExpression,
  type JsonObject,
  type OAuthCredential,
  type ProviderAccount,
  type ProviderCredentialRecord,
  type ProviderRepository,
} from '@zhin.js/ai/provider';
import { createHostDocumentCipher, type EnvironmentExpressionSource } from '@zhin.js/plugin-runtime';

export type { EnvironmentExpressionSource };

export interface CredentialIdentity {
  readonly identityEstablished?: boolean;
  readonly materialFingerprint?: string;
  readonly subject?: string;
  readonly client?: Readonly<{ clientSecret?: string }>;
  /** A default may itself be secret; this expression never enters public configuration. */
  readonly source?: EnvironmentExpressionSource;
}
export type ApiKeyMaterial = Readonly<{ key: string; source?: never }> | Readonly<{ source: EnvironmentExpressionSource; key?: never }>;

/** Validates private entry and offline migration with the same exact-template parser. */
export function environmentExpressionSource(input: unknown): EnvironmentExpressionSource {
  const source = object(input);
  if (source.kind !== 'environment-expression' || typeof source.expression !== 'string'
    || !parseCredentialEnvironmentExpression(source.expression)) throw new InferenceAuthenticationError('not-authorized');
  return { kind: 'environment-expression', expression: source.expression };
}

/** Keep the existing private password entry and offline imports on one syntax boundary. */
export function normalizeApiKeyMaterial(input: ApiKeyMaterial): ApiKeyMaterial {
  if (input.source) return { source: environmentExpressionSource(input.source) };
  if (input.key.includes('${')) return { source: environmentExpressionSource({ kind: 'environment-expression', expression: input.key }) };
  if (!input.key.trim()) throw new InferenceAuthenticationError('not-authorized');
  return { key: input.key };
}
/** Private recovery only; its presence never authorizes token reuse. */
export interface OAuthRecovery {
  readonly credential: OAuthCredential;
  readonly receivedAt?: number;
}
export interface OAuthExchangeFailure {
  readonly kind: 'temporary-response' | 'response-error' | 'transport-unknown' | 'invalid-response';
  readonly status?: number;
  readonly oauthError?: string;
}
export type CredentialPayload = (
  | Readonly<{
      status: 'ready';
      method: 'api-key';
      /** Missing until a private source is first resolved by Host authorization. */
      key?: string;
      materialFingerprint?: string;
      subject?: string;
    }>
  | Readonly<{
      status: 'ready';
      method: 'oauth';
      credential: OAuthCredential;
      /** Host receipt time, unchanged when restoring this same token after a rejection. */
      receivedAt?: number;
      /** Account-wide cooldown, independent of public configuration and model purposes. */
      refresh?: Readonly<{ failures: number; nextAttemptAt: number }>;
      subject?: string;
    }>
  | Readonly<{
      status: 'exchange-pending';
      method: 'oauth';
      operationId: string;
      recovery?: OAuthRecovery;
    }>
  | Readonly<{ status: 'not-authorized'; method: 'oauth' }>
  | Readonly<{
      status: 'disconnected' | 'reauthorize' | 'uncertain';
      method: 'api-key' | 'oauth';
      recovery?: OAuthRecovery;
      failure?: OAuthExchangeFailure;
    }>
) &
  CredentialIdentity;

export type AuthenticationErrorCode =
  | 'unavailable'
  | 'integrity'
  | 'not-authorized'
  | 'disconnected'
  | 'reauthorize'
  | 'outcome-unknown'
  | 'conflict'
  | 'identity-change'
  | 'target-denied'
  | 'operation-closed'
  | 'not-submitted'
  | 'rejected'
  | 'not-prepared'
  /** A confidential OAuth client needs the account's client secret before login can begin. */
  | 'client-secret-required'
  /** Driver preparation failed; `preparation` carries the safe driver code and upstream status. */
  | 'preparation-failed';
/** Safe diagnostics of a failed driver preparation: codes and HTTP status only, never bodies, URLs or tokens. */
export interface InferencePreparationFailure {
  readonly code: string;
  readonly status?: number;
  readonly reason?: string;
  readonly step?: string;
}
export class InferenceAuthenticationError extends Error {
  readonly preparation?: InferencePreparationFailure;
  constructor(readonly code: AuthenticationErrorCode, preparation?: InferencePreparationFailure) {
    super(`Inference authentication: ${code}`);
    this.name = 'InferenceAuthenticationError';
    if (preparation) this.preparation = preparation;
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new InferenceAuthenticationError('integrity');
  return value as Record<string, unknown>;
}
function payload(input: unknown): CredentialPayload {
  const value = object(input);
  if (!['api-key', 'oauth'].includes(String(value.method)))
    throw new InferenceAuthenticationError('integrity');
  if (value.source !== undefined) environmentExpressionSource(value.source);
  if (['disconnected', 'reauthorize', 'uncertain', 'not-authorized'].includes(String(value.status)))
    return value as unknown as CredentialPayload;
  if (
    value.status === 'exchange-pending' &&
    value.method === 'oauth' &&
    typeof value.operationId === 'string'
  ) {
    return value as unknown as CredentialPayload;
  }
  if (value.status !== 'ready') throw new InferenceAuthenticationError('integrity');
  if (value.method === 'api-key') {
    if (
      value.key === undefined ? value.source === undefined
        : typeof value.key !== 'string' || !value.key.trim() || typeof value.materialFingerprint !== 'string'
    ) {
      throw new InferenceAuthenticationError('integrity');
    }
  } else {
    const credential = object(value.credential);
    if (
      typeof credential.accessToken !== 'string' ||
      !credential.accessToken ||
      (credential.refreshToken !== undefined && typeof credential.refreshToken !== 'string') ||
      (credential.expiresAt !== undefined &&
        (typeof credential.expiresAt !== 'number' || !Number.isFinite(credential.expiresAt)))
    ) {
      throw new InferenceAuthenticationError('integrity');
    }
  }
  return value as unknown as CredentialPayload;
}

export interface OpenCredential {
  readonly record: ProviderCredentialRecord;
  readonly payload: CredentialPayload;
}
interface CredentialStoreOptions {
  readonly directory: string;
  readonly repository: ProviderRepository;
}

/** The cipher master remains Host-private; only sealed records are written into the SQL transaction. */
export class InferenceCredentialStore {
  readonly #cipher: ReturnType<typeof createHostDocumentCipher>;
  constructor(private readonly options: CredentialStoreOptions) {
    this.#cipher = createHostDocumentCipher(options.directory);
  }
  async read(account: ProviderAccount): Promise<OpenCredential | undefined> {
    const record = await this.options.repository.readCredential({
      rootId: account.rootId,
      accountId: account.id,
    });
    if (!record) return undefined;
    if (record.incarnation !== account.incarnation)
      throw new InferenceAuthenticationError('conflict');
    let value: unknown;
    try {
      value = JSON.parse(await this.#cipher.open(record.payload, this.#aad(account, record)));
    } catch {
      throw new InferenceAuthenticationError('integrity');
    }
    return { record, payload: payload(value) };
  }
  async seal(
    input: Readonly<{
      account: ProviderAccount;
      revision: number;
      authContractVersion: string;
      payload: CredentialPayload;
    }>
  ): Promise<ProviderCredentialRecord> {
    const { account, revision, authContractVersion } = input;
    const record = {
      rootId: account.rootId,
      accountId: account.id,
      incarnation: account.incarnation,
      revision,
      authContractVersion,
      formatVersion: 1,
    };
    let sealed: JsonObject;
    try {
      const envelope = await this.#cipher.seal(
        JSON.stringify(payload(input.payload)),
        this.#aad(account, record)
      );
      sealed = {
        version: envelope.version,
        iv: envelope.iv,
        tag: envelope.tag,
        ciphertext: envelope.ciphertext,
      };
    } catch {
      throw new InferenceAuthenticationError('unavailable');
    }
    return { ...record, payload: sealed };
  }
  #aad(account: ProviderAccount, record: Omit<ProviderCredentialRecord, 'payload'>): Buffer {
    return Buffer.from(
      JSON.stringify([
        'inference-credential',
        1,
        account.rootId,
        account.ownerId,
        account.id,
        account.incarnation,
        record.revision,
        record.authContractVersion,
        record.formatVersion,
      ])
    );
  }
}

const CREDENTIAL_FINGERPRINT_SALT = 'zhin-inference-material-fingerprint-v1';

/** This fingerprint is only retained inside the encrypted private payload, never in public graph/DTO/logs. */
export function credentialMaterialFingerprint(value: string): string {
  return scryptSync(value, CREDENTIAL_FINGERPRINT_SALT, 32).toString('hex');
}
