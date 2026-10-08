import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { formatOutbound } from '../src/outbound.js';
import { qqDeliveryFailure } from '../src/delivery-error.js';

it('canonical base64 reaches the real SDK builder and upload decoder as the original image bytes', async () => {
  const require = createRequire(import.meta.url); const sdkRoot = dirname(require.resolve('qq-official-bot/package.json'));
  const { MessageBuilder } = require(join(sdkRoot, 'lib/message/builder.js'));
  const { FileProcessor } = require(join(sdkRoot, 'lib/message/file-processor.js'));
  const png = Buffer.from('iVBORw0KGgo=', 'base64');
  const wire = formatOutbound([{ type: 'text', data: { text: 'probe' } }, { type: 'image', data: { media: { kind: 'base64', value: png.toString('base64'), mime_type: 'image/png' } } }]);
  const result = await new MessageBuilder('fixture', false).build(wire);
  expect(result).toMatchObject({ isFile: true, filePayload: { file_type: 1, file: `base64://${png.toString('base64')}` } });
  const processor = new FileProcessor({}); processor.uploadByChunks = vi.fn(async () => ({ file_info: 'fixture' }));
  await processor.uploadForMessage(result.filePayload, { targetType: 'user', targetId: 'fixture' });
  expect(processor.uploadByChunks).toHaveBeenCalledWith(png, expect.objectContaining({ fileType: 1, targetType: 'user' }));
});
it('classifies an explicit upload rejection with sanitized protocol diagnostics', () => {
  const result = qqDeliveryFailure({ response: { status: 403, data: { code: 304023, message: 'secret credentials', response: 'private payload' } }, config: { url: '/v2/users/SECRET-USER/upload_prepare?access_token=SECRET-TOKEN', data: 'base64-secret' } });
  expect(result.failure).toMatchObject({ code: 'platform_rejected', disposition: 'rejected' });
  expect(result.diagnostic).toMatchObject({ stage: 'upload_prepare', httpStatus: 403, platformCode: 304023 });
  expect(JSON.stringify(result.diagnostic)).not.toMatch(/SECRET|private|credentials|base64/);
});
it('keeps network resets and server failures unknown instead of encouraging blind retries', () => {
  for (const error of [new Error('Request "/v2/users/secret/messages" failed with code(503): unavailable'), new Error('secret-url'), { response: { status: 503 }, config: { url: 'https://secret.example/signed-upload' } }]) {
    const result = qqDeliveryFailure(error); expect(result.failure.disposition).toBe('unknown'); expect(JSON.stringify(result.diagnostic)).not.toContain('secret');
  }
});
it('endpoint send exposes SDK upload rejection as a structured delivery error', async () => {
  const { QqWebsocketEndpoint } = await import('../src/endpoint.js');
  const { resolveQqConfig } = await import('../src/protocol.js');
  const { capabilityId, rootPluginId, featureId } = await import('zhin.js');
  const endpoint = new QqWebsocketEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'qq'), config: resolveQqConfig({ id: 'fixture', appid: 'fixture', secret: 'fixture' }) as any, createBot: () => ({ api: {}, start: async () => {}, stop: async () => {}, on: () => {}, removeAllListeners: () => {}, sendPrivateMessage: async () => { throw { response: { status: 403, data: { code: 304023 } }, config: { url: '/v2/users/fixture/upload_prepare' } }; } }) as any });
  try {
    await endpoint.start();
    await expect(endpoint.send({ conversation: { endpoint: { id: 'fixture', adapter: 'root/qq' }, kind: 'private', id: 'user' }, payload: [{ type: 'image', data: { media: { kind: 'base64', value: 'iVBORw0KGgo=' } } }] })).rejects.toMatchObject({ code: 'platform_rejected', disposition: 'rejected' });
  } finally { await endpoint.stop(); }
});

it('recovers only stage and numeric rejection from the SDK flattened error', () => {
  const result = qqDeliveryFailure(new Error('Request "/v2/users/SECRET-USER/upload_prepare?token=SECRET-TOKEN" failed with code(11256): private response payload'));
  expect(result.failure.disposition).toBe('rejected');
  expect(result.diagnostic).toMatchObject({ stage: 'upload_prepare', platformCode: 11256 });
  expect(JSON.stringify(result.diagnostic)).not.toMatch(/SECRET|private|payload/);
});

it.each(['legacy', 'rgb'])('real SDK preserves %s probe PNG bytes, type, filename and upload ID through the full upload flow', async (sample) => {
  const source = await readFile(new URL('../../../../scripts/platform-acceptance/probe-command.ts', import.meta.url), 'utf8');
  const value = sample === 'rgb' ? source.match(/const RGB_IMAGE_PNG = '([^']+)'/)![1] : source.match(/: '(iVBOR[^']+)'/)![1];
  const png = Buffer.from(value, 'base64');
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  let uploaded = Buffer.alloc(0);
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    uploaded = Buffer.concat(chunks); res.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    const require = createRequire(import.meta.url); const sdkRoot = dirname(require.resolve('qq-official-bot/package.json'));
    const { MessageBuilder } = require(join(sdkRoot, 'lib/message/builder.js'));
    const { FileProcessor } = require(join(sdkRoot, 'lib/message/file-processor.js'));
    const post = vi.fn(async (path: string) => ({ data: path.endsWith('/upload_prepare') ? {
      upload_id: 'fixture-upload', block_size: String(png.length),
      parts: [{ index: 0, block_size: String(png.length), presigned_url: `http://127.0.0.1:${address.port}/part` }],
    } : { file_info: 'fixture-media' } }));
    const result = await new MessageBuilder('fixture', false).build(formatOutbound([{ type: 'image', data: { media: { kind: 'base64', value, mime_type: 'image/png' } } }]));
    const output = await new FileProcessor({ post }).uploadForMessage(result.filePayload, { targetType: 'user', targetId: 'fixture' });
    expect(output).toEqual({ file_info: 'fixture-media' });
    expect(uploaded).toEqual(png);
    expect(post.mock.calls[0]).toEqual(['/v2/users/fixture/upload_prepare', expect.objectContaining({ file_type: 1, file_name: 'image.png', file_size: String(png.length), md5: createHash('md5').update(png).digest('hex') }), { timeout: 30000 }]);
    expect(post.mock.calls[1]).toEqual(['/v2/users/fixture/upload_part_finish', expect.objectContaining({ upload_id: 'fixture-upload', part_index: 0, block_size: String(png.length) }), { timeout: 30000 }]);
    expect(post.mock.calls[2]).toEqual(['/v2/users/fixture/files', { file_type: 1, file_name: 'image.png', srv_send_msg: false, upload_id: 'fixture-upload' }, { timeout: 30000 }]);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

it('follows official zero-based three-part response with concurrent PUTs, a short final block and identical retry bytes', async () => {
  // Official response shape: index 0/1/2, top-level block_size, per-part block_size.
  // Scale the example down; unequal bytes distinguish offsets and the short tail.
  const blockSize = 1024; const data = Buffer.concat([Buffer.alloc(blockSize, 11), Buffer.alloc(blockSize, 22), Buffer.alloc(317, 33)]);
  const uploaded = new Map<number, Buffer[]>();
  const server = createServer(async (req, res) => {
    const index = Number(req.url?.slice(1)); const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const attempts = uploaded.get(index) ?? []; attempts.push(Buffer.concat(chunks)); uploaded.set(index, attempts);
    if (index === 1 && attempts.length === 1) res.statusCode = 503;
    res.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    const require = createRequire(import.meta.url); const sdkRoot = dirname(require.resolve('qq-official-bot/package.json'));
    const { FileProcessor } = require(join(sdkRoot, 'lib/message/file-processor.js'));
    const post = vi.fn(async (path: string) => ({ data: path.endsWith('/upload_prepare') ? {
      upload_id: 'official-fixture', block_size: String(blockSize),
      // Array order is deliberately different from index order.
      parts: [2, 0, 1].map(index => ({ index, block_size: String(index === 2 ? 317 : blockSize), presigned_url: `http://127.0.0.1:${address.port}/${index}` })),
      upload_config: { concurrency: 3, retry_timeout: 2, retry_delay: 0.01 },
    } : { file_info: 'fixture' } }));
    await new FileProcessor({ post }).uploadByChunks(data, { targetType: 'user', targetId: 'fixture', fileType: 1, fileName: 'image.png' });
    expect(uploaded.get(1)).toHaveLength(2);
    for (let index = 0; index < 3; index++) {
      const expected = data.subarray(index * blockSize, (index + 1) * blockSize);
      for (const bytes of uploaded.get(index)!) expect(bytes).toEqual(expected);
      expect(post.mock.calls).toContainEqual(['/v2/users/fixture/upload_part_finish', { upload_id: 'official-fixture', part_index: index, block_size: String(expected.length), md5: createHash('md5').update(expected).digest('hex') }, { timeout: 30000 }]);
    }
    expect(post.mock.calls[0]).toEqual(['/v2/users/fixture/upload_prepare', { file_type: 1, file_size: String(data.length), file_name: 'image.png', md5: createHash('md5').update(data).digest('hex'), sha1: createHash('sha1').update(data).digest('hex'), md5_10m: createHash('md5').update(data).digest('hex') }, { timeout: 30000 }]);
    expect(post.mock.calls.at(-1)).toEqual(['/v2/users/fixture/files', { file_type: 1, file_name: 'image.png', srv_send_msg: false, upload_id: 'official-fixture' }, { timeout: 30000 }]);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
