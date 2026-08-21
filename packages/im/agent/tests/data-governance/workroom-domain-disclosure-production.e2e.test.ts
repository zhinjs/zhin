import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyDataDescriptor,
  createDataCategoryRegistrySnapshot,
  createDataGovernancePolicySnapshot,
  createDisclosureRecipientSetSnapshot,
  createProcessingDestinationContract,
  decideDisclosure,
  type DataDescriptor,
  type DisclosureApprovalSnapshot,
  type DisclosureChannel,
  type DisclosureContext,
  type DisclosurePurpose,
} from '../../src/data-governance/data-governance.js';
import { materializeDisclosureManifest } from '../../src/data-governance/disclosure-manifest.js';
import {
  EncryptedFilePayloadVault,
  type PayloadVaultCryptographyPort,
} from '../../src/data-governance/encrypted-file-payload-vault.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

describe('customer-support and investment governed disclosure production seams', () => {
  it.each([
    ['customer-support', 'pii', 'pii_masked', 'Customer Ada account 314159 needs refund', 'Customer **** needs refund'],
    ['investment-research', 'market_sensitive', 'market_summary', 'Unpublished issuer target 271828 BUY', 'Issuer **** review pending'],
  ] as const)('routes %s through model, IM projection, Console and A2A without raw-body authority', async (
    domain, sourceCategory, maskedCategory, rawText, maskedText,
  ) => {
    const root = await mkdtemp(join(tmpdir(), `domain-disclosure-${randomUUID()}-`));
    roots.push(root);
    const vault = new EncryptedFilePayloadVault({
      directory: join(root, 'vault'), generation: 4,
      cryptography: testCryptography(new Uint8Array(32).fill(17), 'kms:domain:key-17'),
    });
    const body = new TextEncoder().encode(rawText);
    const registry = categoryRegistry(sourceCategory, maskedCategory);
    const descriptor = classifiedDescriptor(domain, sourceCategory, body, registry);
    const source = await vault.putSource({
      descriptor, descriptorDigest: digest(descriptor), payload: body,
      sourceBindingDigest: sha(`${domain}:source-binding`),
    }, signal());
    const fixture = policyFixture(domain, sourceCategory, maskedCategory);
    const transforms = {
      transform: async () => {
        const output = new TextEncoder().encode(maskedText);
        return {
          transformId: `transform:${domain}:mask`, inputHash: descriptor.payloadHash,
          outputHash: hashBytes(output), output, outputConfidentiality: 'project_internal' as const,
          outputCategories: [maskedCategory], subjectLinked: true,
        };
      },
    };

    const manifests = [];
    for (const [channel, purpose] of [
      ['workroom_projection', 'workroom_awareness'],
      ['console', 'portfolio_oversight'],
    ] as const) {
      manifests.push(await materializeDisclosureManifest({
        decisionInput: decisionInput(descriptor, fixture, channel, purpose, []),
        categoryRegistry: registry, source, vault, transforms, signal: signal(),
      }));
    }
    for (const [channel, purpose] of [
      ['model_provider', 'orchestration'],
      ['a2a', 'remote_execution'],
    ] as const) {
      const pending = decideDisclosure(decisionInput(descriptor, fixture, channel, purpose, []));
      expect(pending.disposition).toBe('transform_required');
      let transformedRequestDigest = '';
      try {
        await materializeDisclosureManifest({
          decisionInput: decisionInput(descriptor, fixture, channel, purpose, []),
          categoryRegistry: registry, source, vault, transforms, signal: signal(),
        });
      } catch (error) {
        transformedRequestDigest = error instanceof Error ? error.message.split(': ').at(-1) ?? '' : '';
      }
      expect(transformedRequestDigest).toMatch(/^sha256:[a-f\d]{64}$/u);
      const approval: DisclosureApprovalSnapshot = {
        id: `approval:${domain}:${channel}`, requestDigest: transformedRequestDigest,
        role: 'compliance', principalId: 'principal:compliance', policyRevision: fixture.policy.revision,
        decision: 'approved', expiresAt: 900,
      };
      manifests.push(await materializeDisclosureManifest({
        decisionInput: decisionInput(descriptor, fixture, channel, purpose, [approval]),
        categoryRegistry: registry, source, vault, transforms, signal: signal(),
      }));
    }

    expect(manifests.map(manifest => manifest.channel).sort()).toEqual([
      'a2a', 'console', 'model_provider', 'workroom_projection',
    ]);
    for (const manifest of manifests) {
      expect(manifest.output).toMatchObject({ mode: 'transformed', subjectLinked: true });
      expect(JSON.stringify(manifest)).not.toContain(rawText);
      const disclosed = await vault.readExact({
        handle: manifest.output.handle, requestDigest: manifest.requestDigest,
        purpose: manifest.purpose, principalId: manifest.principal.principalId,
        destinationId: manifest.destination.id,
      }, signal());
      expect(new TextDecoder().decode(disclosed)).toBe(maskedText);
    }

    const persisted = await persistedText(join(root, 'vault'));
    expect(persisted).not.toContain(rawText);
    expect(persisted).not.toContain(maskedText);
    const revokedPolicy = createDataGovernancePolicySnapshot({
      ...fixture.policy, revision: fixture.policy.revision + 1,
    });
    const revoked = decideDisclosure({
      ...decisionInput(descriptor, { ...fixture, policy: revokedPolicy }, 'a2a', 'remote_execution', []),
      context: {
        ...decisionInput(descriptor, fixture, 'a2a', 'remote_execution', []).context,
        policyRevision: fixture.policy.revision,
      },
    });
    expect(revoked).toMatchObject({ disposition: 'deny', reasonCodes: ['policy_revision_mismatch'] });
  });

  it('quarantines unknown classification and hard-denies credential, recipient, region and training drift', () => {
    const registry = categoryRegistry('pii', 'pii_masked');
    expect(classifyDataDescriptor({
      ...descriptorCandidate('quarantine', 'unknown_category', new TextEncoder().encode('unknown')),
      proposedConfidentiality: 'unknown',
    }, registry)).toMatchObject({ status: 'quarantined' });

    const body = new TextEncoder().encode('API credential sk-live-secret');
    const credentialRegistry = categoryRegistry('credential', 'pii_masked');
    const descriptor = classifiedDescriptor('credential-case', 'credential', body, credentialRegistry);
    const fixture = policyFixture('credential-case', 'credential', 'pii_masked');
    const unsafeDestination = createProcessingDestinationContract({
      ...fixture.destinations.a2a,
      processingRegions: ['us-east-1'], noTraining: false,
    });
    const unsafePolicy = createDataGovernancePolicySnapshot({
      ...fixture.policy, destinations: {
        ...fixture.policy.destinations, [unsafeDestination.id]: unsafeDestination,
      },
    });
    const base = decisionInput(descriptor, {
      ...fixture, policy: unsafePolicy,
      destinations: { ...fixture.destinations, a2a: unsafeDestination },
    }, 'a2a', 'remote_execution', []);
    const wrongRecipients = createDisclosureRecipientSetSnapshot({
      revision: 1,
      recipients: [{ principalId: 'principal:cross-tenant', tenantId: 'tenant-2',
        projectId: 'project-other', clearance: 'restricted' }],
    });
    const denied = decideDisclosure({
      ...base,
      context: { ...base.context, recipients: wrongRecipients },
    });
    expect(denied.disposition).toBe('deny');
    expect(denied.reasonCodes).toEqual(expect.arrayContaining([
      'credential_requires_secret_capability_port', 'residency_violation',
      'external_training_not_prohibited', 'recipient_snapshot_mismatch',
      'recipient_tenant_mismatch', 'recipient_project_mismatch',
    ]));
  });
});

function categoryRegistry(sourceCategory: string, maskedCategory: string) {
  return createDataCategoryRegistrySnapshot({
    id: 'registry:tenant-1', revision: 1, tenantId: 'tenant-1',
    kindFloors: { source_message: 'project_internal', projection_payload: 'project_internal' },
    categories: {
      [sourceCategory]: { confidentialityFloor: sourceCategory === 'credential' ? 'restricted' : 'confidential' },
      [maskedCategory]: { confidentialityFloor: 'project_internal' },
    },
  });
}

function classifiedDescriptor(
  domain: string,
  category: string,
  body: Uint8Array,
  registry: ReturnType<typeof categoryRegistry>,
): DataDescriptor {
  const classified = classifyDataDescriptor(descriptorCandidate(domain, category, body), registry);
  if (classified.status !== 'registered') {
    throw new Error(`domain fixture was quarantined: ${classified.reasonCodes.join(',')}`);
  }
  return classified.descriptor;
}

function descriptorCandidate(domain: string, category: string, body: Uint8Array) {
  return {
    objectId: `source:${domain}`, payloadHash: hashBytes(body), tenantId: 'tenant-1', projectId: `project:${domain}`,
    kind: 'source_message' as const, proposedConfidentiality: 'confidential' as const,
    categories: [category],
    allowedPurposes: ['orchestration', 'workroom_awareness', 'portfolio_oversight', 'remote_execution'] as const,
    allowedRegions: ['ap-southeast-1'], subjectRefs: [`subject:${domain}:client`],
    retention: { class: 'regulated_record' as const, minimumRetainUntil: 100, deleteAfter: 1_000 },
    lineage: { sourceObjectIds: [`conversation:${domain}:1`] },
  };
}

function policyFixture(domain: string, sourceCategory: string, maskedCategory: string) {
  const projectId = `project:${domain}`;
  const channels: readonly DisclosureChannel[] = ['model_provider', 'workroom_projection', 'console', 'a2a'];
  const createSink = (channel: DisclosureChannel) => {
    const recipients = createDisclosureRecipientSetSnapshot({
      revision: 1,
      recipients: [{ principalId: `recipient:${domain}:${channel}`, tenantId: 'tenant-1',
        projectId, clearance: 'project_internal' }],
    });
    const destination = createProcessingDestinationContract({
      id: `destination:${domain}:${channel}`, owner: `owner:${channel}`, endpoint: `${channel}://sink`,
      tenantId: 'tenant-1', projectId, trustDomain: `trust:${channel}`,
      processingRegions: ['ap-southeast-1'], maxConfidentiality: 'project_internal',
      allowedCategories: [maskedCategory], external: channel === 'model_provider' || channel === 'a2a',
      noTraining: true, loggingMode: 'metadata_only', maximumRetentionSeconds: 60,
      allowsRedisclosure: false, supportsDeletion: true,
      recipientSnapshotRevision: recipients.revision, recipientSnapshotDigest: recipients.digest,
    });
    return { destination, recipients };
  };
  const destinations = {
    model_provider: createSink('model_provider'),
    workroom_projection: createSink('workroom_projection'),
    console: createSink('console'),
    a2a: createSink('a2a'),
  };
  const policy = createDataGovernancePolicySnapshot({
    id: `policy:${domain}`, revision: 3, tenantId: 'tenant-1', projectId,
    destinations: Object.fromEntries(Object.values(destinations)
      .map(({ destination }) => [destination.id, destination])),
    channelCeilings: {
      context_view: 'project_internal', evidence_port: 'project_internal',
      workroom_projection: 'project_internal', sponsor_projection: 'project_internal',
      console: 'project_internal', model_provider: 'project_internal', a2a: 'project_internal',
    },
    transforms: {
      [`transform:${domain}:mask`]: {
        id: `transform:${domain}:mask`, inputCategoriesAny: [sourceCategory],
        outputConfidentiality: 'project_internal', outputCategories: [maskedCategory],
        allowedChannels: channels,
      },
    },
    externalApprovalFloor: 'project_internal',
  });
  return {
    policy,
    destinations: {
      model_provider: destinations.model_provider.destination,
      workroom_projection: destinations.workroom_projection.destination,
      console: destinations.console.destination,
      a2a: destinations.a2a.destination,
    },
    recipients: {
      model_provider: destinations.model_provider.recipients,
      workroom_projection: destinations.workroom_projection.recipients,
      console: destinations.console.recipients,
      a2a: destinations.a2a.recipients,
    },
  };
}

function decisionInput(
  descriptor: DataDescriptor,
  fixture: ReturnType<typeof policyFixture>,
  channel: 'model_provider' | 'workroom_projection' | 'console' | 'a2a',
  purpose: DisclosurePurpose,
  approvals: readonly DisclosureApprovalSnapshot[],
) {
  const context: DisclosureContext = {
    channel, purpose, requestedMode: 'full', policyRevision: fixture.policy.revision,
    principal: { principalId: `principal:${channel}`, tenantId: descriptor.tenantId,
      projectId: descriptor.projectId, role: channel === 'workroom_projection' ? 'projector' : 'orchestrator',
      clearance: 'project_internal', allowedPurposes: [purpose] },
    destination: fixture.destinations[channel], recipients: fixture.recipients[channel],
  };
  return { descriptor, policy: fixture.policy, context, approvals, evaluatedAt: 200 };
}

async function persistedText(root: string): Promise<string> {
  const chunks: string[] = [];
  for (const directory of ['objects', 'audit']) {
    for (const name of await readdir(join(root, directory))) {
      chunks.push(await readFile(join(root, directory, name), 'utf8'));
    }
  }
  return chunks.join('\n');
}

function testCryptography(secret: Uint8Array, keyId: string): PayloadVaultCryptographyPort {
  return {
    wrap: async ({ dataKey }) => ({ keyId,
      wrappedKey: Buffer.from(dataKey.map((value, index) => value ^ secret[index % secret.length]!)).toString('base64') }),
    unwrap: async ({ keyId: actual, wrappedKey }) => actual === keyId
      ? new Uint8Array(Buffer.from(wrappedKey, 'base64').map((value, index) => value ^ secret[index % secret.length]!))
      : null,
  };
}

function hashBytes(value: Uint8Array): string { return `sha256:${createHash('sha256').update(value).digest('hex')}`; }
function sha(seed: string): string { return digest({ seed }); }
function signal(): AbortSignal { return new AbortController().signal; }
