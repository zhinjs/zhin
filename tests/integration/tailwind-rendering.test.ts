import { jsx, renderToHtml } from '../../packages/im/jsx/src/index.js';
import { createTailwindStyle } from '../../packages/toolkit/tailwind/src/index.js';
import { Card, ThemeProvider } from '../../packages/toolkit/components/src/index.js';
import { renderImage, colorBox } from '../../packages/toolkit/components/tests/render-image.js';

it('renders actual Tailwind grid and resolved theme colors through Shotium', async () => {
  const tw = await createTailwindStyle({ theme: { '--color-brand': '#2563eb' } });
  const html = await renderToHtml(jsx('div', {
    style: tw('grid grid-cols-2 gap-4 h-10'),
    children: [
      jsx('div', { style: tw('bg-brand') }),
      jsx('div', { style: tw('bg-[#112233]') }),
    ],
  }));
  expect(html).not.toContain('var(');
  const image = await renderImage(html, 240);
  expect(colorBox(image, '#2563eb')).toMatchObject({ x: 0, y: 0, width: 112, height: 40 });
  expect(colorBox(image, '#112233')).toMatchObject({ x: 128, y: 0, width: 112, height: 40 });
});

it.each([false, true])('preserves Tailwind theme padding and final local overrides (%s)', async (local) => {
  const tw = await createTailwindStyle();
  const html = await renderToHtml(jsx(ThemeProvider, {
    theme: { components: { Card: tw('px-6 py-4') } },
    children: jsx(Card, {
      custom: { style: { border: 0, borderRadius: 0, boxShadow: 'none', margin: 0, ...(local ? tw('p-0') : {}) } },
      children: jsx('div', { style: tw('h-10 bg-[#112233]') }),
    }),
  }));
  const image = await renderImage(html, 240);
  expect(colorBox(image, '#112233')).toMatchObject({ x: local ? 0 : 24, y: local ? 0 : 16, width: local ? 240 : 192, height: 40 });
  expect(image.height).toBe(local ? 40 : 72);
});
