import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { RenderResult } from '../src/index.js';
import { readImageSize } from '../src/image.js';

// Blink's native lifetime is process-wide. A fresh OS process makes this test
// independent of Vitest worker reuse and other files calling stop().
let results: RenderResult[];
beforeAll(async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [
    '--import', 'tsx', fileURLToPath(new URL('./native-renderer-worker.mjs', import.meta.url)),
  ], { timeout: 15_000, maxBuffer: 1_000_000 });
  const encoded: Array<Omit<RenderResult, 'data'> & { data: string }> = JSON.parse(stdout);
  results = encoded.map(result => ({ ...result, data: Buffer.from(result.data, 'base64') }));
}, 20_000);

describe('published Shotium native rendering', () => {
  it.each(['png', 'jpeg', 'webp'] as const)('returns real %s bytes and dimensions', format => {
    const result = results.find(result => result.format === format)!;
    expect(result.format).toBe(format);
    expect(result.mimeType).toBe(`image/${format}`);
    expect(result.width).toBe(240);
    expect(result.height).toBe(96);
    expect(readImageSize(result.data)).toEqual({ width: 240, height: 96 });
    expect(result.data.byteLength).toBeGreaterThan(100);
    if (format === 'png') {
      expect(result.data.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    } else if (format === 'jpeg') {
      expect(result.data.subarray(0, 2).toString('hex')).toBe('ffd8');
    } else {
      expect(result.data.subarray(0, 4).toString()).toBe('RIFF');
      expect(result.data.subarray(8, 12).toString()).toBe('WEBP');
    }
  });
});
