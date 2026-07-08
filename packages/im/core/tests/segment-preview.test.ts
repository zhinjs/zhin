import { describe, it, expect } from 'vitest';
import { formatSegmentPreview } from '../src/built/segment-contract/preview.js';
import { segment } from '../src/utils.js';

describe('formatSegmentPreview', () => {
    it('renders canonical text and mention', () => {
    expect(formatSegmentPreview({ type: 'text', data: { text: 'hello' } })).toBe('hello');
    expect(formatSegmentPreview({ type: 'mention', data: { target: '123', name: 'Bot' } }))
      .toBe('@Bot');
    expect(formatSegmentPreview({ type: 'mention', data: { target: 'all' } })).toBe('@all');
    expect(formatSegmentPreview({ type: 'mention', data: { target: '123' } })).toBe('@123');
  });

  it('renders MediaRef-backed image segments', () => {
    expect(formatSegmentPreview({
      type: 'image',
      data: { media: { kind: 'url', value: 'https://cdn.example.com/a.png' }, alt: 'pic' },
    })).toBe('[image:https://cdn.example.com/a.png alt=pic]');
    expect(formatSegmentPreview({
      type: 'image',
      data: { media: { kind: 'base64', value: 'abc123', mime_type: 'image/png' } },
    })).toBe('[image:base64:image/png[6]]');
  });

  it('renders reply, forward, face, and dice', () => {
    expect(formatSegmentPreview({ type: 'reply', data: { message_id: '99' } })).toBe('↩99');
    expect(formatSegmentPreview({
      type: 'forward',
      data: { forward_id: 'fwd-1', title: '聊天记录', messages: [[{ type: 'text', data: { text: 'a' } }]] },
    })).toBe('[forward:fwd-1 聊天记录 ×1]');
    expect(formatSegmentPreview({ type: 'face', data: { id: 123, name: '微笑' } }))
      .toBe('[face:123 微笑]');
    expect(formatSegmentPreview({ type: 'dice', data: { result: 4 } })).toBe('{dice}(4)');
  });

  it('renders AI-only segments for agent logs', () => {
    expect(formatSegmentPreview({ type: 'thinking', data: { text: 'planning' } }))
      .toBe('[thinking] planning');
    expect(formatSegmentPreview({ type: 'tool_call', data: { id: '1', name: 'search', arguments: {} } }))
      .toBe('[tool:search]');
  });
});

describe('segment.raw uses canonical preview', () => {
  it('joins mixed canonical segments', () => {
    const content = [
      segment.text('Hello'),
      { type: 'face', data: { text: '😊' } },
      segment.image({ kind: 'url', value: 'https://x.test/img.jpg' }),
      { type: 'reply', data: { message_id: '42' } },
    ];
    expect(segment.raw(content)).toBe('Hello{face}(😊)[image:https://x.test/img.jpg]↩42');
  });
});
