import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_AGENT_ATTACHMENTS,
  authorizeActorAttachments,
  collectTurnAttachments,
  recordActorAttachments,
  renderAttachmentNote,
  resolveAttachmentRefs,
  takeActorAttachments,
} from '../../src/media/agent-attachments.js';

describe('agent attachments (#1250 subagent-image-result-passthrough)', () => {
  it('collects tool media once, never media links the model wrote into its reply', () => {
    const attachments = collectTurnAttachments([
      { tool: 'generate_image', result: JSON.stringify({ image_url: 'https://x/a.png' }) },
      { tool: 'generate_image', result: JSON.stringify({ image_url: 'https://x/a.png' }) },
      { tool: 'generate_image', result: JSON.stringify({ image_url: 'https://x/b.png' }) },
      { tool: 'read_file', result: 'text' },
    ]);
    expect(attachments).toEqual([
      { type: 'image', url: 'https://x/a.png' },
      { type: 'image', url: 'https://x/b.png' },
    ]);
  });

  it('caps the number of attachments', () => {
    const calls = Array.from({ length: MAX_AGENT_ATTACHMENTS + 3 }, (_, index) => ({
      tool: 'generate_image', result: JSON.stringify({ image_url: `https://x/${index}.png` }),
    }));
    expect(collectTurnAttachments(calls)).toHaveLength(MAX_AGENT_ATTACHMENTS);
  });

  it('hands recorded media to the first taker of a mail only, per harness', () => {
    const harness = {};
    recordActorAttachments(harness, ['m1'], [{ type: 'image', url: 'https://x/a.png' }]);
    expect(takeActorAttachments({}, 'm1')).toEqual([]);
    expect(takeActorAttachments(harness, 'm1')).toEqual([{ type: 'image', url: 'https://x/a.png' }]);
    expect(takeActorAttachments(harness, 'm1')).toEqual([]);
  });

  it('renders opaque references that resolve once', () => {
    const note = renderAttachmentNote('draw', [{ type: 'image', url: 'https://x/a.png' }, { type: 'file', url: 'https://x/r.pdf', name: 'r.pdf' }]);
    expect(note).toContain('#1 image');
    expect(note).toContain('#2 file r.pdf');
    expect(resolveAttachmentRefs(note)).toHaveLength(2);
    expect(resolveAttachmentRefs(note)).toEqual([]);
    expect(renderAttachmentNote('draw', [])).toBe('');
  });

  it('authorizes each attachment with the sub-agent authority: local paths need its file authority', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-actor-media-'));
    try {
      await mkdir(join(root, 'out'));
      await writeFile(join(root, 'out', 'chart.png'), 'png');
      const inline = { type: 'image' as const, url: 'data:image/png;base64,AAAA', base64: 'AAAA' };
      const remote = { type: 'image' as const, url: 'https://cdn.example/a.png' };
      const inside = { type: 'image' as const, url: join(root, 'out', 'chart.png') };
      const outside = { type: 'file' as const, url: '/etc/passwd', name: 'passwd' };
      const fileUrl = { type: 'file' as const, url: 'file:///etc/hostname', name: 'hostname' };
      const odd = { type: 'image' as const, url: 'ftp://example.com/a.png' };
      const all = [inline, remote, inside, outside, fileUrl, odd];

      const withFiles = await authorizeActorAttachments(all, { filesystem: { workspaceRoot: root }, fileRole: 'user' });
      expect(withFiles.map(item => item.url)).toEqual([inline.url, remote.url, expect.stringContaining('chart.png')]);
      // No filesystem authority: every local path is dropped, inline and remote media still pass.
      const noFiles = await authorizeActorAttachments(all, {});
      expect(noFiles).toEqual([inline, remote]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
