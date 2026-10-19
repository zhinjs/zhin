import { htmlRendererToken, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { ConversationRef } from '@zhin.js/im-contract';
import { projectOutboundPayload } from '../../src/plugin-runtime/im/outbound-projection.js';

const conversation = { endpoint: { id: 'adapter:test', adapter: 'test' }, kind: 'group', id: 'group-1' } as ConversationRef;
function snapshot(segments: object, failingRenderer = false): RuntimeSnapshot {
  return {
    root: 'root', tree: new Map(),
    capabilities: new Map([['adapter:test', { definition: { segments } }]]),
    resources: new Map([['root', new Map(failingRenderer ? [[htmlRendererToken.id, {
      render: async () => { throw new Error('renderer unavailable'); },
    }]] : [])]]),
  } as unknown as RuntimeSnapshot;
}

describe('readable fallback in actual outbound projection', () => {
  it('preserves a task action and list semantics on text-only endpoints', async () => {
    const result = await projectOutboundPayload({ type: 'markdown', data: {
      content: '- 已暂停\n  - [管理任务](https://example.org/tasks/1)',
    } }, conversation, snapshot({ markdown: 'text', outboundMedia: ['url'], supported: ['text'] }));
    expect(result.payload).toEqual([{ type: 'text', data: { text: '• 已暂停\n  • 管理任务 (https://example.org/tasks/1)' } }]);
    expect(result.rendering.fallbacks).toContain('markdown_text_policy');
  });

  it('preserves tables, alt text and actionable links when image rendering fails', async () => {
    const result = await projectOutboundPayload({ type: 'html', data: {
      html: '<table><tr><td>任务</td><td>暂停</td></tr></table><a href="https://example.org/tasks/1">管理</a><img alt="任务统计" src="data:image/png;base64,PRIVATE">',
    } }, conversation, snapshot({ outboundMedia: ['base64'], supported: ['text', 'image'] }, true));
    expect(result.payload).toEqual([{ type: 'text', data: { text: '任务 | 暂停\n\n管理 (https://example.org/tasks/1)[图片：任务统计]' } }]);
    expect(result.rendering).toEqual({ forms: ['text'], fallbacks: ['renderer_failed'] });
  });

  it('continues to prefer author-supplied HTML fallback', async () => {
    const result = await projectOutboundPayload({ type: 'html', data: {
      html: '<div>其他内容</div>', text: '作者指定的短文本',
    } }, conversation, snapshot({ outboundMedia: ['base64'] }, true));
    expect(result.payload).toEqual([{ type: 'text', data: { text: '作者指定的短文本' } }]);
  });
});
