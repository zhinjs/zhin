import listTool from '../skills/rss/tools/rss_list_subscriptions/index.js';
import previewTool from '../skills/rss/tools/rss_preview_feed/index.js';
import * as feed from '../src/feed.js';
import { createInMemoryRssDb, getRssSubs } from '../src/db-store.js';
import { rssRuntimeToken, type RssRuntime } from '../src/runtime.js';

function setup(locale: 'en' | 'zh-CN') {
  const runtime: RssRuntime = { db: createInMemoryRssDb(), config: feed.resolveRssConfig({}), outbound: null };
  const context = { locale, use: (token: unknown) => {
    if (token === rssRuntimeToken) return runtime;
    throw new Error('unexpected token');
  } };
  return { runtime, context };
}
afterEach(() => vi.restoreAllMocks());
it('localizes RSS tool inventory without translating feed names or machine scopes', async () => {
  const { runtime, context } = setup('en');
  expect(await listTool.execute({}, context as never)).toBe('There are no RSS subscriptions');
  await getRssSubs(runtime.db)!.insert({ url: 'https://example.com/feed', feed_title: '用户源名', adapter_name: 'root/test', endpoint_id: 'bot', channel_type: 'group', channel_id: 'room', creator_id: '', creator_name: '', created_at: new Date().toISOString() });
  expect(await listTool.execute({}, context as never)).toBe('RSS subscriptions (1):\n[group:room]\n  - 用户源名');
  expect(await listTool.execute({}, { ...context, locale: 'zh-CN' } as never)).toContain('RSS 订阅总览');
});
it('localizes empty preview and error wrappers but keeps provider content intact', async () => {
  const { context } = setup('en');
  const fetch = vi.spyOn(feed, 'fetchFeed');
  fetch.mockResolvedValue({ title: '原始源名', items: [] });
  expect(await previewTool.execute({ url: 'https://example.com/feed' }, context as never)).toBe('原始源名: No items');
  fetch.mockResolvedValue({ title: '原始源名', items: [{ title: '原始文章', link: 'https://example.com/post', guid: 'id', date: '', summary: '' }] });
  expect(await previewTool.execute({ url: 'https://example.com/feed' }, context as never)).toBe('1. 原始文章\n   https://example.com/post');
  fetch.mockRejectedValue(new Error('第三方错误'));
  expect(await previewTool.execute({ url: 'https://example.com/feed' }, context as never)).toBe('Parsing failed: 第三方错误');
});
