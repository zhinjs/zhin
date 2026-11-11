import { afterEach, describe, expect, it, vi } from 'vitest';
import { consumeSseBuffer, openSseStream } from '../src/sse-client.js';

function streamResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let aborted = false;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const encoder = new TextEncoder();
  return {
    response: new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
    abort: () => { if (aborted) return; aborted = true; try { controller.error(new DOMException('aborted', 'AbortError')); } catch { /* already closed */ } },
    aborted: () => aborted,
  };
}

/** fetch stub that rejects the pending body read when the request signal aborts, like the real one. */
function fetchFor(source: ReturnType<typeof streamResponse>) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    init?.signal?.addEventListener('abort', () => source.abort(), { once: true });
    return source.response;
  }) as unknown as typeof globalThis.fetch;
}

afterEach(() => { vi.useRealTimers(); });

describe('consumeSseBuffer line endings', () => {
  it('splits CRLF-terminated frames', () => {
    const messages: string[] = [];
    const rest = consumeSseBuffer('data: {"a":1}\r\n\r\nevent: x\r\ndata: one\r\ndata: two\r\n\r\npartial', data => messages.push(data));
    expect(messages).toEqual(['{"a":1}', 'one\ntwo']);
    expect(rest).toBe('partial');
  });

  it('handles lone CR terminators and a CRLF split across chunks', () => {
    const messages: string[] = [];
    expect(consumeSseBuffer('data: cr\r\rrest', data => messages.push(data))).toBe('rest');
    // First chunk ends between CR and LF: nothing is emitted yet and the CR is kept.
    let rest = consumeSseBuffer('data: split\r\n\r', data => messages.push(data));
    expect(messages).toEqual(['cr']);
    expect(rest).toBe('data: split\n\r');
    rest = consumeSseBuffer(`${rest}\ndata: next`, data => messages.push(data));
    expect(messages).toEqual(['cr', 'split']);
    expect(rest).toBe('data: next');
  });
});

describe('openSseStream', () => {
  it('delivers frames from a CRLF server instead of buffering forever', async () => {
    const source = streamResponse();
    const messages: string[] = [];
    const handle = openSseStream({ url: 'http://sse.test/event', fetch: fetchFor(source), onMessage: data => messages.push(data) });
    source.push('data: first\r\n\r');
    source.push('\ndata: second\r\n\r\n');
    await vi.waitFor(() => expect(messages).toEqual(['first', 'second']));
    source.end();
    await handle.closed;
  });

  it('fails the stream when an unterminated frame exceeds the buffer cap', async () => {
    const source = streamResponse();
    const errors: Error[] = [];
    const messages: string[] = [];
    const handle = openSseStream({
      url: 'http://sse.test/event', fetch: fetchFor(source), maxBufferLength: 64,
      onMessage: data => messages.push(data), onError: error => errors.push(error),
    });
    source.push('data: ok\n\n');
    source.push(`data: ${'x'.repeat(100)}`);
    await handle.closed;
    expect(messages).toEqual(['ok']);
    expect(errors.map(error => error.message)).toEqual(['SSE frame exceeds 64 characters']);
    expect(source.aborted()).toBe(true);
  });

  it('reports an idle stream as an error so the endpoint reconnects, and resets the timer on every chunk', async () => {
    vi.useFakeTimers();
    const source = streamResponse();
    const errors: Error[] = [];
    const onOpen = vi.fn();
    const handle = openSseStream({
      url: 'http://sse.test/event', fetch: fetchFor(source), idleTimeoutMs: 1_000,
      onMessage: () => undefined, onError: error => errors.push(error), onOpen,
    });
    let closed = false; void handle.closed.then(() => { closed = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(onOpen).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(900);
    source.push(': keep-alive\n\n');
    await vi.advanceTimersByTimeAsync(900);
    expect(closed).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(closed).toBe(true);
    expect(errors.map(error => error.message)).toEqual(['SSE idle for 1000ms']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stays silent on an explicit close and leaves no idle timer behind', async () => {
    vi.useFakeTimers();
    const source = streamResponse();
    const onError = vi.fn();
    const handle = openSseStream({ url: 'http://sse.test/event', fetch: fetchFor(source), onMessage: () => undefined, onError });
    await vi.advanceTimersByTimeAsync(0);
    handle.close();
    await handle.closed;
    expect(onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
