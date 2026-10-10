import { jsx, renderToHtml, type JSXStyle } from '@zhin.js/jsx';
import { Card, Row } from '../src/layout.js';
import { ThemeProvider } from '../src/theme.js';
import { mergeStyles, styleObject } from '../src/styles.js';
import { renderImage, colorBox } from './render-image.js';

const declarations = async (node: Parameters<typeof renderToHtml>[0]) =>
  styleObject((await renderToHtml(node)).match(/style="([^"]+)"/)![1]);
const expectAfter = (style: JSXStyle, later: string, earlier: string) => {
  const properties = Object.keys(style);
  expect(properties.indexOf(later)).toBeGreaterThan(properties.indexOf(earlier));
};

describe('component CSS declaration cascade', () => {
  it('replaces comments with token boundaries while preserving quoted literals', async () => {
    expect(styleObject('background:red/**/no-repeat; border:1px/**/solid/**/blue')).toMatchObject({
      background: 'red no-repeat', border: '1px solid blue',
    });
    expect(styleObject('color:red/* inline:; */; content:"a/**/b"')).toMatchObject({
      color: 'red', content: '"a/**/b"',
    });
    const image = await renderImage(await renderToHtml(jsx('div', {
      style: mergeStyles({ height: 12 }, 'background:#112233/**/no-repeat'),
    })), 120);
    expect(colorBox(image, '#112233')).toMatchObject({ width: 120, height: 12, pixels: 1440 });
  });

  it('preserves repeated declaration positions in CSS strings and aliased objects', () => {
    expect(Object.keys(styleObject('padding:24px; padding-top:12px; padding:0'))).toEqual(['paddingTop', 'padding']);
    expect(Object.keys(styleObject({ 'padding-top': 4, padding: 12, paddingTop: 8 }))).toEqual(['padding', 'paddingTop']);
    expect(styleObject('padding:24px;/* a; comment */padding-top:12px;padding:0')).toEqual({ paddingTop: '12px', padding: '0' });
  });

  it('keeps repeated properties in their final layer position', () => {
    expect(Object.keys(mergeStyles({ padding: 24 }, { paddingTop: 12, padding: 0 }))).toEqual(['paddingTop', 'padding']);
    expect(Object.keys(mergeStyles({ color: 'red', padding: 24 }, { paddingTop: 12, color: 'blue' }, { padding: 0 }))).toEqual(['paddingTop', 'color', 'padding']);
  });

  it('lets local padding shorthand override component defaults and project four-side overrides', async () => {
    const root = await declarations(jsx(ThemeProvider, {
      theme: {
        style: { padding: 36 },
        components: { Card: { paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16 } },
      },
      children: jsx(Card, { custom: { style: { padding: 0 } }, children: 'value' }),
    }));
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) expectAfter(root, 'padding', `padding${side}`);
    expect(root.padding).toBe('0');
  });

  it('retains longhands that follow a local shorthand and preserves the default otherwise', async () => {
    const base = await declarations(jsx(Card, { children: 'value' }));
    expect(base.padding).toBe('24px');
    const overridden = await declarations(jsx(Card, { custom: { style: { padding: 8, paddingTop: 12 } } }));
    expectAfter(overridden, 'paddingTop', 'padding');
    expect(overridden.padding).toBe('8px'); expect(overridden.paddingTop).toBe('12px');
    const reset = await declarations(jsx(Card, { custom: { style: 'padding-top:12px;padding:0' } }));
    expectAfter(reset, 'padding', 'paddingTop');
  });

  it('handles margin, border and radius shorthands without changing CSS values', async () => {
    const root = await declarations(jsx(Card, {
      custom: { style: { marginTop: 12, margin: 0, borderLeftWidth: 8, border: '0 solid transparent', borderTopLeftRadius: 40, borderRadius: 0 } },
    }));
    expectAfter(root, 'margin', 'marginTop');
    expectAfter(root, 'border', 'borderLeftWidth');
    expectAfter(root, 'borderRadius', 'borderTopLeftRadius');
    expect(root.border).toBe('0 solid transparent');
  });

  it('handles gap resets after project longhands, including nested providers', async () => {
    const root = await declarations(jsx(ThemeProvider, {
      theme: { components: { Row: { rowGap: 24, columnGap: 16, gap: 12 } } },
      children: jsx(ThemeProvider, {
        theme: { components: { Row: { rowGap: 8 } } },
        children: jsx(Row, { custom: { style: { gap: 0 } }, children: 'value' }),
      }),
    }));
    expectAfter(root, 'gap', 'rowGap'); expectAfter(root, 'gap', 'columnGap');
    expect(root.gap).toBe('0');
  });

  it('keeps explicit removals and zero values rather than resurrecting earlier declarations', () => {
    expect(mergeStyles({ padding: 24, color: 'red' }, { padding: 0, color: false })).toEqual({ padding: 0, color: false });
    expect(Object.keys(mergeStyles({ '--brand': 'red', color: 'red' }, { '--brand': 'blue' }))).toEqual(['color', '--brand']);
  });
});

describe('CSS declaration order in actual Chromium layout', () => {
  it.each([
    ['default', undefined, undefined, 24],
    ['four sides', undefined, { paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16 }, 16],
    ['late shorthand', undefined, { paddingTop: 12, padding: 0 }, 0],
    ['nested theme and local', { style: { padding: 36 }, components: { Card: { paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16 } } }, { padding: 0 }, 0],
    ['late longhand', undefined, { padding: 8, paddingTop: 12 }, 12],
    ['repeated string declaration', undefined, 'padding:24px; padding-top:12px; padding:0', 0],
  ] as const)('resolves %s padding without clipping or stale defaults', async (_, theme, local, top) => {
    const html = await renderToHtml(jsx(ThemeProvider, {
      theme,
      children: jsx(Card, {
        custom: { style: mergeStyles({ border: 0, borderRadius: 0, boxShadow: false, margin: 0 }, local) },
        children: jsx('div', { style: { width: '100%', height: 10, background: '#112233' } }),
      }),
    }));
    const image = await renderImage(html, 240);
    const inner = colorBox(image, '#112233');
    const side = typeof local === 'object' && local && 'padding' in local && local.padding === 8 ? 8 : top === 12 ? 8 : top;
    expect(inner.y).toBe(top);
    expect(inner.x).toBe(side);
    expect(inner.width).toBe(240 - 2 * side);
    expect(inner.height).toBe(10);
    expect(image.height).toBe(top + 10 + side);
  });

  it('lets final border and radius shorthands remove earlier side and corner defaults', async () => {
    const image = await renderImage(await renderToHtml(jsx('div', {
      style: mergeStyles({ width: 120, height: 40, background: '#112233', borderLeftWidth: 8, borderStyle: 'solid', borderColor: '#445566', borderTopLeftRadius: 20 }, { border: 0, borderRadius: 0 }),
    })), 120);
    const fill = colorBox(image, '#112233');
    expect(fill).toMatchObject({ x: 0, y: 0, width: 120, height: 40, pixels: 4800 });
  });

  it('lets final gap reset both row and column gap in nested themes', async () => {
    const image = await renderImage(await renderToHtml(jsx(ThemeProvider, {
      theme: { components: { Row: { rowGap: 20, columnGap: 24 } } },
      children: jsx(ThemeProvider, {
        theme: { components: { Row: { columnGap: 16 } } },
        children: jsx(Row, { custom: { style: { gap: 0 } }, children: [
          jsx('div', { style: { width: 40, height: 10, background: '#112233' } }),
          jsx('div', { style: { width: 40, height: 10, background: '#445566' } }),
        ] }),
      }),
    })), 120);
    const first = colorBox(image, '#112233'), second = colorBox(image, '#445566');
    expect(second.x).toBe(first.x + first.width);
    expect(second.y).toBe(first.y);
  });
});
