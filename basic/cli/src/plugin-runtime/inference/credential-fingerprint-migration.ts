import { createHash } from 'node:crypto';
import type { ProviderAccount } from '@zhin.js/ai/provider';
import { credentialMaterialFingerprint, type CredentialPayload, type OpenCredential } from './credentials.js';
import type { AccountRuntimeContext } from './account-runtime-helpers.js';

/**
 * The material fingerprint algorithm used before `@zhin.js/cli@1.1.29`.
 * Migration-only: authorization never accepts it; it is used once to prove that a stored
 * fingerprint was computed from exactly the secret that is available now.
 */
function legacyCredentialMaterialFingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function environmentSource(ctx: AccountRuntimeContext, account: ProviderAccount, current: OpenCredential) {
  const source = account.authentication.method === 'api-key'
    ? account.authentication.source ?? current.payload.source : undefined;
  if (!source || account.ownerId !== ctx.options.hostOwnerId) return undefined;
  if (typeof source === 'string' && !/^env:\/\/[A-Za-z_][A-Za-z0-9_]*$/u.test(source)) return undefined;
  return source;
}

async function migrateAccount(ctx: AccountRuntimeContext, account: ProviderAccount): Promise<boolean> {
  if (account.authentication.method !== 'api-key') return false;
  const current = await ctx.options.credentials.read(account);
  const stored = current?.payload.materialFingerprint;
  if (!current || current.payload.method !== 'api-key' || !stored) return false;

  if (current.payload.status === 'ready') {
    // The sealed key is exactly the material the stored fingerprint was computed from.
    const material = current.payload.key;
    if (!material?.trim() || stored !== legacyCredentialMaterialFingerprint(material)) return false;
    const payload = { ...current.payload, materialFingerprint: credentialMaterialFingerprint(material) } as CredentialPayload;
    await ctx.publish({ account, previous: current, authContractVersion: current.record.authContractVersion, payload });
    return true;
  }

  // `reauthorize` written by the 1.1.29 identity-change path keeps the previous (legacy) fingerprint and drops
  // the key. Restore it only when that fingerprint is exactly sha256 of the environment value present now: the
  // secret did not change, only the hash algorithm did. A real rotation hashes differently and stays locked.
  if (current.payload.status !== 'reauthorize') return false;
  const source = environmentSource(ctx, account, current);
  if (!source) return false;
  const key = await ctx.options.resolveSource(source);
  if (!key?.trim() || stored !== legacyCredentialMaterialFingerprint(key)) return false;
  await ctx.publish({
    account,
    previous: current,
    authContractVersion: current.record.authContractVersion,
    payload: {
      status: 'ready',
      method: 'api-key',
      key,
      materialFingerprint: credentialMaterialFingerprint(key),
      ...(current.payload.source ? { source: current.payload.source } : {}),
      ...(current.payload.subject ? { subject: current.payload.subject } : {}),
    },
  });
  return true;
}

/**
 * One-time, idempotent rewrite of API-key material fingerprints from the legacy sha256 form to the current
 * scrypt form. Runs before any authorization of the root can compare fingerprints. Never logs material.
 */
export async function migrateLegacyCredentialFingerprints(
  ctx: AccountRuntimeContext,
  rootId: string,
): Promise<Readonly<{ migrated: number; skipped: number }>> {
  const graph = await ctx.options.repository.readGraph({ rootId });
  let migrated = 0,
    skipped = 0;
  for (const account of Object.values(graph?.accounts ?? {})) {
    try {
      if (await migrateAccount(ctx, account)) migrated++;
    } catch {
      // A concurrent write, unavailable source or unreadable row leaves that row to normal authorization.
      skipped++;
    }
  }
  return { migrated, skipped };
}
