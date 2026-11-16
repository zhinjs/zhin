import { describe, expect, it } from 'vitest';
import { transformLinks } from './sync-adapter-docs.mjs';

const TREE = 'https://github.com/zhinjs/zhin/tree/main';

describe('transformLinks', () => {
  it('resolves ../ links against the README directory', () => {
    expect(transformLinks('[索引](../README.md)', 'weixin-ilink')).toBe(
      `[索引](${TREE}/plugins/adapters/README.md)`,
    );
  });

  it('resolves ./ links into the adapter package and keeps fragments', () => {
    expect(transformLinks('[卡片](./CARD-TEMPLATE.md#usage)', 'lark')).toBe(
      `[卡片](${TREE}/plugins/adapters/lark/CARD-TEMPLATE.md#usage)`,
    );
  });

  it('maps minimal-bot to the getting-started page and other examples to GitHub', () => {
    expect(transformLinks('[a](../../../examples/minimal-bot/)', 'qq')).toBe('[a](/getting-started/)');
    expect(transformLinks('[b](../../../examples/test-bot)', 'qq')).toBe(`[b](${TREE}/examples/test-bot)`);
  });

  it('leaves absolute and anchor links untouched', () => {
    const body = '[x](https://example.com/a) [y](#section) [z](/adapters/qq)';
    expect(transformLinks(body, 'qq')).toBe(body);
  });
});
