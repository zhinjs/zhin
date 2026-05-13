/**
 * Bing 结果 HTML 解析（与 bingAdapter 对齐的纯函数）
 */
import { describe, it, expect } from 'vitest';
import {
  extractBingResults,
  resolveBingUrl,
  hostnameMatchesList,
  buildBingSearchUrl,
} from '../../src/builtin/bing-search-html.js';

describe('resolveBingUrl', () => {
  it('跳过相对路径', () => {
    expect(resolveBingUrl('/foo')).toBeUndefined();
    expect(resolveBingUrl('#x')).toBeUndefined();
  });

  it('解析 ck/a 中 u= 的 base64 目标 URL', () => {
    const target = 'https://github.com/zhinjs/zhin';
    const b64 = Buffer.from(target, 'utf-8').toString('base64url');
    const raw = `https://www.bing.com/ck/a?p=1&u=a1${b64}&n=1`;
    expect(resolveBingUrl(raw)).toBe(target);
  });

  it('非 Bing 外链原样返回', () => {
    expect(resolveBingUrl('https://example.com/path')).toBe('https://example.com/path');
  });

  it('纯 bing.com 内部链丢弃', () => {
    expect(resolveBingUrl('https://www.bing.com/search?q=x')).toBeUndefined();
  });
});

describe('hostnameMatchesList', () => {
  it('精确与子域匹配', () => {
    expect(hostnameMatchesList('github.com', 'github.com')).toBe(true);
    expect(hostnameMatchesList('api.github.com', 'github.com')).toBe(true);
    expect(hostnameMatchesList('evilgithub.com', 'github.com')).toBe(false);
  });
});

describe('extractBingResults', () => {
  it('解析 b_algo 块中的标题、直连 URL 与 b_lineclamp 摘要', () => {
    const html = `
      <ol id="b_results">
        <li class="b_algo">
          <h2><a href="https://example.com/page">Repo &lt;b&gt;Title&lt;/b&gt;</a></h2>
          <p class="b_lineclamp_2">Snippet <b>bold</b> here</p>
        </li>
      </ol>`;
    const rows = extractBingResults(html);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toContain('Repo');
    expect(rows[0].title).toContain('Title');
    expect(rows[0].url).toBe('https://example.com/page');
    expect(rows[0].snippet).toContain('Snippet');
    expect(rows[0].snippet).toContain('bold');
  });

  it('buildBingSearchUrl 含编码与默认 setmkt=zh-CN', () => {
    expect(buildBingSearchUrl('a b')).toBe(
      'https://www.bing.com/search?q=a%20b&setmkt=zh-CN',
    );
    expect(buildBingSearchUrl('a b', 'en-US')).toContain('setmkt=en-US');
  });
});
