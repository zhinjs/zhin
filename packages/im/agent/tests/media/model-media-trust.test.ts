import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OutboundRenderer, untrustedContent } from '@zhin.js/core/runtime';
import type { Segment } from '@zhin.js/im-contract';
import type { RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { publishOutboundElements } from '../../src/media/media-publisher.js';
import { modelMediaTrust, type OutboundMediaAuthority } from '../../src/media/media-normalize.js';
import { decodeStructuredReply } from '../../src/outbound/structured-reply.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const CAPS = { image: true, audio: true, video: true, file: true } as const;
const snapshot = { root: 'plugin:root', projections: new Map(), resources: new Map([['plugin:root', new Map()]]) } as unknown as RuntimeSnapshot;
const conversation = { endpoint: { id: 'napcat:bot', adapter: 'napcat' }, kind: 'group', id: '1' } as const;

/** The Agent reply path up to the adapter: decode → publish (Turn authority) → Core renderer. */
async function deliverModelReply(json: string, authority: OutboundMediaAuthority, caps: Record<string, unknown> = CAPS): Promise<Segment[]> {
  const elements = decodeStructuredReply(json);
  const content = await publishOutboundElements(elements, 'napcat', caps as never, authority);
  return await new OutboundRenderer().render(untrustedContent(content, modelMediaTrust('agent:reply', authority)), {
    requester: 'plugin:agent' as never, snapshot, conversation,
  }) as Segment[];
}

const reply = (...segments: unknown[]) => JSON.stringify({ messages: [{ segments }] });
const media = (segments: Segment[]) => segments.map(segment => (segment.data as { media?: { kind: string; value: string } }).media);

describe('Agent model media and the untrusted-source policy', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-model-media-')));
    await fs.mkdir(path.join(workspace, '.git'));
    await fs.writeFile(path.join(workspace, '.git', 'config'), '[remote "origin"]\n  url = https://user:token@example.com/x.git\n');
    await fs.writeFile(path.join(workspace, 'package.json'), '{"name":"bot"}');
    await fs.writeFile(path.join(workspace, 'chart.png'), PNG);
  });
  afterEach(async () => { await fs.rm(workspace, { recursive: true, force: true }); });

  const authority = (fileRole?: OutboundMediaAuthority['fileRole']): OutboundMediaAuthority => ({
    filesystem: { workspaceRoot: workspace }, ...(fileRole ? { fileRole } : {}),
  });

  it('reproduction: a model `file` ref naming a host file used to pass the publisher unchanged', async () => {
    const elements = decodeStructuredReply(reply(
      { type: 'image', data: { media: { kind: 'file', value: 'file:///etc/passwd' } } },
      { type: 'file', data: { media: { kind: 'file', value: '/etc/passwd' } } },
    ));
    // The publisher treats `file` as an opaque platform reference; OneBot / NapCat read such a value from the host.
    const published = await publishOutboundElements(elements, 'napcat', CAPS as never, authority());
    expect(media(published)).toEqual([
      { kind: 'file', value: 'file:///etc/passwd' },
      { kind: 'file', value: '/etc/passwd' },
    ]);
    // Through Core's untrusted-source policy neither reaches the adapter.
    const delivered = await deliverModelReply(reply(
      { type: 'image', data: { media: { kind: 'file', value: 'file:///etc/passwd' } } },
      { type: 'file', data: { media: { kind: 'file', value: '/etc/passwd' } } },
    ), authority());
    expect(delivered.map(segment => segment.type)).toEqual(['text', 'text']);
    expect(JSON.stringify(delivered)).not.toContain('passwd');
  });

  it('applies the initiator file role to model-referenced workspace files (same as read_file)', async () => {
    const asUser = await deliverModelReply(reply(
      { type: 'file', data: { media: { kind: 'path', value: '.git/config' } } },
      { type: 'file', data: { media: { kind: 'path', value: 'package.json' } } },
    ), authority());
    expect(asUser.map(segment => segment.type)).toEqual(['text', 'text']);
    const asOwner = await deliverModelReply(reply(
      { type: 'file', data: { media: { kind: 'path', value: 'package.json' } } },
    ), authority('owner'));
    expect(asOwner[0]?.type).toBe('file');
  });

  it('keeps legitimate workspace media (generated charts, screenshots) deliverable', async () => {
    const delivered = await deliverModelReply(reply(
      { type: 'image', data: { media: { kind: 'path', value: 'chart.png' } } },
    ), authority());
    expect(delivered[0]?.type).toBe('image');
    expect(media(delivered)[0]?.kind).toBe('base64');
  });

  it('keeps large media the Agent spooled to a temp file (trusted construction)', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(40_000)]);
    await fs.writeFile(path.join(workspace, 'shot.png'), big);
    const delivered = await deliverModelReply(reply(
      { type: 'image', data: { media: { kind: 'path', value: 'shot.png' } } },
    ), authority(), { ...CAPS, spool: true });
    expect(delivered[0]?.type).toBe('image');
    const spooled = media(delivered)[0]!;
    expect(spooled.kind).toBe('path');
    expect(spooled.value).toContain('zhin-outbound-media');
    await fs.rm(spooled.value, { force: true });
  });

  it('refuses a spool-directory path the model names itself', async () => {
    const delivered = await new OutboundRenderer().render(untrustedContent([
      { type: 'image', data: { media: { kind: 'path', value: path.join(os.tmpdir(), 'zhin-outbound-media', 'image-0.png') } } } as Segment,
    ], modelMediaTrust('agent:reply', authority())), { requester: 'plugin:agent' as never, snapshot, conversation }) as Segment[];
    expect(delivered[0]?.type).toBe('text');
  });
});
