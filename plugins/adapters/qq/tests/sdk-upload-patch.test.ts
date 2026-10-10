import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { inferQqUploadIndexBase } from '../src/upload-diagnostics.js';

async function fixture() {
  const require = createRequire(import.meta.url); const root = dirname(require.resolve('qq-official-bot/package.json'));
  const directory = await mkdtemp(join(tmpdir(), 'qq-upload-patch-'));
  await cp(join(root, 'lib'), join(directory, 'lib'), { recursive: true });
  await symlink(resolve(root, '..'), join(directory, 'node_modules'), 'dir');
  return { directory, require, FileProcessor: require(join(directory, 'lib/message/file-processor.js')).FileProcessor, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

it.each([[0, 3], [1, 3], [1, 1]])('real published SDK uploads complete bytes with index base %i and %i parts while preserving platform ACK indices', async (base, count) => {
  const sdk = await fixture(); const blockSize = count === 1 ? 257 : 100; const data = Buffer.from(Array.from({ length: count === 1 ? 257 : 237 }, (_, index) => index % 251));
  const uploads = new Map<number, Buffer>();
  const server = createServer(async (req, res) => { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); uploads.set(Number(req.url?.slice(1)), Buffer.concat(chunks)); res.end(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const parts = Array.from({ length: count }, (_, offset) => ({ index: offset + base, block_size: String(Math.min(blockSize, data.length - offset * blockSize)), presigned_url: `http://127.0.0.1:${port}/${offset + base}` })).reverse();
    expect(inferQqUploadIndexBase(parts, data.length, blockSize)).toBe(base);
    const post = vi.fn(async (path: string) => ({ data: path.endsWith('/upload_prepare') ? { upload_id: 'fixture', block_size: String(blockSize), parts, upload_config: { concurrency: 3 } } : { file_info: 'fixture' } }));
    await new sdk.FileProcessor({ post }).uploadByChunks(data, { targetType: 'user', targetId: 'fixture', fileType: 1 });
    for (let offset = 0; offset < count; offset++) {
      const bytes = data.subarray(offset * blockSize, (offset + 1) * blockSize); expect(uploads.get(offset + base)).toEqual(bytes);
      expect(post.mock.calls).toContainEqual(['/v2/users/fixture/upload_part_finish', { upload_id: 'fixture', part_index: offset + base, block_size: String(bytes.length), md5: createHash('md5').update(bytes).digest('hex') }, { timeout: 30000 }]);
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await sdk.cleanup(); }
});

it.each([
  [null, { index: 1, block_size: '100' }], [{}, {}], [], [{ index: 0, block_size: '100' }], [{ index: 0, block_size: '100' }, { index: 0, block_size: '100' }],
  [{ index: 1, block_size: '100' }, { index: 3, block_size: '100' }], [{ index: 2, block_size: '100' }, { index: 3, block_size: '100' }],
  [{ index: 0, block_size: '100' }, { index: 1, block_size: '0' }], [{ index: '0', block_size: '100' }, { index: 1, block_size: '100' }],
])('rejects malformed part set before any PUT, finish or complete (%j)', async (...items) => {
  const parts = items; const sdk = await fixture(); const prepareUpload = vi.fn(async () => ({ upload_id: 'fixture', block_size: '100', parts }));
  const processor = new sdk.FileProcessor({}); processor.prepareUpload = prepareUpload; processor.finishUploadPart = vi.fn(); processor.completeUpload = vi.fn();
  try {
    expect(inferQqUploadIndexBase(parts, 200, 100)).toBeUndefined();
    await expect(processor.uploadByChunks(Buffer.alloc(200), { targetType: 'user', targetId: 'fixture', fileType: 1 })).rejects.toThrow('QQ upload protocol invalid');
    expect(processor.finishUploadPart).not.toHaveBeenCalled(); expect(processor.completeUpload).not.toHaveBeenCalled();
  } finally { await sdk.cleanup(); }
});
