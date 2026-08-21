import {
  classifyDataDescriptor,
  decideDisclosure,
  type DataCategoryRegistrySnapshot,
  type DataDescriptor,
  type DataGovernancePolicySnapshot,
  type DisclosureContext,
} from '../../src/data-governance/data-governance.js';

const registry: DataCategoryRegistrySnapshot = {
  id: 'registry:tenant-1',
  revision: 3,
  digest: 'sha256:registry-3',
  tenantId: 'tenant-1',
  kindFloors: { workroom_fact: 'project_internal' },
  categories: {
    customer_content: { confidentialityFloor: 'confidential' },
  },
};

const descriptor: DataDescriptor = {
  objectId: 'object:1',
  payloadHash: `sha256:${'d'.repeat(64)}`,
  tenantId: 'tenant-1',
  projectId: 'project-1',
  kind: 'workroom_fact',
  confidentiality: 'confidential',
  categories: ['customer_content'],
  allowedPurposes: ['task_execution', 'workroom_awareness'],
  allowedRegions: ['ap-southeast-1'],
  subjectRefs: ['subject:customer-1'],
  retention: { class: 'operational', minimumRetainUntil: 100, deleteAfter: 200 },
  lineage: { sourceObjectIds: ['object:source-1'] },
  classificationSource: {
    categoryRegistryId: 'registry:tenant-1',
    categoryRegistryRevision: 3,
    categoryRegistryDigest: 'sha256:registry-3',
  },
};

const consoleDestination = {
  id: 'destination:console',
  contractDigest: 'sha256:console-contract',
  owner: 'platform:console',
  endpoint: 'console://workroom',
  tenantId: 'tenant-1',
  projectId: 'project-1',
  trustDomain: 'trust:internal',
  processingRegions: ['ap-southeast-1'],
  maxConfidentiality: 'confidential',
  allowedCategories: ['customer_content'],
  external: false,
  noTraining: true,
  loggingMode: 'metadata_only',
  maximumRetentionSeconds: 3_600,
  allowsRedisclosure: false,
  supportsDeletion: true,
  recipientSnapshotRevision: 5,
  recipientSnapshotDigest: 'sha256:members-5',
} as const;

const policy: DataGovernancePolicySnapshot = {
  id: 'policy:data-governance',
  revision: 7,
  digest: 'sha256:policy-7',
  tenantId: 'tenant-1',
  projectId: 'project-1',
  destinations: { [consoleDestination.id]: consoleDestination },
  channelCeilings: {
    console: 'restricted',
    context_view: 'restricted',
    evidence_port: 'restricted',
    workroom_projection: 'project_internal',
    sponsor_projection: 'confidential',
    model_provider: 'confidential',
    a2a: 'confidential',
  },
  transforms: {},
  externalApprovalFloor: 'confidential',
};

const context: DisclosureContext = {
  channel: 'console',
  purpose: 'task_execution',
  requestedMode: 'full',
  policyRevision: 7,
  principal: {
    principalId: 'principal:executor-1',
    tenantId: 'tenant-1',
    projectId: 'project-1',
    role: 'executor',
    clearance: 'confidential',
    allowedPurposes: ['task_execution'],
    assignmentId: 'assignment:1',
  },
  destination: consoleDestination,
  recipients: {
    revision: 5,
    digest: 'sha256:members-5',
    recipients: [{
      principalId: 'principal:executor-1',
      tenantId: 'tenant-1',
      projectId: 'project-1',
      clearance: 'confidential',
    }],
  },
};

describe('data governance', () => {
  it('quarantines input whose confidentiality is unknown before any disclosure', () => {
    const result = classifyDataDescriptor({
      objectId: 'object:1',
      payloadHash: `sha256:${'a'.repeat(64)}`,
      tenantId: 'tenant-1',
      projectId: 'project-1',
      kind: 'workroom_fact',
      proposedConfidentiality: 'unknown',
      categories: ['customer_content'],
      allowedPurposes: ['task_execution'],
      allowedRegions: ['ap-southeast-1'],
      subjectRefs: ['subject:customer-1'],
      retention: {
        class: 'operational',
        minimumRetainUntil: 100,
        deleteAfter: 200,
      },
      lineage: { sourceObjectIds: ['object:source-1'] },
    }, registry);

    expect(result).toEqual({
      status: 'quarantined',
      objectId: 'object:1',
      categoryRegistryRevision: 3,
      reasonCodes: ['classification_unknown'],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.reasonCodes)).toBe(true);
  });

  it('quarantines malformed descriptor input with stable typed reasons', () => {
    const result = classifyDataDescriptor({
      objectId: ' ',
      payloadHash: 'not-a-content-hash',
      tenantId: 'tenant-1',
      projectId: '',
      kind: 'workroom_fact',
      proposedConfidentiality: 'project_internal',
      categories: ['customer_content'],
      allowedPurposes: [],
      allowedRegions: [],
      subjectRefs: [],
      retention: {
        class: 'operational',
        minimumRetainUntil: 201,
        deleteAfter: 200,
      },
      lineage: { sourceObjectIds: [] },
    }, registry);

    expect(result).toEqual({
      status: 'quarantined',
      objectId: '',
      categoryRegistryRevision: 3,
      reasonCodes: ['descriptor_malformed', 'retention_window_invalid'],
    });
  });

  it('quarantines unknown and wrong-shaped ingress without throwing', () => {
    expect(classifyDataDescriptor(null, registry)).toEqual({
      status: 'quarantined',
      objectId: '',
      categoryRegistryRevision: 3,
      reasonCodes: ['descriptor_malformed'],
    });
    expect(classifyDataDescriptor({
      objectId: 'object:broken',
      categories: 'customer_content',
      retention: null,
    }, registry)).toEqual({
      status: 'quarantined',
      objectId: 'object:broken',
      categoryRegistryRevision: 3,
      reasonCodes: ['descriptor_malformed'],
    });
  });

  it('joins untrusted metadata with trusted kind and category floors', () => {
    const result = classifyDataDescriptor({
      objectId: 'object:customer-message',
      payloadHash: `sha256:${'b'.repeat(64)}`,
      tenantId: 'tenant-1',
      projectId: 'project-1',
      kind: 'workroom_fact',
      proposedConfidentiality: 'public',
      categories: ['customer_content'],
      allowedPurposes: ['task_execution'],
      allowedRegions: ['ap-southeast-1'],
      subjectRefs: ['subject:customer-1'],
      retention: {
        class: 'operational',
        minimumRetainUntil: 100,
        deleteAfter: 200,
      },
      lineage: { sourceObjectIds: ['object:source-1'] },
    }, registry);

    expect(result.status).toBe('registered');
    if (result.status !== 'registered') throw new Error('expected a registered descriptor');
    expect(result.descriptor.confidentiality).toBe('confidential');
    expect(result.descriptor.classificationSource).toEqual({
      categoryRegistryId: 'registry:tenant-1',
      categoryRegistryRevision: 3,
      categoryRegistryDigest: 'sha256:registry-3',
    });
    expect(Object.isFrozen(result.descriptor)).toBe(true);
    expect(Object.isFrozen(result.descriptor.retention)).toBe(true);
    expect(Object.isFrozen(result.descriptor.lineage.sourceObjectIds)).toBe(true);
  });

  it('canonicalizes set-like descriptor arrays before registration', () => {
    const candidate = {
      objectId: 'object:canonical',
      payloadHash: `sha256:${'f'.repeat(64)}`,
      tenantId: 'tenant-1',
      projectId: 'project-1',
      kind: 'workroom_fact' as const,
      proposedConfidentiality: 'confidential' as const,
      categories: ['customer_content'],
      allowedPurposes: ['workroom_awareness', 'task_execution'] as const,
      allowedRegions: ['us-west-2', 'ap-southeast-1'],
      subjectRefs: ['subject:2', 'subject:1'],
      retention: {
        class: 'operational' as const,
        minimumRetainUntil: 100,
        deleteAfter: 200,
      },
      lineage: { sourceObjectIds: ['object:source-2', 'object:source-1'] },
    };
    const reversed = {
      ...candidate,
      allowedPurposes: [...candidate.allowedPurposes].reverse(),
      allowedRegions: [...candidate.allowedRegions].reverse(),
      subjectRefs: [...candidate.subjectRefs].reverse(),
      lineage: { sourceObjectIds: [...candidate.lineage.sourceObjectIds].reverse() },
    };

    expect(classifyDataDescriptor(candidate, registry)).toEqual(
      classifyDataDescriptor(reversed, registry),
    );
  });

  it('quarantines categories that are absent from the trusted registry', () => {
    const result = classifyDataDescriptor({
      objectId: 'object:unclassified',
      payloadHash: `sha256:${'c'.repeat(64)}`,
      tenantId: 'tenant-1',
      projectId: 'project-1',
      kind: 'workroom_fact',
      proposedConfidentiality: 'restricted',
      categories: ['agent_claimed_safe'],
      allowedPurposes: ['task_execution'],
      allowedRegions: ['ap-southeast-1'],
      subjectRefs: [],
      retention: {
        class: 'operational',
        minimumRetainUntil: 100,
        deleteAfter: 200,
      },
      lineage: { sourceObjectIds: [] },
    }, registry);

    expect(result).toEqual({
      status: 'quarantined',
      objectId: 'object:unclassified',
      categoryRegistryRevision: 3,
      reasonCodes: ['category_unknown'],
    });
  });

  it('quarantines a descriptor outside the exact trusted registry scope', () => {
    const result = classifyDataDescriptor({
      objectId: 'object:wrong-tenant',
      payloadHash: `sha256:${'e'.repeat(64)}`,
      tenantId: 'tenant-2',
      projectId: 'project-1',
      kind: 'workroom_fact',
      proposedConfidentiality: 'restricted',
      categories: ['customer_content'],
      allowedPurposes: ['task_execution'],
      allowedRegions: ['ap-southeast-1'],
      subjectRefs: [],
      retention: {
        class: 'operational',
        minimumRetainUntil: 100,
        deleteAfter: 200,
      },
      lineage: { sourceObjectIds: [] },
    }, { ...registry, kindFloors: {} });

    expect(result).toEqual({
      status: 'quarantined',
      objectId: 'object:wrong-tenant',
      categoryRegistryRevision: 3,
      reasonCodes: ['registry_tenant_mismatch', 'kind_floor_missing'],
    });
  });

  it('allows full disclosure only for one exact trusted context', () => {
    const decision = decideDisclosure({
      descriptor,
      policy,
      context,
      approvals: [],
      evaluatedAt: 150,
    });

    expect(decision.disposition).toBe('full');
    expect(decision.reasonCodes).toEqual(['authorized_minimum_disclosure']);
    expect(decision.requestDigest).toMatch(/^sha256:[a-f\d]{64}$/u);
    expect(decision.policy).toEqual({ revision: 7, digest: 'sha256:policy-7' });
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.contextBinding)).toBe(true);
    expect(Object.isFrozen(decision.contextBinding.recipients)).toBe(true);
    expect(decision.contextBinding.principalSnapshot).toEqual(context.principal);
    expect(decision.contextBinding.destinationSnapshot).toEqual(context.destination);
    expect(decision.contextBinding.recipientSnapshot).toEqual(context.recipients);
    expect(Object.isFrozen(decision.contextBinding.recipientSnapshot.recipients)).toBe(true);
  });

  it('denies a request when any exact scope or recipient binding is stale', () => {
    const decision = decideDisclosure({
      descriptor,
      policy,
      context: {
        ...context,
        purpose: 'audit',
        policyRevision: 8,
        principal: { ...context.principal, tenantId: 'tenant-2' },
        destination: {
          ...context.destination,
          contractDigest: 'sha256:forged-contract',
        },
        recipients: {
          revision: 6,
          digest: 'sha256:members-6',
          recipients: [{
            principalId: 'principal:outsider',
            tenantId: 'tenant-2',
            projectId: 'project-1',
            clearance: 'restricted',
          }],
        },
      },
      approvals: [],
      evaluatedAt: 150,
    });

    expect(decision.disposition).toBe('deny');
    expect(decision.reasonCodes).toEqual([
      'policy_revision_mismatch',
      'principal_tenant_mismatch',
      'purpose_not_allowed',
      'destination_contract_mismatch',
      'recipient_snapshot_mismatch',
      'recipient_tenant_mismatch',
    ]);
  });

  it('returns metadata_only when the exact caller requests no body', () => {
    const decision = decideDisclosure({
      descriptor,
      policy,
      context: { ...context, requestedMode: 'metadata_only' },
      approvals: [],
      evaluatedAt: 150,
    });

    expect(decision.disposition).toBe('metadata_only');
    expect(decision.reasonCodes).toEqual(['metadata_only_requested']);
  });

  it('requires one trusted transform when raw data exceeds destination ceilings', () => {
    const restrictedDestination = {
      ...consoleDestination,
      contractDigest: 'sha256:console-minimized',
      maxConfidentiality: 'project_internal' as const,
      allowedCategories: ['support_status'],
    };
    const decision = decideDisclosure({
      descriptor,
      policy: {
        ...policy,
        destinations: { [restrictedDestination.id]: restrictedDestination },
        transforms: {
          'support:redact:v1': {
            id: 'support:redact:v1',
            inputCategoriesAny: ['customer_content'],
            outputConfidentiality: 'project_internal',
            outputCategories: ['support_status'],
            allowedChannels: ['console'],
          },
        },
      },
      context: { ...context, destination: restrictedDestination },
      approvals: [],
      evaluatedAt: 150,
    });

    expect(decision.disposition).toBe('transform_required');
    expect(decision.reasonCodes).toEqual([
      'classification_above_destination_ceiling',
      'destination_category_blocked',
      'trusted_transform_required',
    ]);
    expect(decision.requiredTransformId).toBe('support:redact:v1');
  });

  it('requires and consumes only an exact unexpired compliance approval', () => {
    const externalDestination = {
      ...consoleDestination,
      id: 'destination:external-model',
      contractDigest: 'sha256:external-model-contract',
      owner: 'provider:model',
      endpoint: 'https://model.invalid/v1',
      trustDomain: 'trust:processor',
      external: true,
    };
    const externalPolicy = {
      ...policy,
      destinations: { [externalDestination.id]: externalDestination },
    };
    const externalContext = {
      ...context,
      channel: 'model_provider' as const,
      destination: externalDestination,
    };
    const pending = decideDisclosure({
      descriptor,
      policy: externalPolicy,
      context: externalContext,
      approvals: [],
      evaluatedAt: 150,
    });

    expect(pending.disposition).toBe('approval_required');
    expect(pending.reasonCodes).toEqual(['exact_approval_required']);
    expect(pending.requiredApprovalRoles).toEqual(['compliance']);

    const approved = decideDisclosure({
      descriptor,
      policy: externalPolicy,
      context: externalContext,
      approvals: [{
        id: 'approval:1',
        requestDigest: pending.requestDigest,
        role: 'compliance',
        principalId: 'principal:compliance-1',
        policyRevision: 7,
        decision: 'approved',
        expiresAt: 151,
      }],
      evaluatedAt: 150,
    });
    expect(approved.disposition).toBe('full');

    const stale = decideDisclosure({
      descriptor,
      policy: externalPolicy,
      context: externalContext,
      approvals: [{
        id: 'approval:stale',
        requestDigest: pending.requestDigest,
        role: 'compliance',
        principalId: 'principal:compliance-1',
        policyRevision: 7,
        decision: 'approved',
        expiresAt: 150,
      }],
      evaluatedAt: 150,
    });
    expect(stale.disposition).toBe('approval_required');

    const wrongPolicy = decideDisclosure({
      descriptor,
      policy: externalPolicy,
      context: externalContext,
      approvals: [{
        id: 'approval:wrong-policy',
        requestDigest: pending.requestDigest,
        role: 'compliance',
        principalId: 'principal:compliance-1',
        policyRevision: 6,
        decision: 'approved',
        expiresAt: 151,
      }],
      evaluatedAt: 150,
    });
    expect(wrongPolicy.disposition).toBe('approval_required');
  });

  it('hard-denies credentials, residency violations, and trainable external processors', () => {
    const unsafeDestination = {
      ...consoleDestination,
      id: 'destination:unsafe-model',
      contractDigest: 'sha256:unsafe-model-contract',
      processingRegions: ['us-east-1'],
      allowedCategories: ['credential'],
      external: true,
      noTraining: false,
    };
    const decision = decideDisclosure({
      descriptor: { ...descriptor, categories: ['credential'] },
      policy: {
        ...policy,
        destinations: { [unsafeDestination.id]: unsafeDestination },
      },
      context: { ...context, destination: unsafeDestination },
      approvals: [],
      evaluatedAt: 150,
    });

    expect(decision.disposition).toBe('deny');
    expect(decision.reasonCodes).toEqual([
      'credential_requires_secret_capability_port',
      'residency_violation',
      'external_training_not_prohibited',
    ]);
  });

  it('denies raw disclosure when no trusted minimizing transform can satisfy ceilings', () => {
    const restrictedDestination = {
      ...consoleDestination,
      contractDigest: 'sha256:no-transform',
      maxConfidentiality: 'project_internal' as const,
      allowedCategories: ['support_status'],
    };
    const decision = decideDisclosure({
      descriptor,
      policy: {
        ...policy,
        destinations: { [restrictedDestination.id]: restrictedDestination },
      },
      context: { ...context, destination: restrictedDestination },
      approvals: [],
      evaluatedAt: 150,
    });

    expect(decision.disposition).toBe('deny');
    expect(decision.reasonCodes).toEqual([
      'classification_above_destination_ceiling',
      'destination_category_blocked',
      'no_trusted_minimizing_transform',
    ]);
  });

  it('fails closed for an unknown destination or missing channel/recipient policy facts', () => {
    const unknownDestination = {
      ...consoleDestination,
      id: 'destination:not-catalogued',
    };
    const unknown = decideDisclosure({
      descriptor,
      policy,
      context: { ...context, destination: unknownDestination },
      approvals: [],
      evaluatedAt: 150,
    });
    expect(unknown.disposition).toBe('deny');
    expect(unknown.reasonCodes).toEqual(['destination_unknown']);

    const malformed = decideDisclosure({
      descriptor,
      policy,
      context: {
        ...context,
        channel: 'unregistered_sink' as DisclosureContext['channel'],
        recipients: {
          revision: 5,
          digest: 'sha256:members-5',
          recipients: [],
        },
      },
      approvals: [],
      evaluatedAt: 150,
    });
    expect(malformed.disposition).toBe('deny');
    expect(malformed.reasonCodes).toEqual([
      'channel_policy_missing',
      'recipient_snapshot_empty',
    ]);
  });

  it('denies a catalogued destination outside the descriptor tenant and Project', () => {
    const crossScopeDestination = {
      ...consoleDestination,
      tenantId: 'tenant-2',
      projectId: 'project-2',
    };
    const decision = decideDisclosure({
      descriptor,
      policy: {
        ...policy,
        destinations: { [crossScopeDestination.id]: crossScopeDestination },
      },
      context: { ...context, destination: crossScopeDestination },
      approvals: [],
      evaluatedAt: 150,
    });

    expect(decision.disposition).toBe('deny');
    expect(decision.reasonCodes).toEqual([
      'destination_tenant_mismatch',
      'destination_project_mismatch',
    ]);
  });

  it('binds the request digest to descriptor, channel, purpose, principal, destination, and recipients', () => {
    const base = decideDisclosure({ descriptor, policy, context, approvals: [], evaluatedAt: 150 });
    const reclassified = decideDisclosure({
      descriptor: { ...descriptor, confidentiality: 'restricted' },
      policy,
      context,
      approvals: [],
      evaluatedAt: 150,
    });
    const variants = [
      { ...context, channel: 'context_view' as const },
      {
        ...context,
        purpose: 'workroom_awareness' as const,
        principal: {
          ...context.principal,
          allowedPurposes: ['task_execution', 'workroom_awareness'] as const,
        },
      },
      {
        ...context,
        principal: { ...context.principal, principalId: 'principal:executor-2' },
      },
      {
        ...context,
        destination: { ...context.destination, contractDigest: 'sha256:changed-contract' },
      },
      {
        ...context,
        recipients: { ...context.recipients, digest: 'sha256:changed-members' },
      },
    ].map((variant) => decideDisclosure({
      descriptor,
      policy,
      context: variant,
      approvals: [],
      evaluatedAt: 150,
    }).requestDigest);

    expect(new Set([base.requestDigest, reclassified.requestDigest, ...variants]).size).toBe(7);
  });

  it('intersects channel, principal, destination, and every recipient clearance ceiling', () => {
    const constrainedContexts: DisclosureContext[] = [
      { ...context, channel: 'workroom_projection' },
      {
        ...context,
        principal: { ...context.principal, clearance: 'project_internal' },
      },
      {
        ...context,
        destination: {
          ...context.destination,
          maxConfidentiality: 'project_internal',
        },
      },
      {
        ...context,
        recipients: {
          ...context.recipients,
          recipients: [{ ...context.recipients.recipients[0]!, clearance: 'project_internal' }],
        },
      },
    ];

    for (const constrained of constrainedContexts) {
      const constrainedPolicy: DataGovernancePolicySnapshot = {
        ...policy,
        destinations: { [constrained.destination.id]: constrained.destination },
      };
      const decision = decideDisclosure({
        descriptor,
        policy: constrainedPolicy,
        context: constrained,
        approvals: [],
        evaluatedAt: 150,
      });
      expect(decision.disposition).toBe('deny');
      expect(decision.reasonCodes).toContain('classification_above_destination_ceiling');
    }
  });
});
