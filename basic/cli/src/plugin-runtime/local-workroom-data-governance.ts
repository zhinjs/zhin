import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  digestCanonicalWorkroomValue,
  type WorkroomDataGovernancePublicationDecision,
  type WorkroomDataGovernanceRootProviderResolution,
  installWorkroomDataGovernanceResources,
} from '@zhin.js/agent/runtime';

type CryptographyPort = NonNullable<
Parameters<typeof installWorkroomDataGovernanceResources>[0]['cryptography']
>;
type VerificationPort = NonNullable<
Parameters<typeof installWorkroomDataGovernanceResources>[0]['governance']
>;
type GovernanceDecision = Parameters<VerificationPort['verify']>[0];
type LifecycleAuthorities = NonNullable<WorkroomDataGovernanceRootProviderResolution['lifecycle']>;
type LifecycleAuthorizationRequest = Parameters<LifecycleAuthorities['authority']['authorize']>[0];
type LifecycleAuthorizationDecision = Parameters<LifecycleAuthorities['authority']['verify']>[1];
type LifecycleDeletionDispatch = Parameters<LifecycleAuthorities['deletion']['purge']>[0];
type LifecyclePurgeReceipt = Parameters<LifecycleAuthorities['receipts']['verify']>[0];
type LifecycleOrphanPurgeRequest = Parameters<LifecycleAuthorities['orphanPurge']['purge']>[0];
type LifecycleOrphanPurgeReceipt = Parameters<LifecycleAuthorities['orphanPurge']['reconcile']>[1];

interface LocalRootKeyDocument {
  readonly version: 1;
  readonly keyId: string;
  readonly key: string;
}

export interface LocalWorkroomDataGovernanceAuthority {
  readonly cryptography: CryptographyPort;
  readonly verification: VerificationPort;
  readonly lifecycle: LifecycleAuthorities;
  issuePublicationDecision(input: Readonly<{
    projectId: string;
    catalogRevision: string;
    catalogBindingDigest: string;
    candidateDigest: string;
    expectedPreviousDigest?: string;
    principalId: string;
    authorizedBy: 'data_steward' | 'sponsor';
  }>, signal: AbortSignal): Promise<WorkroomDataGovernancePublicationDecision>;
}

/**
 * Standalone Root authority for self-hosted Zhin processes. The wrapping/signing
 * key is process-private, mode 0600 and never enters Config or Resource scopes.
 */
export function createLocalWorkroomDataGovernanceAuthority(options: Readonly<{
  stateRoot: string;
  now?: () => number;
}>): LocalWorkroomDataGovernanceAuthority {
  const keyPath = join(options.stateRoot, 'workroom-data-governance-root-key.json');
  const now = options.now ?? Date.now;
  let keyPromise: Promise<Readonly<{ keyId: string; key: Buffer }>> | undefined;
  const key = () => keyPromise ??= readOrCreateRootKey(keyPath);

  const cryptography: CryptographyPort = Object.freeze({
    async wrap(
      request: Parameters<CryptographyPort['wrap']>[0],
      signal: Parameters<CryptographyPort['wrap']>[1],
    ) {
      signal.throwIfAborted();
      const rootKey = await key();
      signal.throwIfAborted();
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', rootKey.key, nonce);
      cipher.setAAD(cryptographyAad(request));
      const ciphertext = Buffer.concat([cipher.update(request.dataKey), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Object.freeze({
        keyId: rootKey.keyId,
        wrappedKey: Buffer.concat([nonce, tag, ciphertext]).toString('base64'),
      });
    },
    async unwrap(
      request: Parameters<CryptographyPort['unwrap']>[0],
      signal: Parameters<CryptographyPort['unwrap']>[1],
    ) {
      signal.throwIfAborted();
      const rootKey = await key();
      if (request.keyId !== rootKey.keyId) return null;
      const payload = Buffer.from(request.wrappedKey, 'base64');
      if (payload.byteLength !== 60) return null;
      try {
        const decipher = createDecipheriv('aes-256-gcm', rootKey.key, payload.subarray(0, 12));
        decipher.setAAD(cryptographyAad(request));
        decipher.setAuthTag(payload.subarray(12, 28));
        const plaintext = Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]);
        return plaintext.byteLength === 32 ? new Uint8Array(plaintext) : null;
      } catch {
        return null;
      }
    },
  });

  const verification: VerificationPort = Object.freeze({
    async verify(
      decision: Parameters<VerificationPort['verify']>[0],
      candidateDigest: Parameters<VerificationPort['verify']>[1],
    ) {
      if (decision.candidateDigest !== candidateDigest) return false;
      const rootKey = await key();
      const expected = signDecision(rootKey.key, decisionBody(decision));
      const actual = decision.decisionId;
      if (!actual.startsWith('local-hmac:sha256:')) return false;
      const actualDigest = Buffer.from(actual.slice('local-hmac:sha256:'.length), 'hex');
      const expectedDigest = Buffer.from(expected.slice('local-hmac:sha256:'.length), 'hex');
      return actualDigest.byteLength === expectedDigest.byteLength
        && timingSafeEqual(actualDigest, expectedDigest);
    },
  });

  const lifecyclePrincipalId = 'local-workroom-data-steward';
  const lifecycleAuthority: LifecycleAuthorities['authority'] = Object.freeze({
    async authorize(request: LifecycleAuthorizationRequest) {
      if (request.authenticatedPrincipalId !== lifecyclePrincipalId) {
        return Object.freeze({
          approved: false as const,
          requestDigest: request.digest,
          reason: 'local_root_principal_required',
        });
      }
      const rootKey = await key();
      const decidedAt = request.clock.now;
      const proof = lifecycleDecisionProof(request, decidedAt);
      const decisionId = signDecision(rootKey.key, proof);
      return Object.freeze({
        approved: true as const,
        requestDigest: request.digest,
        decisionId,
        principalId: request.authenticatedPrincipalId,
        role: request.requiredRole,
        authorityDigest: digestCanonicalWorkroomValue({
          kind: 'local-workroom-lifecycle-authority',
          requestDigest: request.digest,
          decisionId,
        }),
        decidedAt,
      });
    },
    async verify(request: LifecycleAuthorizationRequest, decision: LifecycleAuthorizationDecision) {
      if (decision.requestDigest !== request.digest
        || decision.principalId !== request.authenticatedPrincipalId
        || decision.role !== request.requiredRole
        || decision.decidedAt !== request.clock.now) return false;
      const rootKey = await key();
      const expectedDecisionId = signDecision(
        rootKey.key,
        lifecycleDecisionProof(request, decision.decidedAt),
      );
      return decision.decisionId === expectedDecisionId
        && decision.authorityDigest === digestCanonicalWorkroomValue({
          kind: 'local-workroom-lifecycle-authority',
          requestDigest: request.digest,
          decisionId: decision.decisionId,
        });
    },
  });
  const lifecycle: LifecycleAuthorities = Object.freeze({
    registrationPrincipalId: lifecyclePrincipalId,
    clock: Object.freeze({
      async read() {
        const body = Object.freeze({ version: 1 as const, now: now(), revision: 1 });
        return Object.freeze({ ...body, digest: digestCanonicalWorkroomValue(body) });
      },
    }),
    authority: lifecycleAuthority,
    subjects: Object.freeze({ resolve: async () => undefined }),
    deletion: Object.freeze({
      async purge(dispatch: LifecycleDeletionDispatch) {
        const body = Object.freeze({
          version: 1 as const,
          purgeId: dispatch.id,
          projectId: dispatch.governance.request.projectId,
          objectId: dispatch.governance.request.objectId,
          locationId: dispatch.location.id,
          locationAuthorityDigest: dispatch.location.authorityDigest,
          locationManifestDigest: dispatch.locationManifestDigest,
          attempt: dispatch.attempt,
          fence: dispatch.fence,
          requestDigest: dispatch.requestDigest,
          status: 'failed' as const,
          reasonCode: 'unsupported' as const,
          authenticatedBy: lifecyclePrincipalId,
          observedAt: Math.max(now(), dispatch.requestedAt),
          authorityDigest: digestCanonicalWorkroomValue({
            kind: 'local-workroom-lifecycle-deletion',
            purgeDigest: dispatch.digest,
          }),
        });
        return Object.freeze({ ...body, digest: digestCanonicalWorkroomValue(body) });
      },
    }),
    receipts: Object.freeze({
      async verify(receipt: LifecyclePurgeReceipt, dispatch: LifecycleDeletionDispatch) {
        const { digest, ...body } = receipt;
        return receipt.requestDigest === dispatch.requestDigest
          && receipt.locationId === dispatch.location.id
          && receipt.authorityDigest === digestCanonicalWorkroomValue({
            kind: 'local-workroom-lifecycle-deletion',
            purgeDigest: dispatch.digest,
          })
          && digest === digestCanonicalWorkroomValue(body);
      },
    }),
    orphanPurge: Object.freeze({
      async purge(request: LifecycleOrphanPurgeRequest) {
        return createLocalOrphanPurgeReceipt(request.digest, now());
      },
      async reconcile(
        request: LifecycleOrphanPurgeRequest,
        previous: LifecycleOrphanPurgeReceipt,
      ) {
        if (previous?.requestDigest === request.digest) return previous;
        return createLocalOrphanPurgeReceipt(request.digest, now());
      },
    }),
  });

  return Object.freeze({
    cryptography,
    verification,
    lifecycle,
    async issuePublicationDecision(
      input: Parameters<LocalWorkroomDataGovernanceAuthority['issuePublicationDecision']>[0],
      signal: Parameters<LocalWorkroomDataGovernanceAuthority['issuePublicationDecision']>[1],
    ) {
      signal.throwIfAborted();
      const rootKey = await key();
      const body = Object.freeze({
        projectId: input.projectId,
        ...(input.expectedPreviousDigest
          ? { expectedPreviousDigest: input.expectedPreviousDigest }
          : {}),
        candidateDigest: input.candidateDigest,
        principalId: input.principalId,
        authorizedBy: input.authorizedBy,
        decidedAt: now(),
        catalogRevision: input.catalogRevision,
        catalogBindingDigest: input.catalogBindingDigest,
      });
      return Object.freeze({
        decisionId: signDecision(rootKey.key, body),
        ...body,
      });
    },
  });
}

async function readOrCreateRootKey(
  path: string,
): Promise<Readonly<{ keyId: string; key: Buffer }>> {
  let document: LocalRootKeyDocument;
  try {
    document = parseRootKey(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error;
    const key = randomBytes(32);
    document = Object.freeze({
      version: 1,
      keyId: `local-file:sha256:${createHash('sha256').update(key).digest('hex')}`,
      key: key.toString('base64'),
    });
    try {
      const handle = await open(path, 'wx', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(document)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (createError) {
      if (!hasCode(createError, 'EEXIST')) throw createError;
      document = parseRootKey(JSON.parse(await readFile(path, 'utf8')));
    }
  }
  if (process.platform !== 'win32' && ((await stat(path)).mode & 0o077) !== 0) {
    throw new Error(`Workroom Data Governance Root key permissions must be 0600: ${path}`);
  }
  return Object.freeze({ keyId: document.keyId, key: Buffer.from(document.key, 'base64') });
}

function parseRootKey(value: unknown): LocalRootKeyDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Workroom Data Governance Root key document is invalid');
  }
  const input = value as Partial<LocalRootKeyDocument>;
  const key = typeof input.key === 'string' ? Buffer.from(input.key, 'base64') : Buffer.alloc(0);
  if (input.version !== 1 || typeof input.keyId !== 'string'
    || !/^local-file:sha256:[a-f\d]{64}$/u.test(input.keyId)
    || key.byteLength !== 32
    || input.keyId !== `local-file:sha256:${createHash('sha256').update(key).digest('hex')}`) {
    throw new Error('Workroom Data Governance Root key document is invalid');
  }
  return Object.freeze({ version: 1, keyId: input.keyId, key: input.key! });
}

function decisionBody(decision: GovernanceDecision) {
  return Object.freeze({
    projectId: decision.projectId,
    ...(decision.expectedPreviousDigest
      ? { expectedPreviousDigest: decision.expectedPreviousDigest }
      : {}),
    candidateDigest: decision.candidateDigest,
    principalId: decision.principalId,
    authorizedBy: decision.authorizedBy,
    decidedAt: decision.decidedAt,
    ...(decision.catalogRevision ? { catalogRevision: decision.catalogRevision } : {}),
    ...(decision.catalogBindingDigest
      ? { catalogBindingDigest: decision.catalogBindingDigest }
      : {}),
  });
}

function lifecycleDecisionProof(request: LifecycleAuthorizationRequest, decidedAt: number) {
  return Object.freeze({
    kind: 'local-workroom-lifecycle-decision',
    requestDigest: request.digest,
    principalId: request.authenticatedPrincipalId,
    role: request.requiredRole,
    decidedAt,
  });
}

function createLocalOrphanPurgeReceipt(requestDigest: string, observedAt: number) {
  const body = Object.freeze({
    version: 1 as const,
    requestDigest,
    providerId: 'local-workroom-orphan-purge',
    status: 'outcome_unknown' as const,
    observedAt,
  });
  return Object.freeze({ ...body, digest: digestCanonicalWorkroomValue(body) });
}

function signDecision(key: Buffer, body: object): string {
  const digest = createHmac('sha256', key)
    .update(JSON.stringify(body))
    .digest('hex');
  return `local-hmac:sha256:${digest}`;
}

function cryptographyAad(input: Readonly<{
  version: 1;
  generation: number;
  tenantId: string;
  projectId: string;
  objectId: string;
  descriptorDigest: string;
  aadDigest: string;
}>): Buffer {
  return Buffer.from(JSON.stringify({
    version: input.version,
    generation: input.generation,
    tenantId: input.tenantId,
    projectId: input.projectId,
    objectId: input.objectId,
    descriptorDigest: input.descriptorDigest,
    aadDigest: input.aadDigest,
  }), 'utf8');
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === code);
}
