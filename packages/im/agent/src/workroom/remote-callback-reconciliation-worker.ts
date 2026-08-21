import {
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';
import {
  digestRemoteCallbackMessage,
  digestRemoteCallbackReconciliationBatch,
  type RemoteCallbackEnvelope,
  type RemoteCallbackInboxProjection,
  type RemoteCallbackReconciliationReceipt,
  type RemoteExecutionLink,
} from './remote-callback-inbox.js';

export interface RemoteCallbackPollRequest {
  readonly version: 1;
  readonly linkId: string;
  readonly endpointId: string;
  readonly cardDigest: string;
  readonly authBindingId: string;
  readonly remoteTaskId: string;
  readonly remoteContextId: string;
  readonly fromCursor: number;
  readonly reconcileDeadline: number;
}

export interface RemoteCallbackPollSnapshotInput {
  readonly version: 1;
  readonly endpointId: string;
  readonly cardDigest: string;
  readonly authBindingId: string;
  readonly linkId: string;
  readonly fromCursor: number;
  readonly snapshotCursor: number;
  readonly polledAt: number;
  readonly callbacks: readonly RemoteCallbackEnvelope[];
}

export interface RemoteCallbackPollSnapshot extends RemoteCallbackPollSnapshotInput {
  readonly digest: string;
}

export interface RemoteCallbackPollPort {
  poll(
    request: RemoteCallbackPollRequest,
    signal: AbortSignal,
  ): Promise<RemoteCallbackPollSnapshot>;
}

export interface RemoteCallbackReconciliationClock {
  now(): number;
}

export interface RemoteCallbackReconciliationInboxPort {
  readonly link: RemoteExecutionLink;
  read(): Promise<RemoteCallbackInboxProjection | undefined>;
  reconcile(
    callbacks: readonly RemoteCallbackEnvelope[],
    expectedSequence: number,
    receipt: RemoteCallbackReconciliationReceipt,
  ): Promise<RemoteCallbackInboxProjection>;
}

export type RemoteCallbackReconciliationWorkerOutcome =
  | Readonly<{
    status: 'reconciled';
    snapshotDigest: string;
    projection: RemoteCallbackInboxProjection;
  }>
  | Readonly<{
    status: 'noop';
    reason: 'not_registered' | 'not_required';
    projection?: RemoteCallbackInboxProjection;
  }>
  | Readonly<{
    status: 'expired';
    deadline: number;
    observedAt: number;
    projection: RemoteCallbackInboxProjection;
  }>;

export interface RunRemoteCallbackReconciliationOnceOptions {
  readonly inbox: RemoteCallbackReconciliationInboxPort;
  readonly pollPort: RemoteCallbackPollPort;
  readonly clock: RemoteCallbackReconciliationClock;
  readonly signal: AbortSignal;
}

export function digestRemoteCallbackPollSnapshot(
  input: RemoteCallbackPollSnapshotInput,
): string {
  return digest({
    version: input.version,
    endpointId: input.endpointId,
    cardDigest: input.cardDigest,
    authBindingId: input.authBindingId,
    linkId: input.linkId,
    fromCursor: input.fromCursor,
    snapshotCursor: input.snapshotCursor,
    polledAt: input.polledAt,
    callbacks: input.callbacks,
  });
}

export async function runRemoteCallbackReconciliationOnce({
  inbox,
  pollPort,
  clock,
  signal,
}: RunRemoteCallbackReconciliationOnceOptions): Promise<RemoteCallbackReconciliationWorkerOutcome> {
  signal.throwIfAborted();
  const current = await inbox.read();
  if (!current) return deepFreeze({ status: 'noop', reason: 'not_registered' });
  if (current.status !== 'reconcile_required') {
    return deepFreeze({ status: 'noop', reason: 'not_required', projection: current });
  }
  const observedAt = timestamp(clock.now(), 'clock.now');
  if (observedAt > inbox.link.reconcileDeadline) {
    return deepFreeze({
      status: 'expired',
      deadline: inbox.link.reconcileDeadline,
      observedAt,
      projection: current,
    });
  }
  const request = deepFreeze({
    version: 1 as const,
    linkId: inbox.link.id,
    endpointId: inbox.link.endpoint.id,
    cardDigest: inbox.link.endpoint.cardDigest,
    authBindingId: inbox.link.endpoint.authBindingId,
    remoteTaskId: inbox.link.remoteTaskId,
    remoteContextId: inbox.link.remoteContextId,
    fromCursor: current.callbackCursor,
    reconcileDeadline: inbox.link.reconcileDeadline,
  });
  signal.throwIfAborted();
  const polling = Promise.resolve().then(async () => {
    signal.throwIfAborted();
    return await pollPort.poll(request, signal);
  });
  const snapshot = normalizePollSnapshot(await raceAbort(polling, signal));
  validatePollSnapshot(snapshot, inbox.link, current);
  if (snapshot.polledAt > inbox.link.reconcileDeadline) {
    return deepFreeze({
      status: 'expired',
      deadline: inbox.link.reconcileDeadline,
      observedAt: snapshot.polledAt,
      projection: current,
    });
  }
  const callbackDigests = snapshot.callbacks.map(item => item.gatewayReceipt.callbackDigest);
  const receiptInput = {
    receiptId: `remote-callback-poll:${snapshot.digest}`,
    source: 'poll' as const,
    reconciledAt: snapshot.polledAt,
    endpointId: snapshot.endpointId,
    cardDigest: snapshot.cardDigest,
    authBindingId: snapshot.authBindingId,
    linkId: snapshot.linkId,
    fromCursor: snapshot.fromCursor,
    snapshotCursor: snapshot.snapshotCursor,
    callbackDigests,
  };
  const receipt = deepFreeze({
    ...receiptInput,
    batchDigest: digestRemoteCallbackReconciliationBatch(receiptInput),
  });
  signal.throwIfAborted();
  const projection = await inbox.reconcile(snapshot.callbacks, current.sequence, receipt);
  return deepFreeze({
    status: 'reconciled',
    snapshotDigest: snapshot.digest,
    projection,
  });
}

function normalizePollSnapshot(value: unknown): RemoteCallbackPollSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Remote Callback poll snapshot must be an object');
  }
  assertExactKeys(value, [
    'version', 'endpointId', 'cardDigest', 'authBindingId', 'linkId',
    'fromCursor', 'snapshotCursor', 'polledAt', 'callbacks', 'digest',
  ], 'poll snapshot');
  const snapshot = structuredClone(value) as RemoteCallbackPollSnapshot;
  if (snapshot.version !== 1 || !Array.isArray(snapshot.callbacks)) {
    throw new Error('Remote Callback poll snapshot schema is invalid');
  }
  requireDigest(snapshot.digest, 'snapshot.digest');
  const { digest: _digest, ...input } = snapshot;
  if (snapshot.digest !== digestRemoteCallbackPollSnapshot(input)) {
    throw new Error('Remote Callback poll snapshot canonical digest is invalid');
  }
  return deepFreeze(snapshot);
}

function validatePollSnapshot(
  snapshot: RemoteCallbackPollSnapshot,
  link: RemoteExecutionLink,
  current: RemoteCallbackInboxProjection,
): void {
  const exactBindings = [
    ['endpointId', snapshot.endpointId, link.endpoint.id],
    ['cardDigest', snapshot.cardDigest, link.endpoint.cardDigest],
    ['authBindingId', snapshot.authBindingId, link.endpoint.authBindingId],
    ['linkId', snapshot.linkId, link.id],
    ['fromCursor', snapshot.fromCursor, current.callbackCursor],
  ] as const;
  const drift = exactBindings.find(([, actual, expected]) => actual !== expected);
  if (drift) throw new Error(`Remote Callback poll snapshot ${drift[0]} does not match trusted state`);
  timestamp(snapshot.polledAt, 'snapshot.polledAt');
  nonNegativeInteger(snapshot.fromCursor, 'snapshot.fromCursor');
  nonNegativeInteger(snapshot.snapshotCursor, 'snapshot.snapshotCursor');
  const expectedSnapshotCursor = Math.max(
    current.callbackCursor,
    ...current.deferred.map(item => item.callbackSequence),
    ...snapshot.callbacks.map(item => item.callbackSequence),
  );
  if (snapshot.snapshotCursor !== expectedSnapshotCursor) {
    throw new Error('Remote Callback poll snapshot snapshotCursor does not match the exact batch');
  }
  const callbackDigests = new Set<string>();
  snapshot.callbacks.forEach((callback, index) => {
    const receipt = callback?.gatewayReceipt;
    if (!receipt || typeof receipt !== 'object') {
      throw new Error(`Remote Callback poll Gateway receipt ${index} is missing`);
    }
    assertExactKeys(receipt, [
      'receiptId', 'source', 'receivedAt', 'endpointId', 'cardDigest',
      'authBindingId', 'callbackDigest',
    ], 'poll Gateway receipt');
    if (typeof receipt.receiptId !== 'string' || !receipt.receiptId.trim()) {
      throw new Error(`Remote Callback poll Gateway receiptId ${index} is invalid`);
    }
    timestamp(receipt.receivedAt, `poll Gateway receivedAt ${index}`);
    if (receipt.source !== 'poll') {
      throw new Error(`Remote Callback poll Gateway source ${index} is not poll`);
    }
    for (const [name, actual, expected] of [
      ['endpointId', receipt.endpointId, link.endpoint.id],
      ['cardDigest', receipt.cardDigest, link.endpoint.cardDigest],
      ['authBindingId', receipt.authBindingId, link.endpoint.authBindingId],
    ] as const) {
      if (actual !== expected) {
        throw new Error(`Remote Callback poll Gateway ${name} does not match trusted state`);
      }
    }
    requireDigest(receipt.callbackDigest, `callbacks[${index}].gatewayReceipt.callbackDigest`);
    if (receipt.callbackDigest !== digestRemoteCallbackMessage(callback)) {
      throw new Error(`Remote Callback poll full callback digest ${index} is invalid`);
    }
    if (callbackDigests.has(receipt.callbackDigest)) {
      throw new Error('Remote Callback poll snapshot callback digests must be unique');
    }
    callbackDigests.add(receipt.callbackDigest);
  });
}

function assertExactKeys(value: object, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).find(key => !allowed.includes(key));
  if (unexpected) throw new Error(`Remote Callback ${label} contains forbidden field ${unexpected}`);
}

function requireDigest(value: unknown, label: string): void {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Remote Callback ${label} is invalid`);
  }
}

function timestamp(value: unknown, label: string): number {
  if (!Number.isFinite(value) || Number(value) < 0) {
    throw new Error(`Remote Callback ${label} is invalid`);
  }
  return Number(value);
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Remote Callback ${label} is invalid`);
  }
  return Number(value);
}

async function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  return await new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
