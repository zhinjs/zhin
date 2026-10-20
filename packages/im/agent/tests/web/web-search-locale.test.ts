import { describe, it, expect } from 'vitest';
import {
  acceptLanguageForMarket,
} from '../../src/web/web-search-locale.js';

describe('acceptLanguageForMarket', () => {
  it('含主语言回退权重', () => {
    expect(acceptLanguageForMarket('zh-CN')).toContain('zh-CN');
    expect(acceptLanguageForMarket('zh-CN')).toContain('zh;');
  });
});
