import * as production from '../src/jsx-runtime.js';
import * as development from '../src/jsx-dev-runtime.js';
import { renderToHtml, renderToSegments, isJsxElement } from '../src/jsx.js';

describe('unified JSX compiler entries', () => {
  it('shares production and development native message semantics', async () => {
    const node = production.jsxs(production.Fragment, { children: ['hello', production.jsx('mention', { target: '123' })] });
    expect(await renderToSegments(node)).toEqual([
      { type: 'text', data: { text: 'hello' } }, { type: 'mention', data: { target: '123' } },
    ]);
    expect(await renderToSegments(development.jsxDEV('mention', { target: '123' })))
      .toEqual([{ type: 'mention', data: { target: '123' } }]);
  });
  it('shares production and development HTML semantics', async () => {
    const node = production.jsxs(production.Fragment, { children: [production.jsx('b', { children: '<ok>' }), 0, false] });
    expect(isJsxElement(node)).toBe(true);
    expect(await renderToHtml(node)).toBe('<b>&lt;ok&gt;</b>0');
    expect(await renderToHtml(development.jsxDEV('b', { children: '<ok>' }))).toBe('<b>&lt;ok&gt;</b>');
  });
});
