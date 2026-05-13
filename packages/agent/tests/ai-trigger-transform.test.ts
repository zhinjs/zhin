import { describe, expect, it } from 'vitest';
import { extractMediaParts } from '../src/init/message-media.js';
import { renderOutput } from '../src/init/output-renderer.js';

function makeMessage(overrides: Record<string, unknown>) {
  return overrides as any;
}

describe('AI trigger message media extraction', () => {
  it('extracts structured image, audio, and face segments', () => {
    const parts = extractMediaParts(makeMessage({
      $content: [
        'hello',
        { type: 'image', data: { url: 'https://img.test/a.png' } },
        { type: 'voice', data: { base64: 'AAAA', format: 'wav' } },
        { type: 'face', data: { id: 123, text: 'smile' } },
      ],
    }));

    expect(parts).toEqual([
      { type: 'image_url', image_url: { url: 'https://img.test/a.png' } },
      { type: 'audio', audio: { data: 'AAAA', format: 'wav' } },
      { type: 'face', face: { id: '123', text: 'smile' } },
    ]);
  });

  it('falls back to raw XML and CQ image URLs', () => {
    const parts = extractMediaParts(makeMessage({
      $content: [],
      $raw: '<image url="https://img.test/a.png"/> [CQ:image,url=https://img.test/b.png]',
    }));

    expect(parts).toEqual([
      { type: 'image_url', image_url: { url: 'https://img.test/a.png' } },
      { type: 'image_url', image_url: { url: 'https://img.test/b.png' } },
    ]);
  });
});

describe('AI trigger output rendering', () => {
  it('renders mixed output elements to rich text markup', () => {
    expect(renderOutput([
      { type: 'text', content: 'hello' },
      { type: 'image', url: 'https://img.test/a.png' },
      { type: 'card', title: 'Card', description: 'desc', fields: [{ label: 'a', value: 'b' }] },
      { type: 'file', name: 'log.txt', url: 'file://log.txt' },
    ] as any)).toBe([
      'hello',
      '<image url="https://img.test/a.png"/>',
      '📋 Card\ndesc\n  a: b',
      '📎 log.txt: file://log.txt',
    ].join('\n'));
  });
});

