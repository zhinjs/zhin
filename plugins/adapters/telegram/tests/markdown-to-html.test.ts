import { describe, expect, it } from 'vitest';
import { markdownToTelegramHtml } from '../src/markdown-to-html.js';

describe('markdownToTelegramHtml', () => {
  it('protects fenced code with a linear delimiter scan', () => {
    const code = '_'.repeat(20_000);
    expect(markdownToTelegramHtml(`\`\`\`ts\n${code}\n\`\`\``)).toBe(
      `<pre><code class="language-ts">${code}</code></pre>`,
    );
  });

  it('emits links only for Telegram-safe schemes', () => {
    expect(markdownToTelegramHtml('[docs](https://zhin.dev)')).toBe(
      '<a href="https://zhin.dev">docs</a>',
    );
    expect(markdownToTelegramHtml('[run](javascript:alert)')).toBe('run');
  });
});
it('preserves literal JavaScript replacement tokens inside code', () => {
  expect(markdownToTelegramHtml('`$&`')).toBe('<code>$&amp;</code>');
  expect(markdownToTelegramHtml('```js\nconst replacement = "$&";\n```'))
    .toBe('<pre><code class="language-js">const replacement = &quot;$&amp;&quot;;</code></pre>');
});
