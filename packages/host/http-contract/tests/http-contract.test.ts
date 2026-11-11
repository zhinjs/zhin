import { describe, expect, it } from 'vitest';
import {
  createResponseStream,
  emptyResponse,
  HttpBodyError,
  jsonResponse,
  readBodyBytes,
  readJsonBody,
  readTextBody,
} from '../src/index.js';

/** A POST Request whose body arrives in the given chunks; reports whether it was read to the end. */
function requestOf(chunks: readonly (string | Uint8Array)[]): { request: Request; drained: () => boolean } {
  const encoder = new TextEncoder();
  let index = 0;
  let ended = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        ended = true;
        controller.close();
        return;
      }
      const chunk = chunks[index++]!;
      controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
    },
  });
  const request = new Request('http://localhost/test', { method: 'POST', body, duplex: 'half' } as RequestInit);
  return { request, drained: () => ended };
}

describe('readJsonBody', () => {
  it('空 body → undefined', async () => {
    expect(await readJsonBody(requestOf([]).request)).toBeUndefined();
    expect(await readJsonBody(requestOf(['   ']).request)).toBeUndefined();
    expect(await readJsonBody(new Request('http://localhost/'))).toBeUndefined();
  });

  it('合法 JSON → 解析结果', async () => {
    const body = await readJsonBody<{ a: number }>(requestOf(['{"a":', '1}']).request);
    expect(body).toEqual({ a: 1 });
  });

  it('非法 JSON → HttpBodyError 400', async () => {
    await expect(readJsonBody(requestOf(['not-json']).request)).rejects.toMatchObject({
      name: 'HttpBodyError',
      statusCode: 400,
    });
  });

  it('超过 limit → HttpBodyError 413，且请求被完全排空', async () => {
    const big = 'x'.repeat(64);
    const { request, drained } = requestOf([big, big, big]);
    await expect(readJsonBody(request, { limit: 32 })).rejects.toMatchObject({
      name: 'HttpBodyError',
      statusCode: 413,
    });
    // 流已被消费完（fully drained），调用方可在同一连接上继续响应
    expect(drained()).toBe(true);
  });

  it('自定义 limit 内正常解析', async () => {
    const body = await readJsonBody(requestOf(['{"ok":true}']).request, { limit: 16 });
    expect(body).toEqual({ ok: true });
  });
});

describe('readTextBody', () => {
  it('returns the body verbatim, including surrounding whitespace', async () => {
    expect(await readTextBody(requestOf([' {"a":', new TextEncoder().encode('1}\n')]).request)).toBe(' {"a":1}\n');
    expect(await readTextBody(requestOf([]).request)).toBe('');
  });

  it('keeps multi-byte characters split across chunks intact', async () => {
    const bytes = new TextEncoder().encode('你好');
    expect(await readTextBody(requestOf([bytes.subarray(0, 2), bytes.subarray(2)]).request)).toBe('你好');
  });

  it('drains an oversize body and rejects with HttpBodyError 413', async () => {
    const big = 'x'.repeat(64);
    const { request, drained } = requestOf([big, big, big]);
    await expect(readTextBody(request, { limit: 32 })).rejects.toMatchObject({
      name: 'HttpBodyError',
      statusCode: 413,
      message: 'Request body exceeds 32 bytes',
    });
    expect(drained()).toBe(true);
  });

  it('accepts a body of exactly the limit', async () => {
    expect(await readTextBody(requestOf(['12345678']).request, { limit: 8 })).toBe('12345678');
  });

  it('reads raw bytes', async () => {
    expect([...await readBodyBytes(requestOf([new Uint8Array([1, 2]), new Uint8Array([3])]).request)]).toEqual([1, 2, 3]);
  });
});

describe('response helpers', () => {
  it('jsonResponse sets the JSON content type unless given', async () => {
    const response = jsonResponse(201, { ok: true });
    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toEqual({ ok: true });
    expect(jsonResponse(200, 1, { 'content-type': 'application/problem+json' }).headers.get('content-type'))
      .toBe('application/problem+json');
    expect(emptyResponse(404).body).toBeNull();
  });

  it('createResponseStream reports backpressure, drains and closes on cancel', async () => {
    const stream = createResponseStream({ highWaterMark: 4 });
    let drains = 0;
    stream.onDrain(() => { drains += 1; });
    let closed = 0;
    stream.onClose(() => { closed += 1; });
    expect(stream.write('ab')).toBe(true);
    expect(stream.write('cdef')).toBe(false);
    const reader = stream.stream.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('ab');
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('cdef');
    expect(drains).toBeGreaterThan(0);
    await reader.cancel();
    expect(stream.closed).toBe(true);
    expect(stream.signal.aborted).toBe(true);
    expect(closed).toBe(1);
    expect(stream.write('x')).toBe(false);
  });

  it('createResponseStream close ends the body; error fails it', async () => {
    const ok = createResponseStream();
    ok.write('done');
    ok.close();
    expect(await new Response(ok.stream).text()).toBe('done');
    const failed = createResponseStream();
    failed.error(new Error('boom'));
    await expect(new Response(failed.stream).text()).rejects.toThrow('boom');
  });
});

describe('HttpBodyError', () => {
  it('默认 statusCode 400，可序列化', () => {
    const error = new HttpBodyError('bad');
    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(400);
    expect(error.name).toBe('HttpBodyError');
  });
});
