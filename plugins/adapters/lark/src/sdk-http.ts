import type { HttpInstance, HttpRequestOptions } from '@larksuiteoapi/node-sdk';
import { Readable, PassThrough } from 'node:stream';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import type { LarkFetch } from './client.js';

/** The installed SDK's documented HttpInstance seam, using the same account-owned transport. */
export function createLarkSdkHttpInstance(fetch: LarkFetch): HttpInstance {
  const request = async <T = unknown, R = T, D = unknown>(input: HttpRequestOptions<D>): Promise<R> => {
    if (!input.url) throw new TypeError('Lark SDK request URL is required');
    const url = new URL(input.url);
    if (input.params) {
      const serializer = typeof input.paramsSerializer === 'function' ? input.paramsSerializer
        : input.paramsSerializer?.serialize;
      if (serializer) {
        const query = serializer(input.params); if (query) url.search = url.search ? `${url.search}&${query}` : query;
      } else for (const [key, value] of Object.entries(input.params)) {
        if (value === undefined || value === null) continue;
        for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
      }
    }
    const headers = Object.fromEntries(Object.entries(input.headers ?? {}).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
    let body: string | FormData | Uint8Array | ArrayBuffer | AsyncIterable<Uint8Array> | undefined;
    let streaming = false;
    if (input.data !== undefined) {
      const native = input.data as { getHeaders?: () => Record<string, string>; pipe?: (target: PassThrough) => unknown; destroy?: () => void; [Symbol.asyncIterator]?: unknown };
      if (typeof input.data === 'string' || input.data instanceof FormData || input.data instanceof ArrayBuffer || ArrayBuffer.isView(input.data)) body = input.data as string | FormData | Uint8Array | ArrayBuffer;
      else if (native && (typeof native.pipe === 'function' || typeof native[Symbol.asyncIterator] === 'function')) {
        if (native.getHeaders) Object.assign(headers, native.getHeaders());
        if (typeof native.pipe === 'function') {
          const stream = new PassThrough();
          stream.once('close', () => native.destroy?.()); native.pipe(stream); body = stream;
        } else body = input.data as AsyncIterable<Uint8Array>;
        streaming = true;
      }
      else { body = JSON.stringify(input.data); if (!Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json'; }
    }
    const response = await fetch(url.toString(), { method: input.method, headers, body, ...(streaming ? { duplex: 'half' as const } : {}),
      ...(input.timeout ? { signal: AbortSignal.timeout(input.timeout) } : {}) });
    if (!response.ok) throw new EndpointDeliveryError('http_error', `Lark HTTP ${response.status}`, response.status >= 400 && response.status < 500 && response.status !== 408 ? 'rejected' : 'unknown');
    const native = response as Partial<Response>;
    let data: unknown;
    if (input.responseType === 'stream') {
      if (!native.body) throw new Error('Lark transport returned no response stream');
      data = Readable.fromWeb(native.body as Parameters<typeof Readable.fromWeb>[0]);
    } else if (input.responseType === 'arraybuffer') {
      if (!native.arrayBuffer) throw new Error('Lark transport returned no binary reader');
      data = Buffer.from(await native.arrayBuffer());
    } else if (input.responseType === 'blob') {
      if (!native.blob) throw new Error('Lark transport returned no blob reader');
      data = await native.blob();
    } else if (input.responseType === 'text' || input.responseType === 'document') data = await response.text();
    else data = await response.json();
    return (input.$return_headers ? { data, headers: Object.fromEntries(native.headers?.entries() ?? []) } : data) as R;
  };
  return {
    request,
    get: (url, options) => request({ ...options, url, method: 'GET' }),
    delete: (url, options) => request({ ...options, url, method: 'DELETE' }),
    head: (url, options) => request({ ...options, url, method: 'HEAD' }),
    options: (url, options) => request({ ...options, url, method: 'OPTIONS' }),
    post: (url, data, options) => request({ ...options, url, data, method: 'POST' }),
    put: (url, data, options) => request({ ...options, url, data, method: 'PUT' }),
    patch: (url, data, options) => request({ ...options, url, data, method: 'PATCH' }),
  };
}
