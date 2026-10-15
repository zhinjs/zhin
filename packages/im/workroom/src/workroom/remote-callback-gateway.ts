import type {
  AssignmentExecutionObservation,
} from './assignment-executor.js';
import {
  canonicalWorkroomJson as stableJson,
  deepFreezeWorkroomValue as deepFreeze,
} from './canonical-value.js';
import {
  digestRemoteCallbackMessage,
  RemoteCallbackInbox,
  type RemoteCallbackInboxProjection,
  type RemoteCallbackInboxRepository,
  type RemoteCallbackMessage,
} from './remote-callback-inbox.js';
import {
  createRemoteExecutionLinkRecord,
  RemoteCallbackApplicationOutcome,
  RemoteExecutionLinkRegistryRepository,
} from './remote-callback-application.js';

export interface WorkroomCallbackEndpointAuthority {
  readonly version: 1;
  readonly endpointId: string;
  readonly tenantId: string;
  readonly cardDigest: string;
  readonly authBindingId: string;
  readonly trustDomain: string;
  readonly generation: number;
  readonly extensionDigest: string;
  readonly credentialIdDigest: string;
}

export interface WorkroomCallbackAuthRegistry {
  authenticate(credential: string): WorkroomCallbackEndpointAuthority;
}

export interface WorkroomCallbackClock {
  now(): number;
}

export interface WorkroomCallbackReceiptIdFactory {
  create(input: WorkroomCallbackReceiptIdentity): string;
}

export interface WorkroomCallbackReceiptIdentity {
  readonly endpointId: string;
  readonly linkId: string;
  readonly eventId: string;
  readonly callbackDigest: string;
  readonly receivedAt: number;
}

export interface WorkroomCallbackApplicationPort {
  runOnce(linkId: string, signal: AbortSignal): Promise<RemoteCallbackApplicationOutcome>;
}

export interface WorkroomRemoteCallbackGatewayOptions {
  readonly authRegistry: WorkroomCallbackAuthRegistry;
  readonly linkRegistry: Pick<RemoteExecutionLinkRegistryRepository, 'read'>;
  readonly inboxRepository: RemoteCallbackInboxRepository;
  readonly application: WorkroomCallbackApplicationPort;
  readonly clock: WorkroomCallbackClock;
  readonly receiptIds: WorkroomCallbackReceiptIdFactory;
  readonly maxBodyBytes: number;
  readonly maxSequenceGap: number;
}

export interface WorkroomRemoteCallbackRequest {
  readonly credential: string;
  readonly body: string | Uint8Array;
}

export interface WorkroomRemoteCallbackGatewayResult {
  readonly duplicate: boolean;
  readonly observation?: AssignmentExecutionObservation;
  readonly projection: RemoteCallbackInboxProjection;
  readonly application: RemoteCallbackApplicationOutcome;
}

export class WorkroomRemoteCallbackGateway {
  readonly #maxBodyBytes: number;
  readonly #maxSequenceGap: number;

  constructor(readonly options: WorkroomRemoteCallbackGatewayOptions) {
    this.#maxBodyBytes = positiveInteger(options.maxBodyBytes, 'maxBodyBytes');
    this.#maxSequenceGap = positiveInteger(options.maxSequenceGap, 'maxSequenceGap');
  }

  async handle(
    request: WorkroomRemoteCallbackRequest,
    signal: AbortSignal,
  ): Promise<WorkroomRemoteCallbackGatewayResult> {
    signal.throwIfAborted();
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new Error('Workroom Remote Callback request must be an object');
    }
    assertExactKeys(request, ['credential', 'body'], 'request');
    const authority = normalizeAuthority(
      this.options.authRegistry.authenticate(request.credential),
    );
    signal.throwIfAborted();
    const message = parseCallbackBody(request.body, this.#maxBodyBytes);
    const stored = await this.options.linkRegistry.read(message.linkId);
    if (!stored) throw new Error('Workroom Remote Callback Link is not preregistered');
    const record = createRemoteExecutionLinkRecord(stored.link, stored.assignmentEnvelope);
    if (record.id !== message.linkId || record.digest !== stored.digest
      || stableJson(record) !== stableJson(stored)) {
      throw new Error('Workroom Remote Callback Link Registry record drift');
    }
    assertAuthorityMatchesLink(authority, record.link);
    const callbackDigest = digestRemoteCallbackMessage(message);
    const receivedAt = timestamp(this.options.clock.now(), 'clock.now');
    const receiptIdentity = deepFreeze({
      endpointId: authority.endpointId,
      linkId: record.id,
      eventId: message.eventId,
      callbackDigest,
      receivedAt,
    });
    const receiptId = text(this.options.receiptIds.create(receiptIdentity), 'receiptId');
    const inbox = new RemoteCallbackInbox(
      this.options.inboxRepository,
      record.link,
      { maxSequenceGap: this.#maxSequenceGap },
    );
    const current = await inbox.read();
    const received = await inbox.receive(deepFreeze({
      ...message,
      gatewayReceipt: {
        receiptId,
        source: 'push' as const,
        receivedAt,
        endpointId: authority.endpointId,
        cardDigest: authority.cardDigest,
        authBindingId: authority.authBindingId,
        callbackDigest,
      },
    }), current?.sequence ?? -1);
    signal.throwIfAborted();
    const application = await this.options.application.runOnce(record.id, signal);
    return deepFreeze({
      duplicate: received.duplicate,
      ...(received.observation ? { observation: received.observation } : {}),
      projection: received.projection,
      application,
    });
  }
}

const CALLBACK_KEYS = [
  'version', 'callbackSequence', 'eventId', 'linkId', 'projectId', 'runId',
  'taskKey', 'taskRevision', 'assignmentId', 'assignmentRevision', 'attempt',
  'fence', 'assignmentEnvelopeDigest', 'dispatchId', 'messageId',
  'dispatchEnvelopeDigest', 'claimedEndpoint', 'remoteTaskId', 'remoteContextId',
  'payload',
] as const;

function parseCallbackBody(
  body: string | Uint8Array,
  maxBodyBytes: number,
): RemoteCallbackMessage {
  let encoded: string;
  if (typeof body === 'string') {
    if (Buffer.byteLength(body, 'utf8') > maxBodyBytes) {
      throw new Error('Workroom Remote Callback body exceeds maxBodyBytes');
    }
    encoded = body;
  } else if (body instanceof Uint8Array) {
    if (body.byteLength > maxBodyBytes) {
      throw new Error('Workroom Remote Callback body exceeds maxBodyBytes');
    }
    try {
      encoded = new TextDecoder('utf-8', { fatal: true }).decode(body);
    } catch (error) {
      throw new Error('Workroom Remote Callback body is not valid UTF-8', { cause: error });
    }
  } else {
    throw new Error('Workroom Remote Callback body must be JSON bytes or text');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch (error) {
    throw new Error('Workroom Remote Callback body is not valid JSON', { cause: error });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Workroom Remote Callback body must be a JSON object');
  }
  assertExactKeys(parsed, CALLBACK_KEYS, 'callback body');
  const message = structuredClone(parsed) as RemoteCallbackMessage;
  if (message.version !== 1) throw new Error('Workroom Remote Callback version is unsupported');
  text(message.linkId, 'linkId');
  text(message.eventId, 'eventId');
  return deepFreeze(message);
}

function normalizeAuthority(value: WorkroomCallbackEndpointAuthority): WorkroomCallbackEndpointAuthority {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Workroom Callback authentication authority is invalid');
  }
  assertExactKeys(value, [
    'version', 'endpointId', 'tenantId', 'cardDigest', 'authBindingId',
    'trustDomain', 'generation', 'extensionDigest', 'credentialIdDigest',
  ], 'authentication authority');
  if (value.version !== 1) throw new Error('Workroom Callback authentication authority version is unsupported');
  for (const [field, candidate] of Object.entries({
    endpointId: value.endpointId,
    tenantId: value.tenantId,
    authBindingId: value.authBindingId,
    trustDomain: value.trustDomain,
  })) text(candidate, `authority.${field}`);
  positiveInteger(value.generation, 'authority.generation');
  requireDigest(value.cardDigest, 'authority.cardDigest');
  requireDigest(value.extensionDigest, 'authority.extensionDigest');
  requireDigest(value.credentialIdDigest, 'authority.credentialIdDigest');
  return deepFreeze(structuredClone(value));
}

function assertAuthorityMatchesLink(
  authority: WorkroomCallbackEndpointAuthority,
  link: import('./remote-callback-inbox.js').RemoteExecutionLink,
): void {
  const drift = [
    ['endpointId', authority.endpointId, link.endpoint.id],
    ['cardDigest', authority.cardDigest, link.endpoint.cardDigest],
    ['authBindingId', authority.authBindingId, link.endpoint.authBindingId],
  ].find(([, actual, expected]) => actual !== expected);
  if (drift) {
    throw new Error(`Workroom Remote Callback authenticated ${drift[0]} does not match Link`);
  }
}

function assertExactKeys(value: object, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).find(key => !allowed.includes(key));
  if (unexpected) throw new Error(`Workroom Remote Callback ${label} contains forbidden field ${unexpected}`);
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Workroom Remote Callback ${field} is required`);
  }
  return value;
}

function requireDigest(value: unknown, field: string): void {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Workroom Remote Callback ${field} is invalid`);
  }
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`Workroom Remote Callback ${field} must be a positive integer`);
  }
  return Number(value);
}

function timestamp(value: unknown, field: string): number {
  if (!Number.isFinite(value) || Number(value) < 0) {
    throw new Error(`Workroom Remote Callback ${field} must be a finite timestamp`);
  }
  return Number(value);
}
