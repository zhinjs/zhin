import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable, pipeline, type Transform } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { checkUrlNetworkAccess, isBlockedIpAddress } from '@zhin.js/agent/security';

export interface PersonalModelDnsAddress { readonly address: string; readonly family: number }
export type PersonalModelDnsLookup = (hostname: string) => Promise<readonly PersonalModelDnsAddress[]>;
export type PersonalModelTransport = (input: Readonly<{
  url: URL; request: Request; address: PersonalModelDnsAddress;
}>) => Promise<Response>;
export interface PersonalModelFetchOptions {
  readonly baseUrl: string;
  /** Trusted Host/test ports; never configurable by the personal HTTP payload. */
  readonly lookup?: PersonalModelDnsLookup;
  readonly transport?: PersonalModelTransport;
}
export class PersonalModelNetworkError extends Error {
  constructor(readonly code: 'invalid_url' | 'denied' | 'dns' | 'redirect' | 'transport') {
    // No raw URL, DNS error or transport cause: provider URLs may contain API credentials.
    super({ invalid_url: 'Invalid personal model URL', denied: 'Personal model network target is not permitted',
      dns: 'Personal model DNS resolution failed', redirect: 'Personal model redirect is not permitted',
      transport: 'Personal model network request failed' }[code]);
    this.name = 'PersonalModelNetworkError';
  }
}
function authorizeUrl(input: string | URL): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new PersonalModelNetworkError('invalid_url'); }
  if (url.username || url.password) throw new PersonalModelNetworkError('invalid_url');
  if (!checkUrlNetworkAccess(url.href, { httpsOnly: true, allowedDomains: [] }).allowed) {
    throw new PersonalModelNetworkError('denied');
  }
  return url;
}
// Persisted connection URLs are public metadata. Authentication belongs only
// in the separate encrypted credential field, including common vendor aliases.
const AUTH_QUERY_NAMES = new Set([
  'key', 'apikey', 'xapikey', 'apisecret', 'apitoken', 'accesskey', 'secretkey', 'secretaccesskey',
  'token', 'accesstoken', 'refreshtoken', 'idtoken', 'authtoken', 'auth', 'authorization',
  'password', 'passwd', 'secret', 'clientsecret', 'credential', 'credentials', 'privatekey',
  'signature', 'sig', 'oauthtoken', 'oauthtokensecret', 'xamzcredential', 'xamzsignature',
  'xgoogcredential', 'xgoogsignature',
]);
function rejectBaseUrlAuthentication(url: URL): void {
  const groups = [url.searchParams, new URLSearchParams(url.hash.slice(1).replace(/^\?/u, ''))];
  for (const parameters of groups) for (const name of parameters.keys()) {
    if (AUTH_QUERY_NAMES.has(name.replace(/[-_]/gu, '').toLowerCase())) {
      throw new PersonalModelNetworkError('invalid_url');
    }
  }
}

async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    operation.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => {
      signal.removeEventListener('abort', abort); reject(error);
    });
  });
}
async function publicAddress(url: URL, lookup: PersonalModelDnsLookup, signal: AbortSignal): Promise<PersonalModelDnsAddress> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: readonly PersonalModelDnsAddress[];
  try { addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await abortable(lookup(hostname), signal); }
  catch { signal.throwIfAborted(); throw new PersonalModelNetworkError('dns'); }
  if (addresses.length === 0) throw new PersonalModelNetworkError('dns');
  for (const entry of addresses) {
    if (!isIP(entry.address) || isIP(entry.address) !== entry.family || isBlockedIpAddress(entry.address)) {
      throw new PersonalModelNetworkError('denied');
    }
  }
  return Object.freeze({ ...addresses[0]! });
}
async function bodyBytes(request: Request): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const cancel = () => { void reader.cancel(request.signal.reason).catch(() => {}); };
  request.signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  try {
    request.signal.throwIfAborted();
    while (true) {
      const item = await reader.read();
      request.signal.throwIfAborted();
      if (item.done) return new Uint8Array(Buffer.concat(chunks));
      chunks.push(item.value);
    }
  } finally { request.signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}
/** Native HTTPS transport pins the verified IP, retaining the logical Host and TLS servername. */
export const personalModelHttpsTransport: PersonalModelTransport = async ({ url, request, address }) => {
  const bytes = await bodyBytes(request);
  request.signal.throwIfAborted();
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  return new Promise<Response>((resolve, reject) => {
    const headers = Object.fromEntries(request.headers.entries());
    // A caller-controlled Host header must never override the verified logical origin.
    delete headers.host; headers.Host = url.host;
    headers['accept-encoding'] = 'identity';
    const outgoing = httpsRequest({
      protocol: 'https:', hostname: address.address, family: address.family,
      port: url.port || undefined, path: `${url.pathname}${url.search}`, method: request.method,
      headers, signal: request.signal, agent: false,
      ...(!isIP(hostname) ? { servername: hostname } : {}),
    }, incoming => {
      try {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value !== undefined) for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(name, item);
        }
        const status = incoming.statusCode ?? 500;
        const empty = request.method === 'HEAD' || [204, 205, 304].includes(status);
        if (empty) incoming.resume();
        const decoders: Transform[] = [];
        for (const encoding of (responseHeaders.get('content-encoding') ?? '').split(',').map(value => value.trim().toLowerCase()).reverse()) {
          if (encoding === 'gzip' || encoding === 'x-gzip') decoders.push(createGunzip());
          else if (encoding === 'deflate') decoders.push(createInflate());
          else if (encoding === 'br') decoders.push(createBrotliDecompress());
          else if (encoding !== 'identity' && encoding !== '') { decoders.length = 0; break; }
        }
        const streams = [incoming, ...decoders];
        if (!empty && decoders.length) pipeline(streams, () => {});
        const body = empty ? null : Readable.toWeb(streams[streams.length - 1]!) as ReadableStream<Uint8Array>;
        resolve(new Response(body, { status, statusText: incoming.statusMessage ?? '', headers: responseHeaders }));
      } catch (error) { incoming.destroy(); reject(error); }
    });
    outgoing.once('error', reject);
    outgoing.end(bytes);
  });
};

/**
 * Personal-provider authority is independent of tool-network policy. Each hop is reauthorized,
 * all DNS answers checked, and the selected address pinned by the native transport.
 */
export function createPersonalModelFetch(options: PersonalModelFetchOptions): typeof globalThis.fetch {
  const base = authorizeUrl(options.baseUrl);
  // Validate the stored base URL only. SDKs may append their own credential
  // query during execution (for example Google's key parameter).
  rejectBaseUrlAuthentication(base);
  const lookup: PersonalModelDnsLookup = options.lookup ?? (hostname => dnsLookup(hostname, { all: true, verbatim: true }));
  const transport = options.transport ?? personalModelHttpsTransport;
  return async (input, init) => {
    let request: Request;
    try { request = new Request(input, init); }
    catch { throw new PersonalModelNetworkError('invalid_url'); }
    request.signal.throwIfAborted();
    let url = authorizeUrl(request.url);
    if (url.origin !== base.origin) throw new PersonalModelNetworkError('denied');
    // Buffer only outbound bodies so 307/308 preserve the exact SDK payload on replay.
    const bytes = await bodyBytes(request);
    let method = request.method;
    const headers = new Headers(request.headers);
    for (let redirects = 0; ; redirects += 1) {
      request.signal.throwIfAborted();
      url = authorizeUrl(url);
      const address = await publicAddress(url, lookup, request.signal);
      request.signal.throwIfAborted();
      let response: Response;
      try {
        const hop = new Request(url, { method, headers, signal: request.signal,
          ...(method === 'GET' || method === 'HEAD' || bytes === undefined ? {} : { body: bytes }) });
        response = await transport({ url, request: hop, address });
      } catch {
        request.signal.throwIfAborted();
        throw new PersonalModelNetworkError('transport');
      }
      const location = response.headers.get('location');
      if (![301, 302, 303, 307, 308].includes(response.status) || !location || request.redirect === 'manual') return response;
      await response.body?.cancel();
      // Match the installed Fetch implementation's 20-hop redirect boundary (undici fetch).
      if (request.redirect === 'error' || redirects === 20) throw new PersonalModelNetworkError('redirect');
      let next: URL;
      try { next = authorizeUrl(new URL(location, url)); }
      catch { throw new PersonalModelNetworkError('redirect'); }
      // Personal connections permit only same-origin HTTPS redirects. Reject before any
      // credential-bearing request can reach another origin.
      if (next.origin !== base.origin) throw new PersonalModelNetworkError('redirect');
      if (((response.status === 301 || response.status === 302) && method === 'POST')
        || (response.status === 303 && method !== 'GET' && method !== 'HEAD')) {
        method = 'GET';
        for (const name of ['content-encoding', 'content-language', 'content-location', 'content-type', 'content-length']) headers.delete(name);
      }
      url = next;
    }
  };
}
