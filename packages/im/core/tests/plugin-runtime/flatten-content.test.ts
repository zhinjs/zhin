// Outbound history and previews read component calls as text, not serialized JSON (#1250).
import { describe, expect, it } from 'vitest';
import { flattenContent, previewMessageContent } from '../../src/plugin-runtime/im/message-events.js';
import { component, raw, untrustedContent } from '../../src/plugin-runtime/im/contracts.js';

describe('flattenContent', () => {
  it('reads an unrendered component call as its name and title, never as JSON', () => {
    const card = component('status-card', { title: 'my-bot', lines: [{ label: 'RSS', value: '42MB' }] });
    expect(flattenContent(card)).toBe('[status-card] my-bot');
    expect(flattenContent(card)).not.toContain('$content');
    expect(flattenContent(component('badge', {}))).toBe('[badge]');
    expect(flattenContent(component('note', { children: ['你好', { type: 'text', data: { text: '，世界' } }] }))).toBe('你好，世界');
    expect(previewMessageContent(['卡片：', card])).toBe('卡片：[status-card] my-bot');
  });

  it('reads untrusted content as what it wraps and raw payloads as [raw]', () => {
    expect(flattenContent(untrustedContent('模型回复', { source: 'agent' }))).toBe('模型回复');
    expect(flattenContent(raw({ op: 1 }))).toBe('[raw]');
  });

  it('keeps the existing text and segment behaviour', () => {
    expect(flattenContent(['a', { type: 'text', data: { text: 'b' } }, { type: 'image', data: {} }])).toBe('ab[image]');
    expect(flattenContent({ other: 1 })).toBe('{"other":1}');
  });
});
