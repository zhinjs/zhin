import { describe, expect, it, vi } from 'vitest';
import type { WorkroomEffectIntent, WorkroomEffectState } from '../../src/workroom/effect-ledger.js';
import {
  PayloadProcessorRecallEffectAdapter,
  WorkroomPayloadEffectGatewayRouter,
  type PayloadProcessorRecallEffectFacts,
  type PayloadPurgeReceiptIssuerPort,
} from '../../src/plugin-runtime/workroom-payload-processor-recall.js';
import type { PayloadPurgeDispatch, PayloadPurgeReceipt } from '../../src/data-governance/payload-lifecycle.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

describe('Payload processor recall P8 Effect adapter', () => {
  it('persists one exact content-free Effect and cannot claim deletion while it is pending', async () => {
    const dispatch = purgeDispatch();
    const record = vi.fn(async (intent: WorkroomEffectIntent): Promise<WorkroomEffectState> => ({
      projectId: 'project-1', sequence: 0, status: 'pending_authorization', intent,
    }));
    const adapter = new PayloadProcessorRecallEffectAdapter({
      effects: { record }, facts: { resolve: async () => effectFacts(dispatch) },
      receipts: receiptIssuer(),
    });

    const receipt = await adapter.purge(dispatch, signal());
    expect(receipt).toMatchObject({
      status: 'outcome_unknown', reasonCode: 'unknown_external_copy',
      purgeId: dispatch.id, attempt: dispatch.attempt, fence: dispatch.fence,
    });
    expect(record).toHaveBeenCalledOnce();
    const intent = record.mock.calls[0]![0];
    expect(intent.operation).toEqual({ kind: 'processor_recall', parameters: {
      purgeId: dispatch.id, objectId: 'object-1', locationId: 'processor:crm',
      locationAuthorityDigest: dispatch.location.authorityDigest,
      locationManifestDigest: dispatch.locationManifestDigest,
      attempt: 1, fence: 1, requestDigest: dispatch.requestDigest,
    } });
    expect(JSON.stringify(intent)).not.toContain('customer transcript');
  });

  it('emits confirmed only from an authenticated committed P8 receipt and rejects stale facts', async () => {
    const dispatch = purgeDispatch();
    const adapter = new PayloadProcessorRecallEffectAdapter({
      effects: { record: async intent => committed(intent) },
      facts: { resolve: async () => effectFacts(dispatch) }, receipts: receiptIssuer(),
    });
    await expect(adapter.purge(dispatch, signal())).resolves.toMatchObject({
      status: 'confirmed', authenticatedBy: 'processor-provider:crm',
    });

    const stale = { ...effectFacts(dispatch), dispatchDigest: sha('forged') };
    const denied = new PayloadProcessorRecallEffectAdapter({
      effects: { record: vi.fn() }, facts: { resolve: async () => stale }, receipts: receiptIssuer(),
    });
    await expect(denied.purge(dispatch, signal())).rejects.toThrow('unavailable or stale');
  });

  it('enforces the generation provider contract across execute and reconciliation', async () => {
    const dispatch = purgeDispatch();
    let captured: WorkroomEffectIntent | undefined;
    const adapter = new PayloadProcessorRecallEffectAdapter({
      effects: { record: async intent => {
        captured = intent;
        return { projectId: 'project-1', sequence: 0, status: 'pending_authorization', intent };
      } },
      facts: { resolve: async () => effectFacts(dispatch) }, receipts: receiptIssuer(),
    });
    await adapter.purge(dispatch, signal());
    if (!captured) throw new Error('processor Effect Intent was not captured');
    const state = executing(captured);
    const providerIdentity = { id: 'processor:crm', digest: sha('provider') };
    const provider = {
      provider: providerIdentity,
      prepare: vi.fn(async () => undefined),
      execute: vi.fn(async () => gatewayReceipt(state, 'outcome_unknown', providerIdentity)),
      reconcile: vi.fn(async () => gatewayReceipt(state, 'committed', providerIdentity)),
    };
    const fallback = { execute: vi.fn(), reconcile: vi.fn() };
    const router = new WorkroomPayloadEffectGatewayRouter({
      fallback, resolveProcessor: () => provider,
    });

    await router.prepare(state, signal());
    await expect(router.execute(state, signal())).resolves.toMatchObject({ outcome: 'outcome_unknown' });
    await expect(router.reconcile(state, signal())).resolves.toMatchObject({ outcome: 'committed' });
    expect(provider.prepare).toHaveBeenCalledOnce();
    expect(fallback.execute).not.toHaveBeenCalled();

    await expect(new WorkroomPayloadEffectGatewayRouter({
      fallback, resolveProcessor: () => undefined,
    }).execute(state, signal())).rejects.toThrow('unavailable');
    const forged = { ...provider, execute: async () => gatewayReceipt(
      state, 'committed', { id: 'processor:forged', digest: sha('forged') },
    ) };
    await expect(new WorkroomPayloadEffectGatewayRouter({
      fallback, resolveProcessor: () => forged,
    }).execute(state, signal())).rejects.toThrow('binding drift');
  });
});

function purgeDispatch(): PayloadPurgeDispatch {
  const clock = { version: 1 as const, now: 10, revision: 1 };
  const clockSnapshot = { ...clock, digest: digest(clock) };
  const requestBody = {
    version: 1 as const, action: 'schedule_retention_purge' as const,
    requiredRole: 'data_steward' as const, operationId: 'purge:1',
    authenticatedPrincipalId: 'steward:1', tenantId: 'tenant-1', projectId: 'project-1',
    objectId: 'object-1', objectAuthorityDigest: sha('object-authority'),
    currentStateDigest: sha('state'), candidateDigest: sha('candidate'), clock: clockSnapshot,
  };
  const request = { ...requestBody, digest: digest(requestBody) };
  const decision = { approved: true as const, requestDigest: request.digest,
    decisionId: 'decision:purge', principalId: 'steward:1', role: 'data_steward' as const,
    authorityDigest: sha('decision-authority'), decidedAt: 10 };
  const body = {
    id: 'purge:processor:crm', reason: 'retention_expired' as const,
    objectAuthorityDigest: request.objectAuthorityDigest,
    locationManifestDigest: sha('manifest'),
    location: { id: 'processor:crm', kind: 'processor' as const,
      authorityDigest: sha('processor-authority'), deletionMode: 'processor_recall' as const },
    attempt: 1, fence: 1, requestedAt: 10, requestDigest: request.digest,
    governance: { request, decision },
  };
  return { ...body, digest: digest(body) };
}

function effectFacts(dispatch: PayloadPurgeDispatch): PayloadProcessorRecallEffectFacts & { dispatchDigest: string } {
  const body = {
    version: 1 as const, dispatchDigest: dispatch.digest, runId: 'lifecycle:project-1',
    taskKey: 'payload-purge:object-1', taskRevision: 1,
    capability: { ref: 'processor-recall:crm', digest: sha('capability') },
    target: { ref: dispatch.location.id, digest: dispatch.location.authorityDigest },
    preconditions: [{ ref: 'location-manifest', digest: dispatch.locationManifestDigest }],
    risk: { assessmentRef: 'risk:purge', assessmentDigest: sha('risk'), tier: 'high' as const },
    createdAt: dispatch.requestedAt, authorityDigest: sha('facts-authority'),
  };
  return { ...body, digest: digest(body) };
}

function receiptIssuer(): PayloadPurgeReceiptIssuerPort {
  return {
    issue: async ({ dispatch, providerReceiptRef, providerReceiptDigest, ...observation }) => {
      const body = {
        version: 1 as const, purgeId: dispatch.id, projectId: dispatch.governance.request.projectId,
        objectId: dispatch.governance.request.objectId, locationId: dispatch.location.id,
        locationAuthorityDigest: dispatch.location.authorityDigest,
        locationManifestDigest: dispatch.locationManifestDigest,
        attempt: dispatch.attempt, fence: dispatch.fence, requestDigest: dispatch.requestDigest,
        status: observation.status,
        ...(observation.reasonCode ? { reasonCode: observation.reasonCode } : {}),
        authenticatedBy: observation.authenticatedBy, observedAt: observation.observedAt,
        authorityDigest: digest({ dispatch: dispatch.digest, providerReceiptRef, providerReceiptDigest }),
      };
      const receipt: PayloadPurgeReceipt = { ...body, digest: digest(body) };
      return receipt;
    },
    verify: async (receipt, dispatch) => receipt.purgeId === dispatch.id
      && receipt.authorityDigest === digest({
        dispatch: dispatch.digest,
        providerReceiptRef: receipt.status === 'confirmed' ? 'processor:remote:1' : `effect-state:${effectId(dispatch)}`,
        providerReceiptDigest: receipt.status === 'confirmed' ? sha('provider-receipt') : digest({
          effectId: effectId(dispatch), effectStatus: 'pending_authorization', sequence: 0,
        }),
      }),
  };
}

function committed(intent: WorkroomEffectIntent): WorkroomEffectState {
  return {
    projectId: 'project-1', sequence: 2, status: 'committed', intent,
    receipt: {
      version: 1, receiptId: 'receipt:p8', intentId: intent.id, intentDigest: intent.digest,
      authorizationDigest: sha('authorization'), attemptId: 'attempt:1', fence: 1,
      provider: { id: 'processor:crm', digest: sha('provider') }, outcome: 'committed',
      remoteRef: 'processor:remote:1', remoteDigest: sha('provider-receipt'),
      observedAt: 20, authenticatedBy: 'processor-provider:crm',
    },
  };
}

function executing(intent: WorkroomEffectIntent): WorkroomEffectState {
  return {
    projectId: 'project-1', sequence: 1, status: 'executing', intent,
    authorization: { version: 1, authorized: true, intentId: intent.id, intentDigest: intent.digest,
      candidateHash: intent.candidateHash, authorizationId: 'authorization:1',
      authorizationDigest: sha('authorization'), policy: { id: 'policy:p8', revision: 1, digest: sha('policy') },
      authorizedBy: 'sponsor:1', expiresAt: 100 },
    attempt: { id: 'attempt:1', operationId: 'operation:1', workerId: 'worker:1', fence: 1,
      startedAt: 11, idempotencyKey: intent.idempotencyKey, intentDigest: intent.digest,
      authorizationDigest: sha('authorization') },
  };
}

function gatewayReceipt(
  state: WorkroomEffectState,
  outcome: 'committed' | 'outcome_unknown',
  provider: Readonly<{ id: string; digest: string }>,
) {
  return {
    version: 1 as const, receiptId: `receipt:${outcome}`, intentId: state.intent.id,
    intentDigest: state.intent.digest, authorizationDigest: state.authorization!.authorizationDigest,
    attemptId: state.attempt!.id, fence: state.attempt!.fence, provider, outcome,
    remoteRef: 'processor:remote:1', remoteDigest: sha(outcome), observedAt: 20,
    authenticatedBy: provider.id,
  };
}

function effectId(dispatch: PayloadPurgeDispatch): string {
  const facts = effectFacts(dispatch);
  // Deterministic reconstruction is intentionally local to the test issuer.
  const operation = { kind: 'processor_recall' as const, parameters: {
    purgeId: dispatch.id, objectId: 'object-1', locationId: dispatch.location.id,
    locationAuthorityDigest: dispatch.location.authorityDigest,
    locationManifestDigest: dispatch.locationManifestDigest,
    attempt: 1, fence: 1, requestDigest: dispatch.requestDigest,
  } };
  const body = { version: 1 as const, projectId: 'project-1', runId: facts.runId,
    taskKey: facts.taskKey, taskRevision: 1, candidateHash: dispatch.objectAuthorityDigest,
    capability: facts.capability, operation, target: facts.target, preconditions: facts.preconditions,
    risk: facts.risk, reversibility: { kind: 'irreversible' as const },
    idempotencyKey: `payload-processor-recall:${dispatch.id}:1:1`, createdAt: 10 };
  return `effect:${digest(body)}`;
}

function sha(seed: string): string { return digest({ seed }); }
function signal(): AbortSignal { return new AbortController().signal; }
