import { createToken } from '@zhin.js/plugin-runtime';
import type { WorkroomEffectGatewayReceipt, WorkroomEffectState } from '../workroom/effect-ledger.js';
import { deepFreezeWorkroomValue as freeze, digestCanonicalWorkroomValue as digest } from '../workroom/canonical-value.js';
import type { WorkroomEffectGatewayPort } from './workroom-effect-runtime.js';

export interface WorkroomDeliveryTarget {
  readonly repositoryId: string;
  readonly headSha: string;
  readonly artifactDigest: string;
  readonly environment: string;
  readonly pipelineRef: string;
}

/** Authenticated CI evidence, resolved by a trusted provider, never by the model. */
export interface WorkroomDeliveryReadiness {
  readonly target: WorkroomDeliveryTarget;
  readonly candidateHash: string;
  readonly targetDigest: string;
  readonly evidenceRef: string;
  readonly evidenceDigest: string;
  readonly checks: readonly Readonly<{ id: string; status: 'passed' | 'failed' | 'pending' }>[];
  readonly observedAt: number;
  readonly expiresAt: number;
}

export interface WorkroomDeliveryRequest {
  readonly projectId: string;
  readonly effectId: string;
  readonly intentDigest: string;
  readonly candidateHash: string;
  readonly target: WorkroomDeliveryTarget;
  readonly targetRef: string;
  readonly targetDigest: string;
  readonly idempotencyKey: string;
}

export interface WorkroomDeliveryDispatch extends WorkroomDeliveryRequest {
  readonly attemptId: string;
  readonly fence: number;
  readonly authorizationDigest: string;
  readonly authorizationExpiresAt: number;
}

export interface WorkroomDeliveryObservation {
  readonly effectId: string;
  readonly intentDigest: string;
  readonly idempotencyKey: string;
  readonly target: WorkroomDeliveryTarget;
  readonly candidateHash: string;
  readonly deploymentRef: string;
  readonly receiptRef: string;
  readonly status: 'running' | 'succeeded' | 'failed' | 'unknown';
  readonly health: 'passed' | 'failed' | 'pending' | 'unknown';
  readonly observedAt: number;
  readonly authenticatedBy: string;
}

/**
 * Root-owned CI/CD connector. Credentials stay inside this port. dispatch must
 * atomically enforce the supplied target/evidence/authorization preconditions;
 * it must reject moved targets and deduplicate by idempotencyKey. inspect/query
 * are read-only. query must never submit, retry or roll back a deployment.
 */
export interface WorkroomDeliveryProviderPort {
  readonly provider: Readonly<{ id: string; digest: string }>;
  inspect(request: WorkroomDeliveryRequest, signal: AbortSignal): Promise<WorkroomDeliveryReadiness>;
  dispatch(request: WorkroomDeliveryDispatch & Readonly<{
    evidenceRef: string;
    evidenceDigest: string;
  }>, signal: AbortSignal): Promise<WorkroomDeliveryObservation>;
  query(request: WorkroomDeliveryDispatch, signal: AbortSignal): Promise<WorkroomDeliveryObservation>;
}

export const workroomDeliveryProviderToken = createToken<WorkroomDeliveryProviderPort>(
  'zhin.agent.workroom-delivery-provider',
  'Generation-owned exact-artifact CI/CD and deployment health evidence provider',
);

/** Uses the existing Effect outbox; no second delivery state machine. */
export class WorkroomDeliveryGateway implements WorkroomEffectGatewayPort {
  constructor(readonly options: Readonly<{
    resolveProvider: () => WorkroomDeliveryProviderPort | undefined;
    now?: () => number;
  }>) {}

  async prepare(state: WorkroomEffectState, signal: AbortSignal): Promise<void> {
    const provider = this.#provider(state);
    await this.#readiness(provider, request(state), state, signal);
  }

  async execute(state: WorkroomEffectState, signal: AbortSignal): Promise<WorkroomEffectGatewayReceipt> {
    signal.throwIfAborted();
    const provider = this.#provider(state);
    const command = dispatch(state);
    const evidence = await this.#readiness(provider, command, state, signal);
    signal.throwIfAborted();
    if (command.authorizationExpiresAt <= this.#now()) throw new Error('Delivery authorization expired');
    const observation = await provider.dispatch(freeze({
      ...command, evidenceRef: evidence.evidenceRef, evidenceDigest: evidence.evidenceDigest,
    }), signal);
    return this.#receipt(provider, state, observation);
  }

  async reconcile(state: WorkroomEffectState, signal: AbortSignal): Promise<WorkroomEffectGatewayReceipt> {
    signal.throwIfAborted();
    const provider = this.#provider(state);
    // Expired approval / moved current head does not erase the original effect.
    return this.#receipt(provider, state, await provider.query(dispatch(state), signal));
  }

  #now(): number { return (this.options.now ?? Date.now)(); }

  #provider(state: WorkroomEffectState): WorkroomDeliveryProviderPort {
    request(state);
    const provider = this.options.resolveProvider();
    if (!provider) throw new Error('Trusted delivery provider is unavailable');
    if (provider.provider.id !== state.intent.capability.ref
      || provider.provider.digest !== state.intent.capability.digest) {
      throw new Error('Delivery provider capability binding drift');
    }
    return provider;
  }

  async #readiness(
    provider: WorkroomDeliveryProviderPort, input: WorkroomDeliveryRequest,
    state: WorkroomEffectState, signal: AbortSignal,
  ): Promise<WorkroomDeliveryReadiness> {
    signal.throwIfAborted();
    const evidence = await provider.inspect(input, signal);
    const now = this.#now();
    if (digest(evidence.target) !== digest(input.target)
      || evidence.candidateHash !== input.candidateHash || evidence.targetDigest !== input.targetDigest
      || !state.intent.preconditions.some(item => item.ref === evidence.evidenceRef && item.digest === evidence.evidenceDigest)
      || !validTime(evidence.observedAt) || !validTime(evidence.expiresAt)
      || evidence.observedAt > now || evidence.expiresAt <= now
      || !Array.isArray(evidence.checks) || evidence.checks.length === 0
      || evidence.checks.some(check => !check.id?.trim() || check.status !== 'passed')
      || new Set(evidence.checks.map(check => check.id)).size !== evidence.checks.length) {
      throw new Error('Delivery CI evidence is missing, stale, failed or bound to another candidate');
    }
    return freeze(structuredClone(evidence));
  }

  #receipt(
    provider: WorkroomDeliveryProviderPort, state: WorkroomEffectState, observation: WorkroomDeliveryObservation,
  ): WorkroomEffectGatewayReceipt {
    const command = dispatch(state);
    if (observation.effectId !== command.effectId || observation.intentDigest !== command.intentDigest
      || observation.idempotencyKey !== command.idempotencyKey
      || observation.candidateHash !== command.candidateHash
      || digest(observation.target) !== digest(command.target)
      || !observation.deploymentRef?.trim() || !observation.receiptRef?.trim()
      || !observation.authenticatedBy?.trim() || !validTime(observation.observedAt)
      || observation.observedAt < Math.max(state.attempt!.startedAt, state.receipt?.observedAt ?? 0)
      || observation.observedAt > this.#now()
      || !['running', 'succeeded', 'failed', 'unknown'].includes(observation.status)
      || !['passed', 'failed', 'pending', 'unknown'].includes(observation.health)) {
      throw new Error('Delivery observation binding drift');
    }
    const outcome = observation.status === 'failed'
      || (observation.status === 'succeeded' && observation.health === 'failed') ? 'failed'
      : observation.status === 'succeeded' && observation.health === 'passed' ? 'committed' : 'outcome_unknown';
    const remoteDigest = digest(observation);
    return freeze({
      version: 1, receiptId: `delivery-receipt:${command.attemptId}:${remoteDigest}`,
      intentId: command.effectId, intentDigest: command.intentDigest,
      authorizationDigest: command.authorizationDigest, attemptId: command.attemptId, fence: command.fence,
      provider: provider.provider, outcome, remoteRef: observation.receiptRef, remoteDigest,
      observedAt: observation.observedAt, authenticatedBy: observation.authenticatedBy,
    });
  }
}

export class WorkroomDeliveryGatewayRouter implements WorkroomEffectGatewayPort {
  constructor(readonly delivery: WorkroomDeliveryGateway, readonly fallback: WorkroomEffectGatewayPort) {}
  #for(state: WorkroomEffectState): WorkroomEffectGatewayPort {
    return state.intent.operation.kind === 'delivery_release' ? this.delivery : this.fallback;
  }
  async prepare(state: WorkroomEffectState, signal: AbortSignal): Promise<void> {
    await this.#for(state).prepare?.(state, signal);
  }
  execute(state: WorkroomEffectState, signal: AbortSignal): Promise<WorkroomEffectGatewayReceipt> {
    return this.#for(state).execute(state, signal);
  }
  reconcile(state: WorkroomEffectState, signal: AbortSignal): Promise<WorkroomEffectGatewayReceipt> {
    return this.#for(state).reconcile(state, signal);
  }
}

function request(state: WorkroomEffectState): WorkroomDeliveryRequest {
  if (state.intent.operation.kind !== 'delivery_release') throw new Error('Expected delivery_release Effect');
  return freeze({
    projectId: state.projectId, effectId: state.intent.id, intentDigest: state.intent.digest,
    candidateHash: state.intent.candidateHash, target: state.intent.operation.parameters,
    targetRef: state.intent.target.ref, targetDigest: state.intent.target.digest,
    idempotencyKey: state.intent.idempotencyKey,
  });
}

function dispatch(state: WorkroomEffectState): WorkroomDeliveryDispatch {
  if (!state.authorization || !state.attempt || !['executing', 'outcome_unknown'].includes(state.status)) {
    throw new Error('Delivery requires a durable authorized attempt');
  }
  return freeze({
    ...request(state), attemptId: state.attempt.id, fence: state.attempt.fence,
    authorizationDigest: state.authorization.authorizationDigest,
    authorizationExpiresAt: state.authorization.expiresAt,
  });
}

function validTime(value: number): boolean { return Number.isSafeInteger(value) && value >= 0; }
