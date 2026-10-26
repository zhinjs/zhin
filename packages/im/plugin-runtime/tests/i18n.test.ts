import { createMessages } from '../src/i18n.js';

it('keeps locales explicit and interpolates user values exactly once', async () => {
  const t = createMessages({ greet: { 'zh-CN': '你好 {name}', en: 'Hello {name}' } });
  expect(await Promise.all([Promise.resolve(t('en', 'greet', { name: '{name}<script>' })),
    Promise.resolve(t('zh-CN', 'greet', { name: '世界' }))])).toEqual(['Hello {name}<script>', '你好 世界']);
});

it('rejects incomplete templates instead of silently hiding missing translations or values', () => {
  expect(() => createMessages({ count: { 'zh-CN': '{count} 项', en: 'Items' } })).toThrow('Invalid bilingual');
  const t = createMessages({ count: { 'zh-CN': '{count} 项', en: '{count} items ({count})' } });
  expect(() => t('en', 'count')).toThrow('Missing message value');
  expect(t(undefined, 'count', { count: 2 })).toBe('2 项');
});
