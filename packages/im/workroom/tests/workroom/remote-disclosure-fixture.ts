import type { GovernedDisclosureManifestSnapshot } from '../../src/data-governance/disclosure-manifest.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

export function remoteDisclosureFixture(input: Readonly<{
  projectId?: string;
  assignmentId?: string;
  endpointId?: string;
  principalId?: string;
  sourceRef?: string;
  sourceDigest?: string;
}> = {}): GovernedDisclosureManifestSnapshot {
  const projectId = input.projectId ?? 'project-1';
  const assignmentId = input.assignmentId ?? 'assignment-1';
  const endpointId = input.endpointId ?? 'remote-1';
  const principalId = input.principalId ?? 'agent:remote-1';
  const sourceRef = input.sourceRef ?? 'context:1';
  const sourceDigest = input.sourceDigest ?? `sha256:${'b'.repeat(64)}`;
  const request = {
    operationId: `remote-disclosure:${assignmentId}`,
    projectId,
    sourceRef,
    sourceDigest,
    sinkRuleId: `remote:${endpointId}`,
    principalId,
    assignmentId,
  };
  const handle = {
    version: 1 as const,
    vaultObjectId: `vault:${assignmentId}`,
    objectId: sourceRef,
    payloadHash: sourceDigest,
    descriptorDigest: digest({ sourceRef, sourceDigest, projectId }),
    tenantId: 'tenant:test',
    projectId,
    locationManifestDigest: digest({ location: assignmentId }),
  };
  const projection = {
    version: 1 as const,
    requestDigest: digest(request),
    source: {
      objectId: sourceRef,
      payloadHash: sourceDigest,
      descriptorDigest: handle.descriptorDigest,
      lineageDigest: digest({ sourceObjectIds: [sourceRef] }),
      handle,
    },
    output: { handle, payloadHash: sourceDigest, mode: 'full' as const, subjectLinked: false },
    channel: 'a2a' as const,
    purpose: 'remote_execution' as const,
    principal: { principalId, assignmentId },
    destination: {
      id: endpointId,
      contractDigest: digest({ endpointId }),
      recipientRevision: 1,
      recipientDigest: digest({ recipients: [endpointId] }),
      loggingMode: 'metadata_only' as const,
      allowsRedisclosure: false,
      supportsDeletion: true,
    },
    policy: { revision: 1, digest: digest({ policy: projectId }) },
    approvalIds: Object.freeze([]),
    expiresAt: Number.MAX_SAFE_INTEGER,
  };
  const manifestDigest = digest(projection);
  return Object.freeze({
    request: Object.freeze(request),
    manifest: Object.freeze({
      ...projection,
      id: `disclosure-manifest:${manifestDigest}`,
      digest: manifestDigest,
    }),
  });
}
