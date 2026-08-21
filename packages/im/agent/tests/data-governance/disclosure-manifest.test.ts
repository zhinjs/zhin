import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createDataGovernancePolicySnapshot,
  createDataCategoryRegistrySnapshot,
  createDisclosureRecipientSetSnapshot,
  createProcessingDestinationContract,
  decideDisclosure,
  type DataDescriptor,
  type DataCategoryRegistrySnapshot,
  type DataGovernancePolicySnapshot,
  type DisclosureContext,
  type DisclosureDecisionInput,
} from '../../src/data-governance/data-governance.js';
import {
  materializeDisclosureManifest,
  type PayloadVaultObjectHandle,
  type PayloadVaultPort,
  type TrustedDisclosureTransformPort,
} from '../../src/data-governance/disclosure-manifest.js';
import { digestCanonicalWorkroomValue } from '../../src/workroom/canonical-value.js';

describe('materialized Disclosure Manifest', () => {
  it('binds an immutable full payload handle to the exact current disclosure decision', async () => {
    const body = new TextEncoder().encode('accepted customer result');
    const fixture = disclosureFixture(body, 'console');
    const vault = vaultFixture(body, fixture.source);

    const result = await materializeDisclosureManifest({
      decisionInput: fixture.decisionInput,
      categoryRegistry: fixture.categoryRegistry,
      source: fixture.source,
      vault,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      version: 1,
      source: { objectId: 'object:source-1', payloadHash: sha(body) },
      output: { handle: fixture.source, payloadHash: sha(body), mode: 'full' },
      channel: 'console',
      purpose: 'task_execution',
      principal: { principalId: 'principal:executor-1', assignmentId: 'assignment:1' },
      destination: {
        id: 'destination:console',
        allowsRedisclosure: false,
        supportsDeletion: true,
        loggingMode: 'metadata_only',
      },
      policy: { revision: 7, digest: fixture.decisionInput.policy.digest },
      expiresAt: 160,
    });
    expect(result.id).toMatch(/^disclosure-manifest:sha256:[a-f0-9]{64}$/u);
    expect(result.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(result)).not.toContain('accepted customer result');
    expect(Object.isFrozen(result)).toBe(true);
    expect(vault.readExact).toHaveBeenCalledOnce();
    expect(vault.putDerived).not.toHaveBeenCalled();
  });

  it('materializes metadata-only output without reading the governed source body', async () => {
    const body = new TextEncoder().encode('secret body must not be read');
    const fixture = disclosureFixture(body, 'console', 'metadata_only');
    const vault = vaultFixture(body, fixture.source);

    const result = await materializeDisclosureManifest({
      decisionInput: fixture.decisionInput,
      categoryRegistry: fixture.categoryRegistry,
      source: fixture.source,
      vault,
      signal: new AbortController().signal,
    });

    expect(result.output.mode).toBe('metadata_only');
    expect(result.output.handle.vaultObjectId).toBe('vault:derived-1');
    expect(vault.readExact).not.toHaveBeenCalled();
    expect(vault.putDerived).toHaveBeenCalledOnce();
    const put = vi.mocked(vault.putDerived).mock.calls[0]![0];
    expect(new TextDecoder().decode(put.payload)).not.toContain('secret body must not be read');
    expect(put.lineage.sourceObjectIds).toEqual(['object:source-1']);
  });

  it('requires the exact trusted transform and rejects non-materializable decisions before Vault I/O', async () => {
    const body = new TextEncoder().encode('customer account 1234');
    const fixture = disclosureFixture(body, 'a2a', 'full', { transform: true });
    const vault = vaultFixture(body, fixture.source);
    const transformed = new TextEncoder().encode('customer account ****');
    const transforms: TrustedDisclosureTransformPort = {
      transform: vi.fn(async () => ({
        transformId: 'transform:redact-account',
        inputHash: sha(body),
        outputHash: sha(transformed),
        output: transformed,
        outputConfidentiality: 'project_internal',
        outputCategories: ['customer_content_redacted'],
        subjectLinked: true,
      })),
    };

    const result = await materializeDisclosureManifest({
      decisionInput: fixture.decisionInput,
      categoryRegistry: fixture.categoryRegistry,
      source: fixture.source,
      vault,
      transforms,
      signal: new AbortController().signal,
    });
    expect(result.output).toMatchObject({
      mode: 'transformed',
      payloadHash: sha(transformed),
      transformId: 'transform:redact-account',
      subjectLinked: true,
    });
    expect(result.output.handle.objectId).toContain(sha(transformed).slice('sha256:'.length));

    const denied = disclosureFixture(body, 'a2a', 'full', { wrongTenant: true });
    await expect(materializeDisclosureManifest({
      decisionInput: denied.decisionInput,
      categoryRegistry: denied.categoryRegistry,
      source: denied.source,
      vault,
      transforms,
      signal: new AbortController().signal,
    })).rejects.toThrow('not materializable');
  });

  it('requires Compliance approval bound to the exact transformed output hash', async () => {
    const body = new TextEncoder().encode('regulated account 1234');
    const transformed = new TextEncoder().encode('regulated account ****');
    const fixture = disclosureFixture(body, 'a2a', 'full', {
      transform: true,
      transformApproval: true,
    });
    const transforms: TrustedDisclosureTransformPort = {
      transform: vi.fn(async () => ({
        transformId: 'transform:redact-account',
        inputHash: sha(body),
        outputHash: sha(transformed),
        output: transformed,
        outputConfidentiality: 'project_internal',
        outputCategories: ['customer_content_redacted'],
        subjectLinked: true,
      })),
    };
    const firstVault = vaultFixture(body, fixture.source);
    let approvalRequestDigest = '';
    try {
      await materializeDisclosureManifest({
        decisionInput: fixture.decisionInput,
        categoryRegistry: fixture.categoryRegistry,
        source: fixture.source,
        vault: firstVault,
        transforms,
        signal: new AbortController().signal,
      });
    } catch (error) {
      approvalRequestDigest = String((error as Error).message).split(': ').at(-1) ?? '';
    }
    expect(approvalRequestDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(firstVault.putDerived).not.toHaveBeenCalled();

    const result = await materializeDisclosureManifest({
      decisionInput: {
        ...fixture.decisionInput,
        approvals: [{
          id: 'approval:transformed-output',
          requestDigest: approvalRequestDigest,
          role: 'compliance',
          principalId: 'principal:compliance-1',
          policyRevision: fixture.decisionInput.policy.revision,
          decision: 'approved',
          expiresAt: 140,
        }],
      },
      categoryRegistry: fixture.categoryRegistry,
      source: fixture.source,
      vault: vaultFixture(body, fixture.source),
      transforms,
      signal: new AbortController().signal,
    });
    expect(result.requestDigest).toBe(approvalRequestDigest);
    expect(result.approvalIds).toEqual(['approval:transformed-output']);
    expect(result.output.payloadHash).toBe(sha(transformed));
    expect(result.expiresAt).toBe(140);
  });

  it('persists only the exact non-expired approval ids used by the decision', async () => {
    const body = new TextEncoder().encode('restricted external report');
    const fixture = disclosureFixture(body, 'a2a', 'full', { restricted: true });
    const first = decideDisclosure(fixture.decisionInput);
    expect(first.disposition).toBe('approval_required');
    const approvedInput: DisclosureDecisionInput = {
      ...fixture.decisionInput,
      approvals: [{
        id: 'approval:compliance-1', requestDigest: first.requestDigest,
        role: 'compliance', principalId: 'principal:compliance-1', policyRevision: 7,
        decision: 'approved', expiresAt: 130,
      }],
    };
    const result = await materializeDisclosureManifest({
      decisionInput: approvedInput,
      categoryRegistry: fixture.categoryRegistry,
      source: fixture.source,
      vault: vaultFixture(body, fixture.source),
      signal: new AbortController().signal,
    });

    expect(result.approvalIds).toEqual(['approval:compliance-1']);
    expect(result.expiresAt).toBe(130);
  });

  it('snapshots policy, destination and source authority before awaiting Vault I/O', async () => {
    const body = new TextEncoder().encode('stable body');
    const fixture = disclosureFixture(body, 'console');
    let releaseRead!: (value: Uint8Array) => void;
    const vault = vaultFixture(body, fixture.source);
    vault.readExact = vi.fn(() => new Promise((resolve) => { releaseRead = resolve; }));

    const pending = materializeDisclosureManifest({
      decisionInput: fixture.decisionInput,
      categoryRegistry: fixture.categoryRegistry,
      source: fixture.source,
      vault,
      signal: new AbortController().signal,
    });
    (fixture.source as { objectId: string }).objectId = 'object:mutated';
    (fixture.decisionInput.context.destination as { loggingMode: string }).loggingMode = 'full';
    releaseRead(body);

    const result = await pending;
    expect(result.source.objectId).toBe('object:source-1');
    expect(result.destination.loggingMode).toBe('metadata_only');
  });

  it('rejects destination or policy content drift under a retained digest before Vault I/O', async () => {
    const body = new TextEncoder().encode('stable governed body');
    const destinationDrift = disclosureFixture(body, 'console');
    (destinationDrift.decisionInput.context.destination as { loggingMode: string }).loggingMode = 'full';
    const destinationVault = vaultFixture(body, destinationDrift.source);
    await expect(materializeDisclosureManifest({
      decisionInput: destinationDrift.decisionInput,
      categoryRegistry: destinationDrift.categoryRegistry,
      source: destinationDrift.source,
      vault: destinationVault,
      signal: new AbortController().signal,
    })).rejects.toThrow('contract digest does not match');
    expect(destinationVault.readExact).not.toHaveBeenCalled();

    const policyDrift = disclosureFixture(body, 'console');
    (policyDrift.decisionInput.policy.channelCeilings as { console: string }).console = 'restricted';
    const policyVault = vaultFixture(body, policyDrift.source);
    await expect(materializeDisclosureManifest({
      decisionInput: policyDrift.decisionInput,
      categoryRegistry: policyDrift.categoryRegistry,
      source: policyDrift.source,
      vault: policyVault,
      signal: new AbortController().signal,
    })).rejects.toThrow('Policy digest does not match');
    expect(policyVault.readExact).not.toHaveBeenCalled();

    const recipientDrift = disclosureFixture(body, 'console');
    (recipientDrift.decisionInput.context.recipients.recipients[0] as { clearance: string }).clearance = 'public';
    const recipientVault = vaultFixture(body, recipientDrift.source);
    await expect(materializeDisclosureManifest({
      decisionInput: recipientDrift.decisionInput,
      categoryRegistry: recipientDrift.categoryRegistry,
      source: recipientDrift.source,
      vault: recipientVault,
      signal: new AbortController().signal,
    })).rejects.toThrow('recipient snapshot digest does not match');
    expect(recipientVault.readExact).not.toHaveBeenCalled();

    const descriptorDrift = disclosureFixture(body, 'console');
    (descriptorDrift.decisionInput.descriptor as { confidentiality: string }).confidentiality = 'public';
    const descriptorVault = vaultFixture(body, descriptorDrift.source);
    await expect(materializeDisclosureManifest({
      decisionInput: descriptorDrift.decisionInput,
      categoryRegistry: descriptorDrift.categoryRegistry,
      source: descriptorDrift.source,
      vault: descriptorVault,
      signal: new AbortController().signal,
    })).rejects.toThrow('below its trusted floor');
    expect(descriptorVault.readExact).not.toHaveBeenCalled();

    const invalidDescriptor = disclosureFixture(body, 'console');
    (invalidDescriptor.decisionInput.descriptor as { confidentiality: string }).confidentiality = 'invalid';
    await expect(materializeDisclosureManifest({
      decisionInput: invalidDescriptor.decisionInput,
      categoryRegistry: invalidDescriptor.categoryRegistry,
      source: invalidDescriptor.source,
      vault: vaultFixture(body, invalidDescriptor.source),
      signal: new AbortController().signal,
    })).rejects.toThrow('malformed or non-canonical');

    const registryDrift = disclosureFixture(body, 'console');
    const forgedRegistry = structuredClone(registryDrift.categoryRegistry);
    forgedRegistry.categories.customer_content!.confidentialityFloor = 'public';
    await expect(materializeDisclosureManifest({
      decisionInput: registryDrift.decisionInput,
      categoryRegistry: forgedRegistry,
      source: registryDrift.source,
      vault: vaultFixture(body, registryDrift.source),
      signal: new AbortController().signal,
    })).rejects.toThrow('Registry digest does not match');

    const exactDescriptorDrift = disclosureFixture(body, 'console');
    (exactDescriptorDrift.decisionInput.descriptor as { subjectRefs: string[] }).subjectRefs = [];
    await expect(materializeDisclosureManifest({
      decisionInput: exactDescriptorDrift.decisionInput,
      categoryRegistry: exactDescriptorDrift.categoryRegistry,
      source: exactDescriptorDrift.source,
      vault: vaultFixture(body, exactDescriptorDrift.source),
      signal: new AbortController().signal,
    })).rejects.toThrow('source handle does not match the Data Descriptor');
  });

  it('rejects invalid runtime Destination and transform policy values at canonical constructors', () => {
    const fixture = disclosureFixture(new TextEncoder().encode('body'), 'console');
    const { contractDigest: _digest, ...destination } = fixture.decisionInput.context.destination;
    expect(() => createProcessingDestinationContract({
      ...destination,
      loggingMode: 'secret_body_log' as 'disabled',
    })).toThrow('policy fields are invalid');
    expect(() => createDataGovernancePolicySnapshot({
      ...fixture.decisionInput.policy,
      transforms: {
        invalid: {
          id: 'invalid',
          inputCategoriesAny: ['customer_content'],
          outputConfidentiality: 'public',
          outputCategories: ['public_content'],
          allowedChannels: ['untrusted_sink' as 'console'],
        },
      },
    })).toThrow('Invalid trusted disclosure transform');
  });

  it('rejects transformed output categories absent from the pinned Category Registry', async () => {
    const body = new TextEncoder().encode('customer account 1234');
    const transformed = new TextEncoder().encode('customer account ****');
    const fixture = disclosureFixture(body, 'a2a', 'full', { transform: true });
    const categoryRegistry = createDataCategoryRegistrySnapshot({
      id: fixture.categoryRegistry.id,
      revision: fixture.categoryRegistry.revision,
      tenantId: fixture.categoryRegistry.tenantId,
      kindFloors: fixture.categoryRegistry.kindFloors,
      categories: { customer_content: { confidentialityFloor: 'confidential' } },
    });
    const decisionInput = structuredClone(fixture.decisionInput);
    (decisionInput.descriptor.classificationSource as { categoryRegistryDigest: string })
      .categoryRegistryDigest = categoryRegistry.digest;
    const source = {
      ...fixture.source,
      descriptorDigest: digestCanonicalWorkroomValue(decisionInput.descriptor),
    };
    const vault = vaultFixture(body, source);

    await expect(materializeDisclosureManifest({
      decisionInput,
      categoryRegistry,
      source,
      vault,
      transforms: {
        transform: async () => ({
          transformId: 'transform:redact-account',
          inputHash: sha(body),
          outputHash: sha(transformed),
          output: transformed,
          outputConfidentiality: 'project_internal',
          outputCategories: ['customer_content_redacted'],
          subjectLinked: true,
        }),
      },
      signal: new AbortController().signal,
    })).rejects.toThrow('unknown trusted floor');
    expect(vault.putDerived).not.toHaveBeenCalled();
  });

  it('does not persist metadata-only output when its derived kind lacks a registry floor', async () => {
    const body = new TextEncoder().encode('governed body');
    const fixture = disclosureFixture(body, 'console', 'metadata_only');
    const categoryRegistry = createDataCategoryRegistrySnapshot({
      id: fixture.categoryRegistry.id,
      revision: fixture.categoryRegistry.revision,
      tenantId: fixture.categoryRegistry.tenantId,
      kindFloors: { task_report: 'project_internal' },
      categories: fixture.categoryRegistry.categories,
    });
    const decisionInput = structuredClone(fixture.decisionInput);
    (decisionInput.descriptor.classificationSource as { categoryRegistryDigest: string })
      .categoryRegistryDigest = categoryRegistry.digest;
    const source = {
      ...fixture.source,
      descriptorDigest: digestCanonicalWorkroomValue(decisionInput.descriptor),
    };
    const vault = vaultFixture(body, source);

    await expect(materializeDisclosureManifest({
      decisionInput,
      categoryRegistry,
      source,
      vault,
      signal: new AbortController().signal,
    })).rejects.toThrow('unknown trusted floor');
    expect(vault.putDerived).not.toHaveBeenCalled();
  });

  it('rejects non-deterministic or unsafe disclosure evaluation time before Vault I/O', async () => {
    const body = new TextEncoder().encode('body');
    const fixture = disclosureFixture(body, 'console');
    const vault = vaultFixture(body, fixture.source);
    await expect(materializeDisclosureManifest({
      decisionInput: { ...fixture.decisionInput, evaluatedAt: Number.NaN },
      categoryRegistry: fixture.categoryRegistry,
      source: fixture.source,
      vault,
      signal: new AbortController().signal,
    })).rejects.toThrow('Invalid disclosure evaluatedAt');
    expect(vault.readExact).not.toHaveBeenCalled();
    expect(vault.putDerived).not.toHaveBeenCalled();
  });

  it('cancels a non-cooperative Vault read without materializing a manifest', async () => {
    const body = new TextEncoder().encode('body');
    const fixture = disclosureFixture(body, 'console');
    const vault = vaultFixture(body, fixture.source);
    vault.readExact = vi.fn(() => new Promise(() => undefined));
    const controller = new AbortController();
    const pending = materializeDisclosureManifest({
      decisionInput: fixture.decisionInput, source: fixture.source, vault, signal: controller.signal,
      categoryRegistry: fixture.categoryRegistry,
    });
    const reason = new DOMException('cancelled', 'AbortError');
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(vault.putDerived).not.toHaveBeenCalled();
  });
});

function disclosureFixture(
  payload: Uint8Array,
  channel: 'console' | 'a2a',
  requestedMode: 'full' | 'metadata_only' = 'full',
  options: Readonly<{
    transform?: boolean;
    transformApproval?: boolean;
    wrongTenant?: boolean;
    restricted?: boolean;
  }> = {},
): {
  source: PayloadVaultObjectHandle;
  decisionInput: DisclosureDecisionInput;
  categoryRegistry: DataCategoryRegistrySnapshot;
} {
  const payloadHash = sha(payload);
  const categoryRegistry = createDataCategoryRegistrySnapshot({
    id: 'registry:tenant-1',
    revision: 3,
    tenantId: 'tenant-1',
    kindFloors: {
      task_report: 'project_internal',
      projection_payload: 'project_internal',
    },
    categories: {
      customer_content: { confidentialityFloor: 'confidential' },
      customer_content_redacted: { confidentialityFloor: 'project_internal' },
    },
  });
  const descriptor: DataDescriptor = {
    objectId: 'object:source-1', payloadHash, tenantId: 'tenant-1', projectId: 'project-1',
    kind: 'task_report', confidentiality: options.restricted ? 'restricted' : 'confidential',
    categories: ['customer_content'],
    allowedPurposes: ['task_execution'], allowedRegions: ['ap-southeast-1'],
    subjectRefs: ['subject:customer-1'],
    retention: { class: 'operational', minimumRetainUntil: 100, deleteAfter: 200 },
    lineage: { sourceObjectIds: ['object:ingress-1'] },
    classificationSource: {
      categoryRegistryId: 'registry:tenant-1', categoryRegistryRevision: 3,
      categoryRegistryDigest: categoryRegistry.digest,
    },
  };
  const recipients = createDisclosureRecipientSetSnapshot({
    revision: 5,
    recipients: [{
      principalId: 'principal:recipient-1', tenantId: 'tenant-1', projectId: 'project-1',
      clearance: options.restricted ? 'restricted' : 'confidential',
    }],
  });
  const destination = createProcessingDestinationContract({
    id: `destination:${channel}`,
    owner: 'platform:owner', endpoint: `${channel}://workroom`,
    tenantId: options.wrongTenant ? 'tenant:other' : 'tenant-1',
    projectId: 'project-1', trustDomain: 'trust:internal',
    processingRegions: ['ap-southeast-1'],
    maxConfidentiality: options.transform
      ? 'project_internal' as const
      : options.restricted ? 'restricted' as const : 'confidential' as const,
    allowedCategories: options.transform ? ['customer_content_redacted'] : ['customer_content'],
    external: channel === 'a2a', noTraining: true,
    loggingMode: 'metadata_only' as const, maximumRetentionSeconds: 60,
    allowsRedisclosure: false, supportsDeletion: true,
    recipientSnapshotRevision: recipients.revision, recipientSnapshotDigest: recipients.digest,
  });
  const context: DisclosureContext = {
    channel, purpose: 'task_execution', requestedMode, policyRevision: 7,
    principal: {
      principalId: 'principal:executor-1', tenantId: 'tenant-1', projectId: 'project-1',
      role: 'executor', clearance: options.restricted ? 'restricted' : 'confidential',
      allowedPurposes: ['task_execution'],
      assignmentId: 'assignment:1',
    },
    destination,
    recipients,
  };
  const policy: DataGovernancePolicySnapshot = createDataGovernancePolicySnapshot({
    id: 'policy:data', revision: 7,
    tenantId: 'tenant-1', projectId: 'project-1', destinations: { [destination.id]: destination },
    channelCeilings: {
      console: options.restricted ? 'restricted' : 'confidential',
      a2a: options.restricted ? 'restricted' : 'confidential',
      context_view: 'confidential',
      evidence_port: 'confidential', workroom_projection: 'project_internal',
      sponsor_projection: 'confidential', model_provider: 'confidential',
    },
    transforms: options.transform ? {
      'transform:redact-account': {
        id: 'transform:redact-account', inputCategoriesAny: ['customer_content'],
        outputConfidentiality: 'project_internal', outputCategories: ['customer_content_redacted'],
        allowedChannels: ['a2a'],
      },
    } : {},
    externalApprovalFloor: options.transformApproval ? 'project_internal' : 'restricted',
  });
  return {
    categoryRegistry,
    source: {
      version: 1, vaultObjectId: 'vault:source-1', objectId: descriptor.objectId,
      payloadHash, descriptorDigest: digestCanonicalWorkroomValue(descriptor),
      tenantId: descriptor.tenantId, projectId: descriptor.projectId,
      locationManifestDigest: `sha256:${'6'.repeat(64)}`,
    },
    decisionInput: structuredClone({ descriptor, policy, context, approvals: [], evaluatedAt: 100 }),
  };
}

function vaultFixture(
  sourceBody: Uint8Array,
  source: PayloadVaultObjectHandle,
): PayloadVaultPort & { readExact: ReturnType<typeof vi.fn>; putDerived: ReturnType<typeof vi.fn> } {
  const derivedPayload = { current: new Uint8Array() };
  return {
    readExact: vi.fn(async () => sourceBody),
    putDerived: vi.fn(async (input) => {
      derivedPayload.current = input.payload;
      return {
        version: 1, vaultObjectId: 'vault:derived-1', objectId: input.objectId,
        payloadHash: input.payloadHash, descriptorDigest: input.descriptorDigest,
        tenantId: input.tenantId, projectId: input.projectId,
        locationManifestDigest: `sha256:${'9'.repeat(64)}`,
      };
    }),
  };
}

function sha(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
