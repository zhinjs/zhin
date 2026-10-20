import { jsx, renderToHtml, type JSXNode, type JSXRenderable } from '@zhin.js/jsx';
import { Card, DualSection } from '../src/layout.js';
import { KvTable, Badge } from '../src/display.js';
import { Sparkline } from '../src/charts.js';
import { List, ListItem } from '../src/list.js';
import { Markdown } from '../src/markdown.js';
import { ThemeProvider } from '../src/theme.js';
import { styleObject } from '../src/styles.js';
import { tint } from '../src/utilities.js';
import { renderImage, colorBox } from './render-image.js';

describe('component review regressions', () => {
  it('ignores CSS comment separators without treating comment-like quoted values as comments', async () => {
    const style = 'color: red; /* ;: ") */ background: blue; padding: 8px; content: "/*;*/"; background-image:url("data:x;a:b")';
    expect(styleObject(style)).toEqual({ color: 'red', background: 'blue', padding: '8px', content: '"/*;*/"', backgroundImage: 'url("data:x;a:b")' });
    const html = await renderToHtml(jsx(Card, { custom: { style }, children: 'content' }));
    expect(html).toContain('background: blue');
    expect(html).toContain('padding: 8px');
    expect(html).not.toContain('/* ;:');
    expect(styleObject('/* leading:; */color: red/* inside; comment */; margin: 0')).toEqual({ color: 'red', margin: '0' });
  });

  it.each(['purple', 'orange', 'yellow', 'silver', 'rgb(1, 2, 3)', 'var(--accent)', '#nothex'])('preserves non-hex CSS color %s without NaN', (color) => {
    expect(tint(color, 0.25)).toBe(color);
  });
  it('expands shorthand hex before applying the requested tint alpha', () => {
    expect(tint('#abc', 0.25)).toBe('rgba(170,187,204,0.25)');
    expect(tint('#ABCDEF', 0.5)).toBe('rgba(171,205,239,0.5)');
  });

  it.each([[-5, -2, -4], [-5, 0, 5], [-3, -3, -3], [0, 0, 0]])('keeps Sparkline samples %j inside the viewBox', async (...values: number[]) => {
    const html = await renderToHtml(jsx(Sparkline, { values, width: 120, height: 32 }));
    const points = html.match(/points="([^"]+)"/)![1]!.split(' ').map(point => point.split(',').map(Number));
    expect(points).toHaveLength(values.length);
    for (const [x, y] of points) { expect(x).toBeGreaterThanOrEqual(2); expect(x).toBeLessThanOrEqual(118); expect(y).toBeGreaterThanOrEqual(2); expect(y).toBeLessThanOrEqual(30); }
    if (new Set(values).size === 1) expect(points.map(point => point[1])).toEqual(values.map(() => 16));
    const image = await renderImage(html, 120);
    const line = colorBox(image, '#3b82f6');
    expect(line.x).toBeGreaterThanOrEqual(0);
    expect(line.x + line.width).toBeLessThanOrEqual(120);
    expect(line.height).toBeLessThanOrEqual(32);
    expect(line.pixels).toBeGreaterThan(20);
  });

  it('rejects unsafe List starts and overflow instead of repeating an ordinal', async () => {
    for (const start of [Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1, Infinity, 1.5]) {
      await expect(renderToHtml(jsx(List, { ordered: true, start, items: ['A'] }))).rejects.toThrow('safe finite integer');
    }
    expect(await renderToHtml(jsx(List, { ordered: true, start: Number.MAX_SAFE_INTEGER, items: ['A'] }))).toContain('9007199254740991. ');
    await expect(renderToHtml(jsx(List, { ordered: true, start: Number.MAX_SAFE_INTEGER, items: ['A', 'B'] }))).rejects.toThrow('safe integer range');
  });

  it('composes ordered markers with each item’s scoped rank separator', async () => {
    const html = await renderToHtml(jsx(List, { ordered: true, start: 2, children: [
      jsx(ThemeProvider, { theme: { text: { rankSeparator: jsx('b', { children: ' → ' }) } }, children: jsx(ListItem, { children: 'Inner' }) }),
      jsx(ListItem, { children: 'Outer' }),
    ] }));
    expect(html).toContain('>2<b> → </b></div>');
    expect(html).toContain('>3. </div>');
  });

  it('does not evaluate unknown List children until serialization', async () => {
    const child = vi.fn(() => jsx('span', { children: 'Lazy' }));
    const tree = List({ ordered: true, children: [jsx(child, {}), jsx(ListItem, { children: 'First' })] });
    expect(child).not.toHaveBeenCalled();
    const html = await renderToHtml(tree);
    expect(child).toHaveBeenCalledTimes(1);
    expect(html).toContain('>1. </div>');
    expect(html).not.toContain('>2. </div>');
  });

  it('counts empty GFM table rows and cells within the token budget', async () => {
    const emptyRow = '|'.repeat(101);
    const separator = `|${Array.from({ length: 100 }, () => '---').join('|')}|`;
    const source = [emptyRow, separator, ...Array.from({ length: 101 }, () => emptyRow)].join('\n');
    expect(source.length).toBeLessThan(100_000);
    await expect(renderToHtml(jsx(Markdown, { source }))).rejects.toThrow('maximum token count 10000');
    expect(await renderToHtml(jsx(Markdown, { source: '| | |\n|---|---|\n| | |' }))).toContain('role="cell"');
  });

  it('preserves awaiting promise children while applying the exact surrounding theme', async () => {
    const observed: unknown[] = [];
    async function AwaitChild(props: { children?: JSXRenderable }): Promise<JSXNode> {
      expect(typeof (props.children as PromiseLike<unknown>).then).toBe('function');
      const child = await props.children;
      observed.push(child);
      return child;
    }
    const shared = Promise.resolve(jsx(Badge, { text: 'shared' }));
    const [primitive, blue, red] = await Promise.all([
      renderToHtml(jsx(ThemeProvider, { theme: {}, children: jsx(AwaitChild, { children: Promise.resolve('value') }) })),
      renderToHtml(jsx(ThemeProvider, { theme: { palette: { accentSwap: 'blue' } }, children: jsx(AwaitChild, { children: shared }) })),
      renderToHtml(jsx(ThemeProvider, { theme: { palette: { accentSwap: 'red' } }, children: jsx(AwaitChild, { children: shared }) })),
    ]);
    expect(primitive).toBe('value');
    expect(observed).toContain('value');
    expect(blue).toContain('color: blue'); expect(blue).not.toContain('color: red');
    expect(red).toContain('color: red'); expect(red).not.toContain('color: blue');
  });

  it('supports bold rows through KvTable and both DualSection columns', async () => {
    const rows = [{ label: 'Bold', value: 'value', bold: true }];
    const html = await renderToHtml([jsx(KvTable, { rows }), jsx(DualSection, { left: { title: 'L', rows }, right: { title: 'R', rows } })]);
    expect(html.match(/color: #111111; font-size: 12px; line-height: [^;]+; font-weight: 600/g)).toHaveLength(3);
  });
});
