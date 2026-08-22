import type {
  RemoteCallbackPollPort,
  RemoteCallbackPollRequest,
  RemoteCallbackPollSnapshot,
  WORKROOM_A2A_EXTENSION_URI,
  WorkroomRemoteDispatchOutboxItem,
} from '@zhin.js/agent';
import type {
  WorkroomRemoteEndpointAuthority,
  WorkroomRemoteEndpointAuthorityPort,
  WorkroomRemoteDispatchObservation,
  WorkroomRemoteExecutorPort,
} from '@zhin.js/agent/runtime';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import { isIP } from 'node:net';
import type {
  WorkroomA2aCredentialReference,
  WorkroomA2aRegisteredAuthBindingSnapshot,
  WorkroomA2aSecureCredentialProvider,
} from './workroom-auth-registry.js';
import { WorkroomA2aAuthRegistry } from './workroom-auth-registry.js';

// Keep the Host runtime dependency-neutral while the literal type remains
// checked against the Agent-owned Workroom protocol contract at compile time.
const WORKROOM_A2A_EXTENSION_URI_VALUE: typeof WORKROOM_A2A_EXTENSION_URI =
  'https://zhin.dev/extensions/workroom-executor/v1';

export interface WorkroomA2aRemoteTransportBindingInput {
  readonly endpointId: string;
  readonly cardDigest: string;
  readonly authBindingId: string;
  readonly dispatchUrl: string;
  readonly pollUrl: string;
  readonly credential: WorkroomA2aCredentialReference;
  readonly authority?: Readonly<{
    readonly workroomExtension: typeof WORKROOM_A2A_EXTENSION_URI;
    readonly idempotentDispatch: boolean;
    readonly typedCompletionEnvelope: boolean;
    readonly workspaceProviders: readonly string[];
  }>;
  readonly enabled: boolean;
}

export interface WorkroomA2aHttpRemoteTransportOptions {
  readonly authRegistry: WorkroomA2aAuthRegistry;
  readonly callbackUrl: string;
  readonly bindings: readonly WorkroomA2aRemoteTransportBindingInput[];
  readonly secureCredentialProvider?: WorkroomA2aSecureCredentialProvider;
  /** Trusted low-level seam. Production uses DNS validation plus a pinned Node socket. */
  readonly network?: WorkroomA2aPinnedNetworkPort;
  readonly maxResponseBytes?: number;
}

export interface WorkroomA2aResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export interface WorkroomA2aPinnedRequest {
  readonly url: URL;
  readonly address: string;
  readonly family: 4 | 6;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal: AbortSignal;
  readonly maxResponseBytes: number;
}

export interface WorkroomA2aPinnedNetworkPort {
  resolve(hostname: string): Promise<readonly WorkroomA2aResolvedAddress[]>;
  request(input: WorkroomA2aPinnedRequest): Promise<Response>;
}

interface CompiledRemoteBinding {
  readonly endpointId: string;
  readonly cardDigest: string;
  readonly authBindingId: string;
  readonly dispatchUrl: string;
  readonly pollUrl: string;
  readonly authorization: string;
  readonly enabled: boolean;
  readonly authority?: WorkroomRemoteEndpointAuthority;
}

/**
 * Fixed-generation HTTP implementation of the Workroom A2A extension. It
 * transports immutable envelopes and typed poll snapshots only; Task state
 * remains owned by the local Workroom Kernel.
 */
export class WorkroomA2aHttpRemoteTransport
implements WorkroomRemoteExecutorPort, RemoteCallbackPollPort, WorkroomRemoteEndpointAuthorityPort {
  readonly #authRegistry: WorkroomA2aAuthRegistry;
  readonly #callbackUrl: string;
  readonly #bindings: ReadonlyMap<string, CompiledRemoteBinding>;
  readonly #network: WorkroomA2aPinnedNetworkPort;
  readonly #maxResponseBytes: number;

  constructor(options: WorkroomA2aHttpRemoteTransportOptions) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new Error('Workroom A2A remote transport options must be an object');
    }
    this.#authRegistry = options.authRegistry;
    this.#callbackUrl = canonicalUrl(options.callbackUrl, 'callbackUrl');
    this.#network = options.network ?? new NodeWorkroomA2aPinnedNetwork();
    this.#maxResponseBytes = positiveInteger(options.maxResponseBytes ?? 1_048_576, 'maxResponseBytes');
    if (!Array.isArray(options.bindings) || options.bindings.length === 0) {
      throw new Error('Workroom A2A remote transport requires endpoint bindings');
    }
    const bindings = new Map<string, CompiledRemoteBinding>();
    for (const input of options.bindings) {
      exactKeys(input, [
        'endpointId', 'cardDigest', 'authBindingId', 'dispatchUrl', 'pollUrl',
        'credential', 'authority', 'enabled',
      ], 'remote binding');
      const endpointId = text(input.endpointId, 'endpointId');
      if (bindings.has(endpointId)) throw new Error(`Duplicate Workroom A2A endpoint ${endpointId}`);
      const callbackAuthority = options.authRegistry.snapshot.bindings.find(
        candidate => candidate.endpointId === endpointId,
      );
      if (!callbackAuthority
        || callbackAuthority.cardDigest !== input.cardDigest
        || callbackAuthority.authBindingId !== input.authBindingId) {
        throw new Error(`Workroom A2A endpoint ${endpointId} has no exact callback authority`);
      }
      const dispatchUrl = trustedDestinationUrl(
        input.dispatchUrl,
        'dispatchUrl',
        callbackAuthority.trustDomain,
      );
      const pollUrl = trustedDestinationUrl(
        input.pollUrl,
        'pollUrl',
        callbackAuthority.trustDomain,
      );
      if (new URL(dispatchUrl).origin !== new URL(pollUrl).origin) {
        throw new Error(`Workroom A2A endpoint ${endpointId} dispatch/poll origin drift`);
      }
      const credential = resolveCredential(input.credential, options.secureCredentialProvider);
      const authority = input.authority === undefined
        ? undefined
        : compileEndpointAuthority(
            input.authority,
            callbackAuthority,
            dispatchUrl,
            pollUrl,
          );
      bindings.set(endpointId, Object.freeze({
        endpointId,
        cardDigest: digest(input.cardDigest, 'cardDigest'),
        authBindingId: text(input.authBindingId, 'authBindingId'),
        dispatchUrl,
        pollUrl,
        authorization: `Bearer ${credential}`,
        enabled: boolean(input.enabled, 'enabled'),
        ...(authority === undefined ? {} : { authority }),
      }));
    }
    this.#bindings = bindings;
  }

  resolve(endpointId: string): WorkroomRemoteEndpointAuthority | undefined {
    const binding = this.#bindings.get(text(endpointId, 'endpointId'));
    return binding?.enabled ? binding.authority : undefined;
  }

  async dispatch(
    item: WorkroomRemoteDispatchOutboxItem,
    signal: AbortSignal,
    governedBody?: Uint8Array,
  ): Promise<WorkroomRemoteDispatchObservation> {
    signal.throwIfAborted();
    if (!governedBody) {
      throw new Error('Workroom A2A governed disclosure body is unavailable');
    }
    const binding = this.#binding(
      item.envelope.endpoint.id,
      item.envelope.endpoint.cardDigest,
      item.envelope.endpoint.authBindingId,
    );
    const response = await this.#request(binding.dispatchUrl, binding.authorization, {
      version: 1,
      callback: {
        url: this.#callbackUrl,
        authorization: this.#authRegistry.callbackAuthorization(binding.endpointId),
      },
      item,
      governedPayload: {
        version: 1,
        manifestDigest: item.envelope.disclosureManifest.manifest.digest,
        mediaType: 'application/octet-stream',
        encoding: 'base64',
        body: Buffer.from(governedBody).toString('base64'),
      },
    }, signal);
    if (response.status >= 400 && response.status < 500) {
      return Object.freeze({
        outcome: 'failed',
        receiptId: `workroom-http-rejected:v1:${encodeURIComponent(item.dispatchId)}:${response.status}`,
        reason: `remote_http_${response.status}`,
      });
    }
    if (!response.ok) throw new Error(`Workroom A2A dispatch HTTP ${response.status}`);
    const value = await this.#json(response, 'dispatch receipt');
    exactKeys(value, ['version', 'receiptId', 'remoteTaskId', 'remoteContextId'], 'dispatch receipt');
    if (value.version !== 1) throw new Error('Workroom A2A dispatch receipt version is unsupported');
    return Object.freeze({
      outcome: 'delivered',
      receiptId: text(value.receiptId, 'receiptId'),
      remoteTaskId: text(value.remoteTaskId, 'remoteTaskId'),
      remoteContextId: text(value.remoteContextId, 'remoteContextId'),
    });
  }

  async poll(
    request: RemoteCallbackPollRequest,
    signal: AbortSignal,
  ): Promise<RemoteCallbackPollSnapshot> {
    signal.throwIfAborted();
    const binding = this.#binding(request.endpointId, request.cardDigest, request.authBindingId);
    const response = await this.#request(binding.pollUrl, binding.authorization, request, signal);
    if (!response.ok) throw new Error(`Workroom A2A poll HTTP ${response.status}`);
    return await this.#json(response, 'poll snapshot') as unknown as RemoteCallbackPollSnapshot;
  }

  #binding(endpointId: string, cardDigest: string, authBindingId: string): CompiledRemoteBinding {
    const binding = this.#bindings.get(endpointId);
    if (!binding || !binding.enabled
      || binding.cardDigest !== cardDigest
      || binding.authBindingId !== authBindingId) {
      throw new Error('Workroom A2A endpoint authority does not match the active transport generation');
    }
    return binding;
  }

  async #request(
    url: string,
    authorization: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<Response> {
    signal.throwIfAborted();
    const parsed = new URL(url);
    const addresses = isIP(parsed.hostname)
      ? [{ address: parsed.hostname, family: isIP(parsed.hostname) as 4 | 6 }]
      : await this.#network.resolve(parsed.hostname);
    if (addresses.length === 0) {
      throw new Error(`Workroom A2A DNS returned no address for ${parsed.hostname}`);
    }
    const loopbackDestination = isLoopbackHostname(parsed.hostname);
    for (const entry of addresses) {
      if ((entry.family !== 4 && entry.family !== 6) || isIP(entry.address) !== entry.family) {
        throw new Error(`Workroom A2A DNS returned an invalid address for ${parsed.hostname}`);
      }
      if (isBlockedIpAddress(entry.address)
        && !(loopbackDestination && isLoopbackAddress(entry.address))) {
        throw new Error(`Workroom A2A DNS target ${entry.address} is private or dangerous`);
      }
    }
    const selected = addresses[0]!;
    return await this.#network.request({
      url: parsed,
      address: selected.address,
      family: selected.family,
      headers: Object.freeze({
        authorization,
        'content-type': 'application/json',
        'x-zhin-workroom-extension': 'https://zhin.dev/extensions/workroom-executor/v1',
      }),
      body: JSON.stringify(body),
      signal,
      maxResponseBytes: this.#maxResponseBytes,
    });
  }

  async #json(response: Response, label: string): Promise<Record<string, unknown>> {
    const declared = response.headers.get('content-length');
    if (declared !== null && Number(declared) > this.#maxResponseBytes) {
      await response.body?.cancel();
      throw new Error(`Workroom A2A ${label} exceeds ${this.#maxResponseBytes} bytes`);
    }
    if (!response.body) throw new Error(`Workroom A2A ${label} has no response body`);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > this.#maxResponseBytes) {
        await reader.cancel();
        throw new Error(`Workroom A2A ${label} exceeds ${this.#maxResponseBytes} bytes`);
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      throw new Error(`Workroom A2A ${label} is not valid JSON`, { cause: error });
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Workroom A2A ${label} must be an object`);
    }
    return value as Record<string, unknown>;
  }
}

class NodeWorkroomA2aPinnedNetwork implements WorkroomA2aPinnedNetworkPort {
  async resolve(hostname: string): Promise<readonly WorkroomA2aResolvedAddress[]> {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.map(entry => Object.freeze({
      address: entry.address,
      family: entry.family as 4 | 6,
    }));
  }

  request(input: WorkroomA2aPinnedRequest): Promise<Response> {
    const requester = input.url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const request = requester.request({
        protocol: input.url.protocol,
        hostname: input.address,
        family: input.family,
        port: input.url.port || undefined,
        path: `${input.url.pathname}${input.url.search}`,
        method: 'POST',
        headers: {
          ...input.headers,
          Host: input.url.host,
          'Accept-Encoding': 'identity',
          'Content-Length': String(Buffer.byteLength(input.body)),
        },
        signal: input.signal,
        ...(input.url.protocol === 'https:' && !isIP(input.url.hostname)
          ? { servername: input.url.hostname }
          : {}),
      }, response => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.length;
          if (size > input.maxResponseBytes) {
            response.destroy(new Error(
              `Workroom A2A response exceeds ${input.maxResponseBytes} bytes`,
            ));
            return;
          }
          chunks.push(buffer);
        });
        response.once('error', reject);
        response.once('end', () => resolve(new Response(Buffer.concat(chunks), {
          status: response.statusCode ?? 500,
          statusText: response.statusMessage,
          headers: response.headers as HeadersInit,
        })));
      });
      request.once('error', reject);
      request.end(input.body);
    });
  }
}

function compileEndpointAuthority(
  input: NonNullable<WorkroomA2aRemoteTransportBindingInput['authority']>,
  callback: WorkroomA2aRegisteredAuthBindingSnapshot,
  dispatchUrl: string,
  pollUrl: string,
): WorkroomRemoteEndpointAuthority {
  exactKeys(input, [
    'workroomExtension', 'idempotentDispatch', 'typedCompletionEnvelope',
    'workspaceProviders',
  ], 'remote endpoint authority');
  if (input.workroomExtension !== WORKROOM_A2A_EXTENSION_URI_VALUE
    || input.idempotentDispatch !== true
    || input.typedCompletionEnvelope !== true) {
    throw new Error('Workroom A2A remote endpoint authority lacks the v1 execution contract');
  }
  const expectedExtensionDigest = `sha256:${createHash('sha256')
    .update(WORKROOM_A2A_EXTENSION_URI_VALUE).digest('hex')}`;
  if (callback.extensionDigest !== expectedExtensionDigest) {
    throw new Error('Workroom A2A remote endpoint extension digest drift');
  }
  if (!Array.isArray(input.workspaceProviders) || input.workspaceProviders.length === 0) {
    throw new Error('Workroom A2A remote endpoint requires Workspace providers');
  }
  const workspaceProviders = [...new Set(input.workspaceProviders.map(provider =>
    text(provider, 'workspaceProvider')))].sort((left, right) => left.localeCompare(right));
  if (workspaceProviders.length !== input.workspaceProviders.length) {
    throw new Error('Workroom A2A remote endpoint Workspace providers contain duplicates');
  }
  const transportProjection = {
    version: 1,
    generation: callback.generation,
    endpointId: callback.endpointId,
    cardDigest: callback.cardDigest,
    authBindingId: callback.authBindingId,
    extensionDigest: callback.extensionDigest,
    credentialIdDigest: callback.credentialIdDigest,
    dispatchUrl,
    pollUrl,
  };
  return Object.freeze({
    generation: callback.generation,
    transportBindingDigest: `sha256:${createHash('sha256')
      .update(JSON.stringify(transportProjection)).digest('hex')}`,
    endpoint: Object.freeze({
      id: callback.endpointId,
      owner: callback.tenantId,
      cardDigest: callback.cardDigest,
      authBindingId: callback.authBindingId,
      workroomExtension: WORKROOM_A2A_EXTENSION_URI_VALUE,
      idempotentDispatch: true,
      typedCompletionEnvelope: true,
      workspaceProviders: Object.freeze(workspaceProviders),
    }),
  });
}

function resolveCredential(
  reference: WorkroomA2aCredentialReference,
  provider: WorkroomA2aSecureCredentialProvider | undefined,
): string {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    throw new Error('Workroom A2A remote credential reference must be an object');
  }
  if (reference.source === 'config') {
    exactKeys(reference, ['source', 'value'], 'remote config credential');
    return credential(reference.value);
  }
  if (reference.source === 'secure_provider') {
    exactKeys(reference, ['source', 'secretRef'], 'remote secure credential');
    const secretRef = text(reference.secretRef, 'secretRef');
    if (!provider) throw new Error('Workroom A2A remote secure credential provider is required');
    return credential(provider.resolve(secretRef));
  }
  throw new Error('Workroom A2A remote credential source is unsupported');
}

function canonicalUrl(value: unknown, field: string): string {
  const raw = text(value, field);
  let url: URL;
  try {
    url = new URL(raw);
  } catch (error) {
    throw new Error(`Workroom A2A ${field} is not a valid URL`, { cause: error });
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error(`Workroom A2A ${field} must use HTTPS or loopback HTTP`);
  }
  if (url.username || url.password || url.hash) {
    throw new Error(`Workroom A2A ${field} must not embed credentials or fragments`);
  }
  return url.toString();
}

function trustedDestinationUrl(value: unknown, field: string, trustDomainValue: string): string {
  const canonical = canonicalUrl(value, field);
  const url = new URL(canonical);
  const trustDomain = text(trustDomainValue, 'trustDomain').toLowerCase();
  if (url.hostname.toLowerCase() !== trustDomain) {
    throw new Error(`Workroom A2A ${field} host is outside the trusted destination`);
  }
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol === 'https:' && url.port && url.port !== '443') {
    throw new Error(`Workroom A2A ${field} uses an unapproved HTTPS port`);
  }
  if (url.protocol === 'http:' && !loopback) {
    throw new Error(`Workroom A2A ${field} uses non-loopback HTTP`);
  }
  if (isIP(url.hostname) && isBlockedIpAddress(url.hostname) && !loopback) {
    throw new Error(`Workroom A2A ${field} host is private or dangerous`);
  }
  return canonical;
}

function isLoopbackHostname(hostname: string): boolean {
  return ['127.0.0.1', 'localhost', '::1'].includes(hostname.toLowerCase());
}

function isLoopbackAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  return normalized === '::1' || normalized.startsWith('127.');
}

function isBlockedIpAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/gu, '');
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split('.').map(Number);
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b! >= 64 && b! <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b! >= 16 && b! <= 31)
      || (a === 192 && b === 0)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || a! >= 224;
  }
  if (isIP(normalized) === 6) {
    if (normalized === '::' || normalized === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu.exec(normalized)?.[1];
    if (mapped) return isBlockedIpAddress(mapped);
    return /^(?:fc|fd)/iu.test(normalized)
      || /^fe[89ab]/iu.test(normalized)
      || /^ff/iu.test(normalized);
  }
  return true;
}

function exactKeys(value: object, keys: readonly string[], label: string): void {
  const unexpected = Object.keys(value).find(key => !keys.includes(key));
  if (unexpected) throw new Error(`Workroom A2A ${label} contains unsupported field ${unexpected}`);
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Workroom A2A ${field} is required`);
  if (/\r|\n/u.test(value)) throw new Error(`Workroom A2A ${field} contains control characters`);
  return value.trim();
}

function credential(value: unknown): string {
  const result = text(value, 'credential');
  if (result.length > 8_192) throw new Error('Workroom A2A credential is too large');
  return result;
}

function digest(value: unknown, field: string): string {
  const result = text(value, field);
  if (!/^sha256:[a-f0-9]{64}$/u.test(result)) throw new Error(`Workroom A2A ${field} is invalid`);
  return result;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Workroom A2A ${field} must be boolean`);
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`Workroom A2A ${field} must be a positive safe integer`);
  }
  return Number(value);
}
