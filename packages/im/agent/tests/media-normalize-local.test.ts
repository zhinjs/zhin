import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { normalizeContentPartsToPayloads } from '../src/media/media-normalize.js';

describe('normalizeContentPartsToPayloads local files', () => {
  it('reads local image path into base64 payload', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-media-'));
    const filePath = path.join(dir, 'test.png');
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await fs.writeFile(filePath, pngHeader);

    const payloads = await normalizeContentPartsToPayloads(
      [{ type: 'image_url', image_url: { url: filePath } }],
      1024 * 1024,
    );

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.kind).toBe('image');
    expect(payloads[0]?.mimeType).toBe('image/png');
    expect(payloads[0]?.base64.length).toBeGreaterThan(0);

    await fs.rm(dir, { recursive: true, force: true });
  });
});
