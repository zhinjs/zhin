import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Segment } from '@zhin.js/im-contract';
import { publishOutboundElements } from '../../src/media/media-publisher.js';
import type { OutboundMediaAuthority } from '../../src/media/media-normalize.js';

// Smallest valid PNG, so the magic-byte sniffing of the structured path accepts it.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const imageSegment = (media: Record<string, unknown>) => ({
  type: 'message' as const,
  segments: [{ type: 'image', data: { media } } as Segment],
});
const unavailable = (segments: Segment[]) =>
  segments.length === 1 && segments[0]!.type === 'text' && String(segments[0]!.data.text).includes('附件不可用');

describe('publishOutboundElements with Turn media authority', () => {
  let workspace: string;
  let outside: string;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-media-ws-'));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-media-out-'));
    await fs.writeFile(path.join(workspace, 'chart.png'), PNG);
    await fs.writeFile(path.join(outside, 'secret.png'), PNG);
    await fs.writeFile(path.join(outside, 'secret.txt'), 'token=abc');
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(PNG, { status: 200 }));
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  const authority = (network?: OutboundMediaAuthority['network']): OutboundMediaAuthority => ({
    filesystem: { workspaceRoot: workspace },
    ...(network ? { network } : {}),
  });

  it('sends a workspace file the Turn may read', async () => {
    const segments = await publishOutboundElements([imageSegment({ kind: 'path', value: 'chart.png' })], 'sandbox', undefined, authority());
    expect(segments[0]?.type).toBe('image');
  });

  it('refuses a model-referenced path outside the Turn workspace', async () => {
    const segments = await publishOutboundElements(
      [imageSegment({ kind: 'path', value: path.join(outside, 'secret.png') })], 'sandbox', undefined, authority(),
    );
    expect(unavailable(segments)).toBe(true);
  });

  it('refuses a path when the Turn has no filesystem authority', async () => {
    const segments = await publishOutboundElements([imageSegment({ kind: 'path', value: 'chart.png' })], 'sandbox', undefined, {});
    expect(unavailable(segments)).toBe(true);
  });

  it('does not fetch a URL when the Turn has no network authority', async () => {
    const segments = await publishOutboundElements(
      [imageSegment({ kind: 'url', value: 'https://example.com/a.png?leak=1' })], 'sandbox', undefined, authority(),
    );
    expect(unavailable(segments)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('applies the Turn domain allowlist to model-referenced URLs', async () => {
    const network = { enabled: true, httpsOnly: true, allowedDomains: ['cdn.example.com'] };
    const denied = await publishOutboundElements(
      [imageSegment({ kind: 'url', value: 'https://evil.example.org/a.png' })], 'sandbox', undefined, authority(network),
    );
    expect(unavailable(denied)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    const allowed = await publishOutboundElements(
      [imageSegment({ kind: 'url', value: 'https://cdn.example.com/a.png' })], 'sandbox', undefined, authority(network),
    );
    expect(allowed[0]?.type).toBe('image');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('holds legacy media elements to the same authority (no arbitrary file attachment)', async () => {
    const segments = await publishOutboundElements(
      [{ type: 'file', url: path.join(outside, 'secret.txt') } as never], 'sandbox', undefined, authority(),
    );
    expect(segments.some(segment => segment.type === 'file')).toBe(false);
  });

  it('keeps the previous behaviour for trusted host callers that pass no authority', async () => {
    const segments = await publishOutboundElements([imageSegment({ kind: 'path', value: path.join(outside, 'secret.png') })], 'sandbox');
    expect(segments[0]?.type).toBe('image');
  });
});
