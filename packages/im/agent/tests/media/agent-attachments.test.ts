import { describe, expect, it } from 'vitest';
import {
  MAX_AGENT_ATTACHMENTS,
  collectTurnAttachments,
  recordActorAttachments,
  renderAttachmentNote,
  resolveAttachmentRefs,
  takeActorAttachments,
} from '../../src/media/agent-attachments.js';

describe('agent attachments (#1250 subagent-image-result-passthrough)', () => {
  it('collects output media and tool media once, without text', () => {
    const attachments = collectTurnAttachments(
      [{ type: 'text', content: 'hi' }, { type: 'image', url: 'https://x/a.png' }, { type: 'file', url: 'https://x/r.pdf', name: 'r.pdf' }],
      [
        { tool: 'generate_image', result: JSON.stringify({ image_url: 'https://x/a.png' }) },
        { tool: 'generate_image', result: JSON.stringify({ image_url: 'https://x/b.png' }) },
        { tool: 'read_file', result: 'text' },
      ],
    );
    expect(attachments).toEqual([
      { type: 'image', url: 'https://x/a.png' },
      { type: 'file', url: 'https://x/r.pdf', name: 'r.pdf' },
      { type: 'image', url: 'https://x/b.png' },
    ]);
  });

  it('caps the number of attachments', () => {
    const calls = Array.from({ length: MAX_AGENT_ATTACHMENTS + 3 }, (_, index) => ({
      tool: 'generate_image', result: JSON.stringify({ image_url: `https://x/${index}.png` }),
    }));
    expect(collectTurnAttachments(undefined, calls)).toHaveLength(MAX_AGENT_ATTACHMENTS);
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
});
