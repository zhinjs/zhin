import { createHash } from 'node:crypto';
import type { MaterializedDisclosureManifest } from '../../src/data-governance/disclosure-manifest.js';
import type {
  GovernedDisclosureManifestRequest,
} from '../../src/plugin-runtime/workroom-data-governance-runtime.js';
import type {
  WorkroomProjectionGovernancePort,
  WorkroomProjectionOutboxItem,
} from '../../src/workroom/projection-outbox.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

/** Explicit test authority. Production has no plaintext/in-memory fallback. */
export function createTestProjectionGovernance(): WorkroomProjectionGovernancePort & Readonly<{
  body(item: WorkroomProjectionOutboxItem): string;
}> {
  const bodies = new Map<string, Uint8Array>();
  const port: WorkroomProjectionGovernancePort = {
    async prepareProjection(input) {
      const bytes = new TextEncoder().encode(input.body);
      const payloadHash = hash(bytes);
      const request: GovernedDisclosureManifestRequest = Object.freeze({
        operationId: input.operationId,
        projectId: input.projectId,
        sourceRef: `projection-source:${payloadHash}`,
        sourceDigest: payloadHash,
        sinkRuleId: input.sinkRuleId,
        principalId: 'principal:projection-service',
      });
      const handle = Object.freeze({
        version: 1 as const,
        vaultObjectId: `vault:${payloadHash}`,
        objectId: request.sourceRef,
        payloadHash,
        descriptorDigest: digest({ sourceEventIds: input.sourceEventIds, payloadHash }),
        tenantId: 'tenant:test',
        projectId: input.projectId,
        locationManifestDigest: digest({ vaultObjectId: `vault:${payloadHash}` }),
      });
      const projection = Object.freeze({
        version: 1 as const,
        requestDigest: digest(request),
        source: {
          objectId: handle.objectId,
          payloadHash,
          descriptorDigest: handle.descriptorDigest,
          lineageDigest: digest({ sourceObjectIds: input.sourceEventIds }),
          handle,
        },
        output: { handle, payloadHash, mode: 'full' as const, subjectLinked: false },
        channel: 'workroom_projection' as const,
        purpose: 'workroom_awareness' as const,
        principal: { principalId: request.principalId },
        destination: {
          id: 'destination:test-projection', contractDigest: digest({ destination: 'test-projection' }),
          recipientRevision: 1, recipientDigest: digest({ recipients: ['test-room'] }),
          loggingMode: 'metadata_only' as const, allowsRedisclosure: false, supportsDeletion: true,
        },
        policy: { revision: 1, digest: digest({ policy: 'test-projection' }) },
        approvalIds: Object.freeze([]),
        expiresAt: Number.MAX_SAFE_INTEGER,
      });
      const manifestDigest = digest(projection);
      const manifest: MaterializedDisclosureManifest = Object.freeze({
        ...projection,
        id: `disclosure-manifest:${manifestDigest}`,
        digest: manifestDigest,
      });
      bodies.set(manifest.digest, bytes);
      return Object.freeze({ status: 'ready' as const, request, manifest });
    },
    async revalidate(input) {
      const body = bodies.get(input.manifest.digest);
      if (!body) return Object.freeze({ status: 'blocked' as const, reason: 'disclosure_manifest_stale' as const });
      return Object.freeze({ status: 'ready' as const, manifest: input.manifest, body: new Uint8Array(body) });
    },
  };
  return Object.freeze({
    ...port,
    body(item: WorkroomProjectionOutboxItem) {
      const body = bodies.get(item.disclosure.manifest.digest);
      if (!body) throw new Error('Test Projection body is unavailable');
      return new TextDecoder().decode(body);
    },
  });
}

function hash(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
