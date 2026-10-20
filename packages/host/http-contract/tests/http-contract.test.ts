import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { HttpBodyError, readJsonBody } from '../src/index.js';

function requestOf(chunks: readonly (string | Buffer)[]): IncomingMessage {
  return Readable.from(chunks) as IncomingMessage;
}

describe('readJsonBody', () => {
  it('空 body → undefined', async () => {
    expect(await readJsonBody(requestOf([]))).toBeUndefined();
    expect(await readJsonBody(requestOf(['   ']))).toBeUndefined();
  });

  it('合法 JSON → 解析结果', async () => {
    const body = await readJsonBody<{ a: number }>(requestOf(['{"a":', '1}']));
    expect(body).toEqual({ a: 1 });
  });

  it('非法 JSON → HttpBodyError 400', async () => {
    await expect(readJsonBody(requestOf(['not-json']))).rejects.toMatchObject({
      name: 'HttpBodyError',
      statusCode: 400,
    });
  });

  it('超过 limit → HttpBodyError 413，且请求被完全排空', async () => {
    const big = 'x'.repeat(64);
    const req = requestOf([big, big, big]);
    await expect(readJsonBody(req, { limit: 32 })).rejects.toMatchObject({
      name: 'HttpBodyError',
      statusCode: 413,
    });
    // 流已被消费完（fully drained），调用方可在同一 socket 上继续响应
    expect(req.readableEnded).toBe(true);
  });

  it('自定义 limit 内正常解析', async () => {
    const body = await readJsonBody(requestOf(['{"ok":true}']), { limit: 16 });
    expect(body).toEqual({ ok: true });
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
