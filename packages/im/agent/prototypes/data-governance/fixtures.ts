import {
  compileGovernancePolicy,
  type DataGovernancePolicy,
  type DisclosureDestination,
  type DisclosureEnvelope,
  type GovernedObjectInput,
  type GovernanceActor,
  type TrustedTransformDeclaration,
} from './data-governance.ts';

export const governanceKernel: GovernanceActor = { id: 'kernel:data-governance', role: 'governance_kernel' };
export const ingressGateway: GovernanceActor = { id: 'gateway:classified-ingress', role: 'ingress_gateway' };
export const dataSteward: GovernanceActor = { id: 'human:data-steward', role: 'data_steward' };
export const compliance: GovernanceActor = { id: 'human:compliance', role: 'compliance' };
export const privacyOperator: GovernanceActor = { id: 'human:privacy-operator', role: 'privacy_operator' };
export const storageGateway: GovernanceActor = { id: 'gateway:payload-vault', role: 'storage_gateway' };
export const disclosureGateway: GovernanceActor = { id: 'gateway:disclosure', role: 'disclosure_gateway' };

const transforms: readonly TrustedTransformDeclaration[] = [
  {
    id: 'support.case-redact:v1',
    inputCategoriesAny: ['personal_data', 'customer_content'],
    outputClassification: 'confidential',
    outputCategories: ['personal_data', 'customer_content'],
    allowedChannels: ['context_view', 'evidence_port', 'a2a'],
    breaksSubjectLink: false,
  },
  {
    id: 'support.status:v1',
    inputCategoriesAny: ['personal_data', 'customer_content'],
    outputClassification: 'project_internal',
    outputCategories: [],
    allowedChannels: ['workroom_projection', 'sponsor_projection'],
    breaksSubjectLink: true,
  },
  {
    id: 'investment.aggregate:v1',
    inputCategoriesAny: ['financial_data', 'account_identifier'],
    outputClassification: 'confidential',
    outputCategories: ['personal_data', 'financial_data', 'market_sensitive'],
    allowedChannels: ['context_view', 'evidence_port', 'a2a'],
    breaksSubjectLink: false,
  },
  {
    id: 'investment.status:v1',
    inputCategoriesAny: ['financial_data', 'account_identifier', 'market_sensitive'],
    outputClassification: 'project_internal',
    outputCategories: [],
    allowedChannels: ['workroom_projection', 'sponsor_projection'],
    breaksSubjectLink: true,
  },
];

const transformCatalog = Object.fromEntries(transforms.map((item) => [item.id, item]));
const destinations = [
  'support:model:eu-local',
  'support:workroom-im',
  'support:sponsor-im',
  'support:console',
  'support:a2a-eu',
  'support:model:us-external',
  'investment:model:sg-local',
  'investment:workroom-im',
  'investment:sponsor-im',
  'investment:console',
  'investment:a2a-sg',
];

export function baselinePolicy(projectId: string): DataGovernancePolicy {
  return {
    id: 'governance:baseline',
    revision: 1,
    tenantId: 'tenant:acme',
    projectId,
    allowedRegions: ['eu-west', 'sg'],
    allowedDestinationIds: destinations,
    destinationCatalog: allDestinations(),
    categoryFloor: {
      personal_data: 'confidential',
      direct_identifier: 'restricted',
      credential: 'restricted',
      customer_content: 'confidential',
      financial_data: 'confidential',
      account_identifier: 'restricted',
      market_sensitive: 'confidential',
      legal_record: 'confidential',
    },
    kindFloor: {
      source_message: 'project_internal',
      workroom_fact: 'project_internal',
      context_digest: 'project_internal',
      task_report: 'project_internal',
      artifact: 'project_internal',
      evidence: 'confidential',
      execution_trace: 'confidential',
      projection_payload: 'public',
    },
    channelMaximum: {
      context_view: 'restricted',
      evidence_port: 'restricted',
      workroom_projection: 'project_internal',
      sponsor_projection: 'project_internal',
      console: 'restricted',
      a2a: 'confidential',
    },
    retention: {
      transient: { minimumTicks: 0, maximumTicks: 5 },
      operational: { minimumTicks: 0, maximumTicks: 30 },
      project_record: { minimumTicks: 0, maximumTicks: 100 },
      regulated_record: { minimumTicks: 10, maximumTicks: 100 },
    },
    transformIds: transforms.map((item) => item.id),
    transformCatalog,
    externalApprovalAtOrAbove: 'confidential',
    crossProjectExport: true,
  };
}

export function supportPolicy(): DataGovernancePolicy {
  const profile: DataGovernancePolicy = {
    ...baselinePolicy('project:support'),
    id: 'governance:support',
    revision: 3,
    allowedRegions: ['eu-west'],
    allowedDestinationIds: destinations.filter((id) => id.startsWith('support:')),
    retention: {
      transient: { minimumTicks: 0, maximumTicks: 2 },
      operational: { minimumTicks: 0, maximumTicks: 10 },
      project_record: { minimumTicks: 5, maximumTicks: 30 },
      regulated_record: { minimumTicks: 20, maximumTicks: 20 },
    },
    transformIds: ['support.case-redact:v1', 'support.status:v1'],
  };
  return compileGovernancePolicy(baselinePolicy('project:support'), profile);
}

export function investmentPolicy(): DataGovernancePolicy {
  const profile: DataGovernancePolicy = {
    ...baselinePolicy('project:investment'),
    id: 'governance:investment',
    revision: 4,
    allowedRegions: ['sg'],
    allowedDestinationIds: destinations.filter((id) => id.startsWith('investment:')),
    retention: {
      transient: { minimumTicks: 0, maximumTicks: 2 },
      operational: { minimumTicks: 1, maximumTicks: 12 },
      project_record: { minimumTicks: 10, maximumTicks: 40 },
      regulated_record: { minimumTicks: 20, maximumTicks: 20 },
    },
    transformIds: ['investment.aggregate:v1', 'investment.status:v1'],
  };
  return compileGovernancePolicy(baselinePolicy('project:investment'), profile);
}

export function supportObjects(): readonly GovernedObjectInput[] {
  return [
    {
      id: 'data:support-case', tenantId: 'tenant:acme', projectId: 'project:support', kind: 'source_message',
      payload: 'Customer alice@example.com reports order ORD-8842 failed after payment.',
      proposedClassification: 'project_internal',
      categories: ['personal_data', 'direct_identifier', 'customer_content'],
      allowedPurposes: ['orchestration', 'task_execution', 'acceptance_review', 'workroom_awareness', 'remote_execution', 'audit'],
      allowedRegions: ['eu-west'], retentionClass: 'operational', subjectRefs: ['subject:customer:7f3'],
      locations: ['payload-vault:primary', 'search-index:support'],
    },
    {
      id: 'data:support-secret', tenantId: 'tenant:acme', projectId: 'project:support', kind: 'evidence',
      payload: 'api_token=top-secret', proposedClassification: 'restricted', categories: ['credential'],
      allowedPurposes: ['reconciliation'], allowedRegions: ['eu-west'], retentionClass: 'transient',
      subjectRefs: [], locations: ['secret-vault:primary'],
    },
    {
      id: 'data:support-status', tenantId: 'tenant:acme', projectId: 'project:support', kind: 'workroom_fact',
      payload: 'Support diagnosis is active; no approval blocker.', proposedClassification: 'project_internal', categories: [],
      allowedPurposes: ['orchestration', 'workroom_awareness', 'portfolio_oversight', 'audit'],
      allowedRegions: ['eu-west'], retentionClass: 'project_record', subjectRefs: [], locations: ['payload-vault:primary'],
    },
  ];
}

export function investmentObjects(): readonly GovernedObjectInput[] {
  return [
    {
      id: 'data:positions', tenantId: 'tenant:acme', projectId: 'project:investment', kind: 'artifact',
      payload: JSON.stringify({ account: 'ACC-992', owner: 'subject:investor:19', positions: [
        { sector: 'technology', value: 60 }, { sector: 'technology', value: 20 }, { sector: 'energy', value: 20 },
      ] }),
      proposedClassification: 'confidential',
      categories: ['personal_data', 'account_identifier', 'financial_data', 'market_sensitive'],
      allowedPurposes: ['task_execution', 'acceptance_review', 'remote_execution', 'audit'], allowedRegions: ['sg'],
      retentionClass: 'regulated_record', subjectRefs: ['subject:investor:19'],
      locations: ['payload-vault:primary', 'analytics-index:sg'],
    },
    {
      id: 'data:research-memo', tenantId: 'tenant:acme', projectId: 'project:investment', kind: 'task_report',
      payload: 'Evidence-backed sector thesis; unpublished assumptions remain market-sensitive.',
      proposedClassification: 'confidential', categories: ['financial_data', 'market_sensitive'],
      allowedPurposes: ['task_execution', 'acceptance_review', 'remote_execution', 'audit'], allowedRegions: ['sg'],
      retentionClass: 'project_record', subjectRefs: [], locations: ['payload-vault:primary'],
    },
  ];
}

export const supportDestinations: Readonly<Record<string, DisclosureDestination>> = {
  localModel: destination('support:model:eu-local', 'local_model', 'project:support', ['eu-west'], 'confidential', ['personal_data', 'customer_content'], false, false),
  workroom: destination('support:workroom-im', 'workroom_im', 'project:support', ['eu-west'], 'project_internal', [], true, false, [
    { id: 'alice', tenantId: 'tenant:acme', projectId: 'project:support', clearance: 'confidential' },
    { id: 'bob', tenantId: 'tenant:acme', projectId: 'project:support', clearance: 'project_internal' },
  ]),
  sponsor: destination('support:sponsor-im', 'sponsor_im', undefined, ['eu-west'], 'project_internal', [], true, false),
  console: destination('support:console', 'console', 'project:support', ['eu-west'], 'restricted', ['personal_data', 'customer_content', 'credential'], false, true),
  a2a: destination('support:a2a-eu', 'a2a_agent', 'project:support', ['eu-west'], 'confidential', ['customer_content'], true, true),
  wrongRegionModel: destination('support:model:us-external', 'external_model', 'project:support', ['us-east'], 'confidential', ['customer_content'], true, false),
};

export const investmentDestinations: Readonly<Record<string, DisclosureDestination>> = {
  localModel: destination('investment:model:sg-local', 'local_model', 'project:investment', ['sg'], 'confidential', ['personal_data', 'financial_data', 'market_sensitive'], false, false),
  workroom: destination('investment:workroom-im', 'workroom_im', 'project:investment', ['sg'], 'project_internal', [], true, false),
  sponsor: destination('investment:sponsor-im', 'sponsor_im', undefined, ['sg'], 'project_internal', [], true, false),
  console: destination('investment:console', 'console', 'project:investment', ['sg'], 'restricted', ['personal_data', 'account_identifier', 'financial_data', 'market_sensitive'], false, true),
  a2a: destination('investment:a2a-sg', 'a2a_agent', 'project:investment', ['sg'], 'confidential', ['financial_data', 'market_sensitive'], true, true),
};

export function envelope(
  policy: DataGovernancePolicy,
  role: DisclosureEnvelope['role'],
  clearance: DisclosureEnvelope['clearance'],
  purposes: DisclosureEnvelope['allowedPurposes'],
  overrides: Partial<DisclosureEnvelope> = {},
): DisclosureEnvelope {
  return {
    principalId: `principal:${role}`,
    tenantId: policy.tenantId,
    projectId: policy.projectId,
    role,
    clearance,
    allowedPurposes: purposes,
    governancePolicyRevision: policy.revision,
    ...overrides,
  };
}

function destination(
  id: string,
  kind: DisclosureDestination['kind'],
  projectId: string | undefined,
  processingRegions: readonly string[],
  maxClassification: DisclosureDestination['maxClassification'],
  allowedCategories: readonly string[],
  external: boolean,
  supportsDeletion: boolean,
  recipients?: readonly NonNullable<DisclosureDestination['recipients']>[number][],
): DisclosureDestination {
  return {
    id,
    contractDigest: `sha256:destination-contract:${id}:v1`,
    kind,
    tenantId: 'tenant:acme',
    ...(projectId === undefined ? {} : { projectId }),
    trustDomain: external ? `external:${id}` : 'zhin:trusted-runtime',
    processingRegions,
    maxClassification,
    allowedCategories,
    external,
    noTraining: true,
    supportsDeletion,
    ...(recipients ? { membershipRevision: 1, recipients } : {}),
  };
}

function allDestinations(): Readonly<Record<string, DisclosureDestination>> {
  const values = [...Object.values(supportDestinations), ...Object.values(investmentDestinations)];
  return Object.fromEntries(values.map((value) => [value.id, value]));
}
