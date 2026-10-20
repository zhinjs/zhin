import { createToken } from '@zhin.js/plugin-runtime';
import {
  createWorkroomEffectIntent,
  type WorkroomEffectGatewayReceipt,
  type WorkroomEffectState,
} from '../workroom/effect-ledger.js';
import type { WorkroomEffectIntentWriterPort } from './workroom-effect-composition.js';
import type { WorkroomEffectGatewayPort } from './workroom-effect-runtime.js';
import type {
  PayloadLocationDeletionPort,
  PayloadPurgeDispatch,
  PayloadPurgeReceipt,
  PayloadPurgeReceiptAuthorityPort,
} from '../data-governance/payload-lifecycle.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';

export interface PayloadPurgeReceiptIssuerPort extends PayloadPurgeReceiptAuthorityPort {
  issue(input: Readonly<{
    dispatch: PayloadPurgeDispatch;
    status: PayloadPurgeReceipt['status'];
    reasonCode?: PayloadPurgeReceipt['reasonCode'];
    cryptoEraseReceiptDigest?: string;
    providerReceiptRef: string;
    providerReceiptDigest: string;
    authenticatedBy: string;
    observedAt: number;
  }>, signal: AbortSignal): Promise<PayloadPurgeReceipt>;
}

/** Root-only issuer. Ordinary plugins must never synthesize Lifecycle receipts. */
export const workroomPayloadPurgeReceiptIssuerToken = createToken<PayloadPurgeReceiptIssuerPort>(
  'zhin.agent.workroom-payload-purge-receipt-issuer',
  'Root trusted exact Payload purge receipt issuer and persisted-proof verifier',
);

export interface PayloadProcessorRecallEffectFacts {
  readonly version: 1;
  readonly dispatchDigest: string;
  readonly runId: string;
  readonly taskKey: string;
  readonly taskRevision: number;
  readonly capability: Readonly<{ ref: string; digest: string }>;
  readonly target: Readonly<{ ref: string; digest: string }>;
  readonly preconditions: readonly Readonly<{ ref: string; digest: string }>[];
  readonly risk: Readonly<{
    assessmentRef: string;
    assessmentDigest: string;
    tier: 'low' | 'medium' | 'high' | 'critical';
  }>;
  readonly createdAt: number;
  readonly authorityDigest: string;
  readonly digest: string;
}

export interface PayloadProcessorRecallEffectFactsPort {
  resolve(
    dispatch: PayloadPurgeDispatch,
    signal: AbortSignal,
  ): Promise<PayloadProcessorRecallEffectFacts | undefined>;
}

/** Trusted P8 admission facts; message metadata and model output cannot provide these. */
export const workroomPayloadProcessorRecallEffectFactsToken =
  createToken<PayloadProcessorRecallEffectFactsPort>(
    'zhin.agent.workroom-payload-processor-recall-effect-facts',
    'Root trusted P8 authorization facts for one exact processor recall dispatch',
  );

export interface PayloadProcessorRecallProviderPort extends WorkroomEffectGatewayPort {
  readonly provider: Readonly<{ id: string; digest: string }>;
}

/** Root-owned external processor capability; credentials remain inside it. */
export const workroomPayloadProcessorRecallProviderToken =
  createToken<PayloadProcessorRecallProviderPort>(
    'zhin.agent.workroom-payload-processor-recall-provider',
    'Generation-owned authenticated external processor recall capability',
  );

/** Routes the new P8 operation without weakening the existing Git gateway. */
export class WorkroomPayloadEffectGatewayRouter implements WorkroomEffectGatewayPort {
  constructor(readonly options: Readonly<{
    fallback: WorkroomEffectGatewayPort;
    resolveProcessor: () => PayloadProcessorRecallProviderPort | undefined;
  }>) {}

  async prepare(state: WorkroomEffectState, signal: AbortSignal): Promise<void> {
    const { gateway } = this.#gateway(state);
    await gateway.prepare?.(state, signal);
  }

  async execute(state: WorkroomEffectState, signal: AbortSignal): Promise<WorkroomEffectGatewayReceipt> {
    const selected = this.#gateway(state);
    return this.#assertReceipt(
      state, await selected.gateway.execute(state, signal), selected.processor,
    );
  }

  async reconcile(state: WorkroomEffectState, signal: AbortSignal): Promise<WorkroomEffectGatewayReceipt> {
    const selected = this.#gateway(state);
    return this.#assertReceipt(
      state, await selected.gateway.reconcile(state, signal), selected.processor,
    );
  }

  #gateway(state: WorkroomEffectState): Readonly<{
    gateway: WorkroomEffectGatewayPort;
    processor?: PayloadProcessorRecallProviderPort;
  }> {
    if (state.intent.operation.kind !== 'processor_recall') {
      return { gateway: this.options.fallback };
    }
    const provider = this.options.resolveProcessor();
    if (!provider) throw new Error('Generation-owned processor recall provider is unavailable');
    if (!provider.provider.id.trim() || !isDigest(provider.provider.digest)) {
      throw new Error('Processor recall provider identity is invalid');
    }
    return { gateway: provider, processor: provider };
  }

  #assertReceipt(
    state: WorkroomEffectState,
    receipt: WorkroomEffectGatewayReceipt,
    provider?: PayloadProcessorRecallProviderPort,
  ): WorkroomEffectGatewayReceipt {
    if (state.intent.operation.kind !== 'processor_recall') return receipt;
    if (!provider || receipt.intentId !== state.intent.id || receipt.intentDigest !== state.intent.digest
      || canonicalWorkroomJson(receipt.provider) !== canonicalWorkroomJson(provider.provider)) {
      throw new Error('Processor recall Effect gateway receipt binding drift');
    }
    return receipt;
  }
}

/**
 * Lifecycle deletion adapter backed by the durable P8 Effect ledger. A pending
 * or unknown Effect can only produce outcome_unknown, never a deletion claim.
 */
export class PayloadProcessorRecallEffectAdapter implements PayloadLocationDeletionPort {
  constructor(readonly options: Readonly<{
    effects: WorkroomEffectIntentWriterPort;
    facts: PayloadProcessorRecallEffectFactsPort;
    receipts: PayloadPurgeReceiptIssuerPort;
  }>) {}

  async purge(dispatch: PayloadPurgeDispatch, signal: AbortSignal): Promise<PayloadPurgeReceipt> {
    signal.throwIfAborted();
    if (dispatch.location.deletionMode !== 'processor_recall') {
      throw new Error('Processor recall Effect adapter received a different deletion mode');
    }
    const facts = await this.options.facts.resolve(dispatch, signal);
    assertFacts(facts, dispatch);
    const intent = createWorkroomEffectIntent({
      projectId: dispatch.governance.request.projectId,
      runId: facts.runId,
      taskKey: facts.taskKey,
      taskRevision: facts.taskRevision,
      candidateHash: dispatch.objectAuthorityDigest,
      capability: facts.capability,
      operation: {
        kind: 'processor_recall',
        parameters: {
          purgeId: dispatch.id,
          objectId: dispatch.governance.request.objectId,
          locationId: dispatch.location.id,
          locationAuthorityDigest: dispatch.location.authorityDigest,
          locationManifestDigest: dispatch.locationManifestDigest,
          attempt: dispatch.attempt,
          fence: dispatch.fence,
          requestDigest: dispatch.requestDigest,
        },
      },
      target: facts.target,
      preconditions: facts.preconditions,
      risk: facts.risk,
      reversibility: { kind: 'irreversible' },
      idempotencyKey: `payload-processor-recall:${dispatch.id}:${dispatch.attempt}:${dispatch.fence}`,
      createdAt: facts.createdAt,
    });
    const state = await this.options.effects.record(intent);
    assertEffectState(state, intent.id, dispatch);
    const observation = effectObservation(state);
    const receipt = await this.options.receipts.issue({
      dispatch,
      ...observation,
    }, signal);
    assertReceiptBinding(receipt, dispatch);
    if (!await this.options.receipts.verify(receipt, dispatch)) {
      throw new Error('Payload processor recall receipt issuer rejected its persisted proof');
    }
    return receipt;
  }
}

function assertFacts(
  facts: PayloadProcessorRecallEffectFacts | undefined,
  dispatch: PayloadPurgeDispatch,
): asserts facts is PayloadProcessorRecallEffectFacts {
  if (!facts || facts.version !== 1 || facts.dispatchDigest !== dispatch.digest
    || facts.digest !== digestWithout(facts) || !isDigest(facts.authorityDigest)
    || facts.target.ref !== dispatch.location.id
    || facts.target.digest !== dispatch.location.authorityDigest
    || canonicalWorkroomJson(facts.preconditions) !== canonicalWorkroomJson([{
      ref: 'location-manifest', digest: dispatch.locationManifestDigest,
    }])
    || !Number.isSafeInteger(facts.createdAt) || facts.createdAt < dispatch.requestedAt) {
    throw new Error('Trusted processor recall Effect facts are unavailable or stale');
  }
}

function assertEffectState(
  state: WorkroomEffectState,
  intentId: string,
  dispatch: PayloadPurgeDispatch,
): void {
  if (state.projectId !== dispatch.governance.request.projectId
    || state.intent.id !== intentId
    || state.intent.operation.kind !== 'processor_recall'
    || state.intent.operation.parameters.purgeId !== dispatch.id
    || state.intent.operation.parameters.attempt !== dispatch.attempt
    || state.intent.operation.parameters.fence !== dispatch.fence
    || (state.status === 'committed'
      && (!state.receipt || state.receipt.outcome !== 'committed'
        || state.receipt.intentId !== state.intent.id
        || state.receipt.intentDigest !== state.intent.digest))
    || (state.status === 'failed'
      && (!state.receipt || state.receipt.outcome !== 'failed'
        || state.receipt.intentId !== state.intent.id
        || state.receipt.intentDigest !== state.intent.digest))) {
    throw new Error('P8 processor recall Effect state binding drift');
  }
}

function effectObservation(state: WorkroomEffectState): Omit<
  Parameters<PayloadPurgeReceiptIssuerPort['issue']>[0], 'dispatch'
> {
  if (state.status === 'committed' && state.receipt) {
    return deepFreeze({
      status: 'confirmed' as const,
      providerReceiptRef: state.receipt.remoteRef,
      providerReceiptDigest: state.receipt.remoteDigest,
      authenticatedBy: state.receipt.authenticatedBy,
      observedAt: state.receipt.observedAt,
    });
  }
  if (state.status === 'failed' && state.receipt) {
    return deepFreeze({
      status: 'failed' as const,
      reasonCode: 'provider_denied' as const,
      providerReceiptRef: state.receipt.remoteRef,
      providerReceiptDigest: state.receipt.remoteDigest,
      authenticatedBy: state.receipt.authenticatedBy,
      observedAt: state.receipt.observedAt,
    });
  }
  return deepFreeze({
    status: 'outcome_unknown' as const,
    reasonCode: 'unknown_external_copy' as const,
    providerReceiptRef: state.receipt?.remoteRef ?? `effect-state:${state.intent.id}`,
    providerReceiptDigest: state.receipt?.remoteDigest ?? digest({
      effectId: state.intent.id, effectStatus: state.status, sequence: state.sequence,
    }),
    authenticatedBy: state.receipt?.authenticatedBy ?? 'p8-effect-ledger',
    observedAt: state.receipt?.observedAt ?? state.intent.createdAt,
  });
}

function assertReceiptBinding(receipt: PayloadPurgeReceipt, dispatch: PayloadPurgeDispatch): void {
  const { digest: supplied, ...body } = receipt;
  if (receipt.version !== 1 || receipt.purgeId !== dispatch.id
    || receipt.projectId !== dispatch.governance.request.projectId
    || receipt.objectId !== dispatch.governance.request.objectId
    || receipt.locationId !== dispatch.location.id
    || receipt.locationAuthorityDigest !== dispatch.location.authorityDigest
    || receipt.locationManifestDigest !== dispatch.locationManifestDigest
    || receipt.attempt !== dispatch.attempt || receipt.fence !== dispatch.fence
    || receipt.requestDigest !== dispatch.requestDigest
    || !isDigest(receipt.authorityDigest) || supplied !== digest(body)) {
    throw new Error('Payload processor recall receipt binding drift');
  }
}

function digestWithout<T extends Readonly<{ digest: string }>>(value: T): string {
  const { digest: _digest, ...body } = value;
  return digest(body);
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f\d]{64}$/u.test(value);
}
