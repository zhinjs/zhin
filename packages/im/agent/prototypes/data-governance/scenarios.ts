/** Executable scenarios for decision-map ticket #12 (not production tests). */
import assert from 'node:assert/strict';
import {
  applyTrustedTransform,
  compileGovernancePolicy,
  deriveUntrustedObject,
  dispatchGovernance,
  erasureStatus,
  evaluateDisclosure,
  initialGovernanceJournal,
  materializeDisclosure,
  replayGovernance,
  type DataGovernancePolicy,
  type DisclosureDestination,
  type DisclosureRequest,
  type GovernedObjectInput,
  type GovernanceEvent,
} from './data-governance.ts';
import {
  baselinePolicy,
  compliance,
  dataSteward,
  disclosureGateway,
  envelope,
  governanceKernel,
  ingressGateway,
  investmentDestinations,
  investmentObjects,
  investmentPolicy,
  privacyOperator,
  storageGateway,
  supportDestinations,
  supportObjects,
  supportPolicy,
} from './fixtures.ts';

function register(
  journal: readonly GovernanceEvent[],
  input: GovernedObjectInput,
): readonly GovernanceEvent[] {
  return dispatchGovernance(journal, { type: 'register_object', actor: ingressGateway, input });
}

function disclosure(
  policy: DataGovernancePolicy,
  objectId: string,
  channel: DisclosureRequest['channel'],
  purpose: DisclosureRequest['purpose'],
  destination: DisclosureDestination,
  overrides: Partial<DisclosureRequest> = {},
): DisclosureRequest {
  const role = channel === 'context_view' ? 'executor'
    : channel === 'evidence_port' ? 'reviewer'
      : channel === 'sponsor_projection' ? 'sponsor'
        : channel === 'console' ? 'auditor'
          : 'projector';
  return {
    objectId,
    channel,
    purpose,
    envelope: envelope(policy, role, role === 'auditor' ? 'restricted' : 'confidential', [purpose]),
    destination,
    requestedMode: 'full',
    ...overrides,
  };
}

// Profile Policy Packs can only narrow the baseline. A proposed lower category
// floor is ignored, untrusted transforms are rejected, and retention composes as
// an interval intersection rather than "shorter is always safer".
{
  const baseline = baselinePolicy('project:support');
  const weakProfile: DataGovernancePolicy = {
    ...baseline,
    id: 'profile:weak', revision: 2,
    categoryFloor: { ...baseline.categoryFloor, credential: 'project_internal' },
    retention: { ...baseline.retention, regulated_record: { minimumTicks: 20, maximumTicks: 25 } },
  };
  const compiled = compileGovernancePolicy(baseline, weakProfile);
  assert.equal(compiled.categoryFloor.credential, 'restricted');
  assert.deepEqual(compiled.retention.regulated_record, { minimumTicks: 20, maximumTicks: 25 });
  assert.throws(() => compileGovernancePolicy(baseline, {
    ...weakProfile,
    transformIds: [...weakProfile.transformIds, 'untrusted.llm-redact:v1' as never],
  }), /untrusted Transform/u);
  assert.throws(() => compileGovernancePolicy(baseline, {
    ...weakProfile,
    retention: { ...weakProfile.retention, regulated_record: { minimumTicks: 101, maximumTicks: 120 } },
  }), /Retention window conflict/u);
}

// Customer-support ingress is raised to the category floor even when the source
// proposes "internal". Context, Workroom projection and A2A all call the same
// decision function but need different trusted minimizing transforms.
{
  const policy = supportPolicy();
  let journal = initialGovernanceJournal(policy);
  for (const input of supportObjects()) journal = register(journal, input);
  let state = replayGovernance(journal);
  const raw = state.objects['data:support-case']!;
  assert.equal(raw.descriptor.classification, 'restricted');

  const contextRequest = disclosure(
    policy, raw.descriptor.objectId, 'context_view', 'task_execution', supportDestinations.localModel!,
  );
  let decision = evaluateDisclosure(state, contextRequest);
  assert.equal(decision.disposition, 'transform_required');
  assert.equal(decision.requiredTransformId, 'support.case-redact:v1');
  const redactedInput = applyTrustedTransform(raw, decision.requiredTransformId!, 'data:support-case-redacted', state.now, policy);
  journal = register(journal, redactedInput);
  state = replayGovernance(journal);
  const redacted = state.objects['data:support-case-redacted']!;
  assert.equal(redacted.descriptor.classification, 'confidential');
  assert.equal(redacted.payload?.includes('alice@example.com'), false);
  assert.equal(redacted.descriptor.subjectLinkage, 'linked', 'pseudonymized support data remains subject-linked');
  decision = evaluateDisclosure(state, { ...contextRequest, objectId: redacted.descriptor.objectId });
  assert.equal(decision.disposition, 'allow_full');

  const workroomRequest = disclosure(
    policy, raw.descriptor.objectId, 'workroom_projection', 'workroom_awareness', supportDestinations.workroom!,
  );
  decision = evaluateDisclosure(state, workroomRequest);
  assert.equal(decision.requiredTransformId, 'support.status:v1');
  const statusInput = applyTrustedTransform(raw, decision.requiredTransformId!, 'data:support-public-status', state.now, policy);
  journal = register(journal, statusInput);
  state = replayGovernance(journal);
  const status = state.objects['data:support-public-status']!;
  assert.equal(status.descriptor.subjectLinkage, 'deidentified');
  assert.deepEqual(status.descriptor.categories, []);
  assert.equal(evaluateDisclosure(state, { ...workroomRequest, objectId: status.descriptor.objectId }).disposition, 'allow_full');

  const a2aRequest = disclosure(
    policy, redacted.descriptor.objectId, 'a2a', 'remote_execution', supportDestinations.a2a!,
  );
  decision = evaluateDisclosure(state, a2aRequest);
  assert.equal(decision.disposition, 'deny', 'masked but subject-linked customer data must not become A2A-safe');
}

// An LLM-created digest inherits the strictest descriptor, source lineage and
// earliest deletion deadline. Summarization is never a declassification method.
{
  const policy = supportPolicy();
  let journal = initialGovernanceJournal(policy);
  journal = register(journal, supportObjects()[0]!);
  let state = replayGovernance(journal);
  const raw = state.objects['data:support-case']!;
  const digestInput = deriveUntrustedObject([raw], {
    id: 'data:unsafe-digest', tenantId: raw.descriptor.tenantId, projectId: raw.descriptor.projectId,
    kind: 'context_digest', payload: 'Alice order failed; concise summary.',
    retentionClass: 'project_record', locations: ['payload-vault:primary'],
  });
  journal = register(journal, digestInput);
  state = replayGovernance(journal);
  const digest = state.objects['data:unsafe-digest']!;
  assert.equal(digest.descriptor.classification, 'restricted');
  assert.equal(digest.descriptor.categories.includes('personal_data'), true);
  assert.equal(digest.descriptor.deleteAfter, raw.descriptor.deleteAfter);
  const request = disclosure(
    policy, digest.descriptor.objectId, 'workroom_projection', 'workroom_awareness', supportDestinations.workroom!,
  );
  assert.equal(evaluateDisclosure(state, request).disposition, 'transform_required');
}

// Credentials never travel through Context/Evidence/projection/A2A. References
// do not grant access; a separate secret capability port is required.
{
  const policy = supportPolicy();
  let journal = initialGovernanceJournal(policy);
  journal = register(journal, supportObjects()[1]!);
  const state = replayGovernance(journal);
  const request = disclosure(
    policy, 'data:support-secret', 'evidence_port', 'reconciliation', supportDestinations.console!,
  );
  const decision = evaluateDisclosure(state, request);
  assert.equal(decision.disposition, 'deny');
  assert.equal(decision.reasons.includes('credential_requires_secret_capability_port'), true);
}

// Residency and tenant boundaries are hard denials and cannot be overridden by
// Sponsor/compliance metadata. Membership is part of the exact request digest.
{
  const policy = supportPolicy();
  let journal = initialGovernanceJournal(policy);
  journal = register(journal, supportObjects()[0]!);
  const state = replayGovernance(journal);
  const wrongRegion = disclosure(
    policy, 'data:support-case', 'context_view', 'task_execution', supportDestinations.wrongRegionModel!,
  );
  let decision = evaluateDisclosure(state, wrongRegion);
  assert.equal(decision.disposition, 'deny');
  assert.equal(decision.reasons.includes('residency_violation'), true);
  const wrongTenantDestination = { ...supportDestinations.console!, tenantId: 'tenant:other' };
  decision = evaluateDisclosure(state, disclosure(
    policy, 'data:support-case', 'console', 'audit', wrongTenantDestination,
  ));
  assert.equal(decision.disposition, 'deny');
  assert.equal(decision.reasons.includes('tenant_boundary'), true);
  const trainingDestination = { ...supportDestinations.console!, id: supportDestinations.a2a!.id, external: true, noTraining: false };
  decision = evaluateDisclosure(state, disclosure(
    policy, 'data:support-case', 'console', 'audit', trainingDestination,
  ));
  assert.equal(decision.disposition, 'deny');
  assert.equal(decision.reasons.includes('processor_training_not_prohibited'), true);

  const statusJournal = register(journal, supportObjects()[2]!);
  const statusState = replayGovernance(statusJournal);
  const first = disclosure(
    policy, 'data:support-status', 'workroom_projection', 'workroom_awareness', supportDestinations.workroom!,
  );
  const changedMembership = {
    ...first,
    destination: { ...first.destination, membershipRevision: 2 },
  };
  assert.notEqual(evaluateDisclosure(statusState, first).requestDigest, evaluateDisclosure(statusState, changedMembership).requestDigest);
}

// Investment positions require deterministic aggregation before model use. A
// confidential research memo may cross A2A only with an exact, non-stale
// compliance approval. An approval for another digest cannot be replayed.
{
  const policy = investmentPolicy();
  let journal = initialGovernanceJournal(policy);
  for (const input of investmentObjects()) journal = register(journal, input);
  let state = replayGovernance(journal);
  const positions = state.objects['data:positions']!;
  const modelRequest = disclosure(
    policy, positions.descriptor.objectId, 'context_view', 'task_execution', investmentDestinations.localModel!,
  );
  let decision = evaluateDisclosure(state, modelRequest);
  assert.equal(decision.requiredTransformId, 'investment.aggregate:v1');
  journal = register(journal, applyTrustedTransform(
    positions, decision.requiredTransformId!, 'data:sector-aggregate', state.now, policy,
  ));
  state = replayGovernance(journal);
  const aggregate = state.objects['data:sector-aggregate']!;
  assert.equal(aggregate.payload, JSON.stringify({ sectorTotals: { technology: 80, energy: 20 } }));
  assert.equal(aggregate.descriptor.subjectLinkage, 'linked', 'single-investor aggregation remains personal data');
  assert.equal(aggregate.descriptor.categories.includes('personal_data'), true);
  assert.equal(evaluateDisclosure(state, { ...modelRequest, objectId: aggregate.descriptor.objectId }).disposition, 'allow_full');

  const a2aRequest = disclosure(
    policy, 'data:research-memo', 'a2a', 'remote_execution', investmentDestinations.a2a!,
  );
  decision = evaluateDisclosure(state, a2aRequest);
  assert.equal(decision.disposition, 'approval_required');
  const forged = { id: 'approval:wrong', requestDigest: 'sha256:wrong', role: 'compliance', expiresAt: 5, decision: 'approved' } as const;
  assert.equal(evaluateDisclosure(state, { ...a2aRequest, approvals: [forged] } as never).disposition, 'approval_required');
  const exact = { ...forged, id: 'approval:exact', requestDigest: decision.requestDigest };
  assert.throws(() => dispatchGovernance(journal, {
    type: 'record_disclosure_approval', actor: ingressGateway, approval: exact,
  }), /compliance authority/u);
  journal = dispatchGovernance(journal, {
    type: 'record_disclosure_approval', actor: compliance, approval: exact,
  });
  state = replayGovernance(journal);
  const approvedDecision = evaluateDisclosure(state, a2aRequest);
  assert.equal(approvedDecision.disposition, 'allow_full');
  const materialized = materializeDisclosure(state, a2aRequest, approvedDecision);
  assert.equal(materialized.manifest.sourcePayloadHash, state.objects['data:research-memo']?.descriptor.payloadHash);
  assert.match(materialized.manifest.disclosedContentHash, /^sha256:/u);
  journal = dispatchGovernance(journal, {
    type: 'record_manifest', actor: disclosureGateway, manifest: materialized.manifest,
  });
  state = replayGovernance(journal);
  assert.equal(Object.keys(state.manifests).length, 1);

  const staleEnvelope = { ...a2aRequest.envelope, governancePolicyRevision: policy.revision - 1 };
  const stale = evaluateDisclosure(state, { ...a2aRequest, envelope: staleEnvelope });
  assert.equal(stale.disposition, 'deny');
  assert.equal(stale.reasons.includes('governance_policy_stale'), true);
}

// Retention Hold blocks purge but never grants disclosure. Purge is a durable,
// multi-location plan: unknown location outcome prevents payload deletion, while
// the content-free descriptor/hash/provenance remains after confirmed purge.
{
  const policy = supportPolicy();
  let journal = initialGovernanceJournal(policy);
  journal = register(journal, supportObjects()[0]!);
  journal = dispatchGovernance(journal, {
    type: 'place_hold', actor: dataSteward,
    hold: { id: 'hold:case', objectId: 'data:support-case', owner: dataSteward.id, reason: 'active dispute', reviewAt: 5 },
  });
  journal = dispatchGovernance(journal, {
    type: 'request_erasure', actor: privacyOperator,
    request: { id: 'erase:customer', subjectRef: 'subject:customer:7f3', requestedBy: privacyOperator.id, requestedAt: 0 },
  });
  assert.equal(erasureStatus(replayGovernance(journal), 'erase:customer'), 'blocked_by_hold');
  journal = dispatchGovernance(journal, { type: 'advance_clock', actor: governanceKernel, ticks: 10 });
  const before = journal.length;
  journal = dispatchGovernance(journal, { type: 'plan_lifecycle', actor: governanceKernel });
  assert.equal(journal.length, before, 'reviewAt overdue must not silently release a Retention Hold');
  journal = dispatchGovernance(journal, { type: 'release_hold', actor: dataSteward, holdId: 'hold:case' });
  journal = dispatchGovernance(journal, { type: 'plan_lifecycle', actor: governanceKernel });
  let state = replayGovernance(journal);
  assert.equal(state.objects['data:support-case']?.status, 'purge_pending');
  const blockedDisclosure = evaluateDisclosure(state, disclosure(
    policy, 'data:support-case', 'console', 'audit', supportDestinations.console!,
  ));
  assert.equal(blockedDisclosure.disposition, 'deny');
  journal = dispatchGovernance(journal, {
    type: 'record_purge_receipt', actor: storageGateway,
    receipt: { id: 'receipt:primary', objectId: 'data:support-case', location: 'payload-vault:primary', outcome: 'purged' },
  });
  journal = dispatchGovernance(journal, {
    type: 'record_purge_receipt', actor: storageGateway,
    receipt: { id: 'receipt:index:unknown', objectId: 'data:support-case', location: 'search-index:support', outcome: 'outcome_unknown' },
  });
  state = replayGovernance(journal);
  assert.equal(erasureStatus(state, 'erase:customer'), 'reconciliation');
  assert.equal(state.objects['data:support-case']?.payload !== undefined, true);
  journal = dispatchGovernance(journal, {
    type: 'record_purge_receipt', actor: storageGateway,
    receipt: { id: 'receipt:index:confirmed', objectId: 'data:support-case', location: 'search-index:support', outcome: 'purged' },
  });
  state = replayGovernance(journal);
  assert.equal(erasureStatus(state, 'erase:customer'), 'completed');
  assert.equal(state.objects['data:support-case']?.payload, undefined);
  assert.match(state.objects['data:support-case']!.descriptor.payloadHash, /^sha256:/u);
  assert.equal(state.objects['data:support-case']?.status, 'purged');
}

// A regulated minimum retention blocks early erasure. Unknown classification is
// quarantined and unavailable to every consumer until a trusted classifier
// creates a new classified object/revision.
{
  const policy = investmentPolicy();
  let journal = initialGovernanceJournal(policy);
  journal = register(journal, investmentObjects()[0]!);
  journal = dispatchGovernance(journal, {
    type: 'request_erasure', actor: privacyOperator,
    request: { id: 'erase:investor', subjectRef: 'subject:investor:19', requestedBy: privacyOperator.id, requestedAt: 0 },
  });
  assert.equal(erasureStatus(replayGovernance(journal), 'erase:investor'), 'blocked_minimum_retention');
  journal = dispatchGovernance(journal, { type: 'advance_clock', actor: governanceKernel, ticks: 20 });
  journal = dispatchGovernance(journal, { type: 'plan_lifecycle', actor: governanceKernel });
  assert.equal(replayGovernance(journal).objects['data:positions']?.status, 'purge_pending');

  const support = supportPolicy();
  let unknownJournal = initialGovernanceJournal(support);
  unknownJournal = register(unknownJournal, {
    id: 'data:unknown', tenantId: support.tenantId, projectId: support.projectId, kind: 'artifact',
    payload: 'unclassified imported bytes', proposedClassification: 'unknown', categories: [],
    allowedPurposes: ['audit'], allowedRegions: ['eu-west'], retentionClass: 'transient', subjectRefs: [],
    locations: ['quarantine:primary'],
  });
  const unknownState = replayGovernance(unknownJournal);
  assert.equal(unknownState.objects['data:unknown']?.status, 'quarantined');
  assert.equal(evaluateDisclosure(unknownState, disclosure(
    support, 'data:unknown', 'console', 'audit', supportDestinations.console!,
  )).disposition, 'deny');
}

console.log('data governance scenarios: ok');
