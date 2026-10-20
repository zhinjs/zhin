import { jsx, renderToHtml, type JSXNode } from '@zhin.js/jsx';
import { htmlToDOM, Element, Text, type DOMNode } from 'html-react-parser';
import { renderImage, colorBox } from './render-image.js';
import { CodeBlock } from '../src/code-block.js';
import { ThemeProvider } from '../src/theme.js';

function textContent(html: string): string {
  const text = (node: DOMNode): string => node instanceof Text ? node.data :
    node instanceof Element ? node.children.map(child => text(child as DOMNode)).join('') : '';
  return htmlToDOM(html).map(text).join('');
}

describe('CodeBlock', () => {
  it('renders actual Shiki token colors and escapes code without injecting HTML', async () => {
    const html = await renderToHtml(jsx(CodeBlock, {
      source: 'const html = "<script>&";\n\n  return html;', language: 'typescript', title: 'demo.ts',
    }));
    expect(html).toContain('demo.ts');
    expect(html).toContain('typescript');
    expect(html).toContain('#D73A49');
    expect(html).toContain('&lt;script&gt;&amp;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('>  <');
    expect([...html.matchAll(/data-code-line-number="(\d+)"/g)].map(match => match[1])).toEqual(['1', '2', '3']);
    expect(html).toContain('white-space: pre-wrap');
  });

  it('keeps an unknown language as plain escaped code with optional line numbers and wrapping', async () => {
    const html = await renderToHtml(jsx(CodeBlock, {
      source: '<custom> & plain\n  indented', language: 'custom-unknown-language', lineNumbers: false, wrap: false,
    }));
    expect(html).toContain('custom-unknown-language');
    expect(html).toContain('&lt;custom&gt; &amp; plain');
    expect(html).toContain('  indented');
    expect(html).not.toContain('data-code-line-number');
    expect(html).toContain('white-space: pre');
    expect(html).toContain('overflow-x: auto');
  });

  it('uses the exact surrounding code theme across async titles and concurrent scopes', async () => {
    async function Title(): Promise<JSXNode> { return jsx('b', { children: 'async.ts' }); }
    const source = 'const value = true;';
    const [light, dark] = await Promise.all([
      renderToHtml(jsx(CodeBlock, { source, language: 'ts', title: Title() })),
      renderToHtml(jsx(ThemeProvider, {
        theme: { code: { theme: 'github-dark', fontFamily: 'monospace', fontSize: 16 } },
        children: jsx(CodeBlock, { source, language: 'ts', title: Title() }),
      })),
    ]);
    expect(light).toContain('background: #fff');
    expect(light).toContain('#D73A49');
    expect(dark).toContain('background: #24292e');
    expect(dark).toContain('#F97583');
    expect(dark).toContain('font-size: 16px');
    expect(dark).toContain('<b>async.ts</b>');
  });

  it('makes root background and foreground overrides apply throughout the code block', async () => {
    const html = await renderToHtml(jsx(CodeBlock, {
      source: 'const answer = 42;', language: 'typescript',
      custom: { style: { background: '#112233', color: '#ffeeaa', borderRadius: 4, fontFamily: 'Poppins', fontSize: 16 } },
    }));
    expect(html).toContain('background: #112233');
    expect(html).toContain('color: #ffeeaa');
    expect(html).toContain('border-radius: 4px');
    expect(html).toContain('color: inherit');
    expect(html).not.toContain('#D73A49');
    expect(html).toContain('font-family: Poppins');
    expect(html).toContain('font-size: 16px');
    const image = await renderImage(html, 240);
    expect(colorBox(image, '#ffeeaa').pixels).toBeGreaterThan(20);
    expect(colorBox(image, '#112233')).toMatchObject({ x: 1, width: 238 });
  });

  it('keeps theme-provided, asynchronous, zero and explicitly hidden titles distinct', async () => {
    async function Title(): Promise<JSXNode> { return jsx('b', { children: '主题代码' }); }
    const themed = await renderToHtml(jsx(ThemeProvider, {
      theme: { text: { codeTitle: Title() } }, children: jsx(CodeBlock, { source: 'ok' }),
    }));
    expect(themed).toContain('<b>主题代码</b>');
    expect(await renderToHtml(jsx(CodeBlock, { source: 'ok', title: 0 }))).toMatch(/>0<\/div>/);
    const hidden = await renderToHtml(jsx(CodeBlock, { source: 'ok', custom: { text: { title: null } } }));
    expect(hidden).not.toContain('代码');
  });

  it('rejects oversized source and unknown themes without truncating source silently', async () => {
    await expect(CodeBlock({ source: 'x'.repeat(100_001) })).rejects.toThrow('exceeds 100000');
    await expect(CodeBlock({ source: 'ok', themeName: 'unknown-theme' })).rejects.toThrow('Unknown CodeBlock theme');
    const fallback = await renderToHtml(jsx(CodeBlock, { source: '<constructor>', language: 'constructor' }));
    expect(fallback).toContain('&lt;constructor&gt;');
  });

  it('fills standalone preview width and keeps its short-code title visible', async () => {
    const html = await renderToHtml(jsx(CodeBlock, { source: 'x', language: 'text' }));
    expect(textContent(html)).toContain('代码');
    const image = await renderImage(html, 540);
    expect(colorBox(image, '#ffffff')).toMatchObject({ x: 1, width: 538 });
    const title = colorBox(image, '#24292e');
    expect(title.width).toBeGreaterThan(10);
    expect(title.y).toBeLessThan(50);

  });

  it('renders real Chromium PNG including whitespace, long wrapped text and positive line numbers', async () => {
    const source = '  const label = "Long code that stays readable on a narrow card and wraps onto multiple lines";\n\n\treturn  label;';
    const html = await renderToHtml(jsx('div', {
      style: { display: 'flex', flexDirection: 'column', padding: 16, background: '#fff' },
      children: [
        jsx(CodeBlock, { source, language: 'typescript' }),
        jsx(CodeBlock, { source: '<plain> & escaped', language: 'unknown', lineNumbers: false }),
      ],
    }));
    const text = textContent(html);
    expect(text).toContain(source.split('\n')[0]);
    expect(text).toContain('\treturn  label;');
    expect(text).toContain('<plain> & escaped');
    const heights: number[] = [];
    for (const width of [100, 320]) {
      const image = await renderImage(html, width);
      expect(colorBox(image, '#D73A49').pixels).toBeGreaterThan(5);
      heights.push(image.height);
    }
    // The narrow render keeps every source character and allocates extra height
    // for wrapped lines rather than clipping or vertically stacking each token.
    expect(heights[0]).toBeGreaterThan(heights[1]!);
    expect(heights[1]).toBeGreaterThan(180);
  });
});
