import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { installQqUploadDiagnostics } from '../src/upload-diagnostics.js';

it('observes real SDK Axios interceptor ordering without exposing credentials, IDs or payloads and ejects on stop', async () => {
  const require = createRequire(import.meta.url); const root = dirname(require.resolve('qq-official-bot/package.json'));
  const { Client } = require(join(root, 'lib/client.js')); const { FileProcessor } = require(join(root, 'lib/message/file-processor.js'));
  const { ReceiverMode } = require(join(root, 'lib/receivers/index.js'));
  const client = new Client({ mode: ReceiverMode.WEBSOCKET, appid: 'SECRET-APP', secret: 'SECRET-TOKEN', logLevel: 'off' });
  const processor = new FileProcessor(client.request); client.fileProcessor = processor;
  const logs: unknown[] = []; const release = installQqUploadDiagnostics(client, metadata => logs.push(metadata));
  const original = processor.uploadByChunks;
  client.request.defaults.adapter = async (config: any) => ({ config, status: 200, statusText: 'OK', headers: {}, data: config.url.endsWith('/upload_prepare') ? {
    upload_id: 'SECRET-UPLOAD', block_size: '4', parts: [], privateBody: 'SECRET-PAYLOAD', token: 'SECRET-TOKEN',
  } : { file_info: 'SECRET-RESULT' } });
  try {
    await expect(processor.uploadByChunks(Buffer.from('PRIVATE-BYTES'), { targetType: 'user', targetId: 'SECRET-USER', fileType: 1, fileName: 'SECRET-NAME.png' })).rejects.toThrow('QQ upload protocol invalid: incomplete parts');
    expect(logs).toEqual([
      expect.objectContaining({ op: 'qq_upload_prepare', fileType: 1, fileSize: 13, actualSize: 13, sizeMatch: true, hashMatch: true }),
      expect.objectContaining({ op: 'qq_upload_prepared', blockSize: 4, partsCount: 0, partsPresent: true, coverageMatch: false }),
    ]);
    expect(JSON.stringify(logs)).not.toMatch(/SECRET|PRIVATE|http|Authorization|upload_id|file_name/);
    release(); expect(processor.uploadByChunks).not.toBe(original);
    await expect(processor.uploadByChunks(Buffer.from('PRIVATE-BYTES'), { targetType: 'user', targetId: 'SECRET-USER', fileType: 1 })).rejects.toThrow('QQ upload protocol invalid: incomplete parts');
    expect(logs).toHaveLength(2);
  } finally { release(); client.sessionManager.authManager.destroy(); }
});
