import { describe, expect, it } from 'vitest';
import { escapeHtml as jsxEscapeHtml } from '../../packages/im/jsx/src/render.js';
import { escapeHtml } from '../../packages/im/plugin-runtime/src/escape-html.js';

/**
 * #1250 b80: `@zhin.js/plugin-runtime` owns the HTML escaper of the IM stack; `@zhin.js/jsx` (a leaf
 * that depends only on the IM contract) keeps its own copy for the serializer. Both escape the same
 * five characters the same way.
 */
describe('escapeHtml: plugin-runtime ≡ jsx', () => {
  it('escapes & < > " and \' and nothing else', () => {
    expect(escapeHtml(`<a href="x" title='y'>&amp; ok</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;amp; ok&lt;/a&gt;');
    expect(escapeHtml('plain 中文 `code` /\\ =')).toBe('plain 中文 `code` /\\ =');
  });

  it('matches the jsx serializer escaper', () => {
    for (const value of ['', '&', '<>', '"\'', '&lt;', '<script>alert("x")</script>', `a'b"c&d<e>f`, '\u0000\n\t']) {
      expect(jsxEscapeHtml(value)).toBe(escapeHtml(value));
    }
  });
});
