import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { normalizeMediaRefsToPayloads } from '../src/media/media-normalize.js';

describe('normalizeMediaRefsToPayloads local files', () => {
  it('reads local image path ref into base64 payload', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-media-'));
    const filePath = path.join(dir, 'test.png');
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await fs.writeFile(filePath, pngHeader);

    const payloads = await normalizeMediaRefsToPayloads(
      [{ type: 'image', media: { kind: 'path', value: filePath } }],
      1024 * 1024,
    );

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.kind).toBe('image');
    expect(payloads[0]?.mimeType).toBe('image/png');
    expect(payloads[0]?.base64.length).toBeGreaterThan(0);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('skips platform-opaque file refs', async () => {
    const payloads = await normalizeMediaRefsToPayloads(
      [{ type: 'image', media: { kind: 'file', value: 'telegram-file-id' } }],
      1024 * 1024,
    );
    expect(payloads).toHaveLength(0);
  });

  it('reads base64 refs directly with segment type as kind hint', async () => {
    const payloads = await normalizeMediaRefsToPayloads(
      [{ type: 'audio', media: { kind: 'base64', value: 'YWFh', mime_type: 'audio/mpeg' } }],
      1024 * 1024,
    );
    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.kind).toBe('audio');
    expect(payloads[0]?.mimeType).toBe('audio/mpeg');
    expect(payloads[0]?.base64).toBe('YWFh');
  });
});
