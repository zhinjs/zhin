import { Fragment, Raw, createElement, isJsxElement, jsx, jsxs, jsxDEV, rawHtml, renderToHtml, type JSXElement, type JSXNode } from '../src/index.js';
import * as runtime from '../src/jsx-runtime.js';
import * as devRuntime from '../src/jsx-dev-runtime.js';

describe('lazy JSX HTML contract', () => {
  it('constructs branded immutable elements without evaluating components', async () => {
    let calls = 0;
    const Card = ({ children }: { children: JSXNode }) => {
      calls++;
      return jsx('section', { children });
    };
    const node = jsx(Card, { children: '你好' });
    expect(node.$jsx).toBe('zhin.jsx/1');
    expect(Object.isFrozen(node)).toBe(true);
    expect(Object.isFrozen(node.props)).toBe(true);
    expect(calls).toBe(0);
    expect(isJsxElement(node)).toBe(true);
    expect(isJsxElement({ type: 'html', data: { html: 'hello' } })).toBe(false);
    expect(await renderToHtml(node)).toBe('<section>你好</section>');
    expect(calls).toBe(1);
  });

  it('keeps nested intrinsic markup and escapes text and attribute values once', async () => {
    const node = jsx('div', {
      className: 'card', title: '"<&\'中文',
      children: [jsx('span', { children: '<b>&中文</b>' }), '<span>literal</span>'],
    });
    expect(await renderToHtml(node)).toBe('<div class="card" title="&quot;&lt;&amp;&#39;中文"><span>&lt;b&gt;&amp;中文&lt;/b&gt;</span>&lt;span&gt;literal&lt;/span&gt;</div>');
  });

  it('recursively awaits component results, child promises and compound arrays', async () => {
    const Label = async () => [Promise.resolve(jsx('b', { children: 0 })), null, 'x'];
    expect(await renderToHtml(jsx('div', { children: jsx(Label, {}) }))).toBe('<div><b>0</b>x</div>');
    expect(await renderToHtml(Promise.resolve(jsx(Label, {})))).toBe('<b>0</b>x');
  });

  it('accepts explicitly annotated async results as array and factory children', async () => {
    async function Async(): Promise<JSXNode> {
      return [jsx('b', { children: '<ready>' }), Promise.resolve(jsx('i', { children: 0 }))];
    }
    const nodes: JSXNode = [Async()];
    expect(await renderToHtml(jsx('div', { children: nodes }))).toBe('<div><b>&lt;ready&gt;</b><i>0</i></div>');
    expect(await renderToHtml(createElement('div', {}, Async()))).toBe('<div><b>&lt;ready&gt;</b><i>0</i></div>');
  });

  it('flattens fragments and nested arrays while ignoring booleans and absent children', async () => {
    const node = jsx(Fragment, { children: [0, false, true, null, undefined, ['a', [jsx('br', {})]]] });
    expect(await renderToHtml(node)).toBe('0a<br>');
    expect(await renderToHtml(jsx(Fragment, {}))).toBe('');
  });

  it('serializes style objects, numeric lengths, unitless values and custom properties', async () => {
    const html = await renderToHtml(jsx('div', {
      style: { paddingTop: 8, margin: 0, opacity: 0.5, fontWeight: 600, flex: 1, '--count': 2,
        msFlexGrow: 2, WebkitLineClamp: 3, color: 'red"<&', absent: null, ignored: false },
    }));
    expect(html).toBe('<div style="padding-top: 8px; margin: 0; opacity: 0.5; font-weight: 600; flex: 1; --count: 2; -ms-flex-grow: 2; -webkit-line-clamp: 3; color: red&quot;&lt;&amp;"></div>');
    expect(await renderToHtml(jsx('div', { style: 'color:red; font-family:"A"' }))).toBe('<div style="color:red; font-family:&quot;A&quot;"></div>');
  });

  it('handles HTML boolean attributes independently from aria and data booleans', async () => {
    expect(await renderToHtml(jsx('input', {
      disabled: true, checked: false, readOnly: true, 'aria-hidden': false, 'data-active': false,
    }))).toBe('<input disabled readonly aria-hidden="false" data-active="false">');
  });

  it('preserves SVG case-sensitive attributes and maps SVG aliases', async () => {
    const icon = jsx('svg', { viewBox: '0 0 24 24', children: jsx('path', {
      d: 'M0 0', strokeWidth: 2, fillRule: 'evenodd', strokeLinecap: 'round',
    }) });
    expect(await renderToHtml(icon)).toBe('<svg viewBox="0 0 24 24"><path d="M0 0" stroke-width="2" fill-rule="evenodd" stroke-linecap="round"></path></svg>');
    expect(await renderToHtml(jsx('svg', { children: jsx('foreignObject', {
      children: jsx('div', { children: jsx('img', { src: 'x' }) }),
    }) }))).toBe('<svg><foreignObject><div><img src="x"></div></foreignObject></svg>');
  });

  it('only inserts raw markup through explicit raw channels', async () => {
    const node = jsx('div', { children: [rawHtml('<b>trusted</b>'), jsx(Raw, { html: '<i>also trusted</i>' })] });
    expect(await renderToHtml(node)).toBe('<div><b>trusted</b><i>also trusted</i></div>');
    expect(await renderToHtml(jsx('div', { dangerouslySetInnerHTML: { __html: '' } }))).toBe('<div></div>');
    expect(await renderToHtml(jsx(() => '<b>text</b>', {}))).toBe('&lt;b&gt;text&lt;/b&gt;');
    await expect(renderToHtml(jsx('div', { children: 'x', dangerouslySetInnerHTML: { __html: 'y' } }))).rejects.toThrow('both children');
  });

  it('shares production/development factory semantics and strips compiler keys', async () => {
    expect(runtime.jsx).toBe(jsx);
    expect(runtime.jsxs).toBe(jsxs);
    expect(devRuntime.jsxDEV).toBe(jsxDEV);
    const node = jsxDEV('div', { key: 'hidden', children: 'x' }, 'external', true, { fileName: 'x.tsx' }, {});
    expect(await renderToHtml(node)).toBe('<div>x</div>');
    expect(await renderToHtml(createElement('div', { children: 'old' }, 'new', 0))).toBe('<div>new0</div>');
  });

  it('allows the same node in separate branches without treating it as a cycle', async () => {
    const child = jsx('b', { children: 'x' });
    expect(await renderToHtml([child, child])).toBe('<b>x</b><b>x</b>');
  });

  it('rejects cycles in arrays, synchronous components and asynchronous returns', async () => {
    const list: JSXNode[] = [];
    list.push(list);
    await expect(renderToHtml(list)).rejects.toThrow('Circular JSX');
    const sync: JSXElement = jsx(() => sync, {});
    await expect(renderToHtml(sync)).rejects.toThrow('Circular JSX');
    const asyncNode: JSXElement = jsx(async () => asyncNode, {});
    await expect(renderToHtml(asyncNode)).rejects.toThrow('Circular JSX');
  });

  it('checks custom thenable cycles before Promise assimilation', async () => {
    const thenable = { then(resolve: (value: unknown) => void) { resolve(thenable); } };
    await expect(renderToHtml(thenable as unknown as JSXNode)).rejects.toThrow('Circular JSX');
  });

  it('bounds recursion even when components allocate new nodes', async () => {
    const Loop = (): JSXElement => jsx(Loop, {});
    await expect(renderToHtml(jsx(Loop, {}), { maxDepth: 5 })).rejects.toThrow('maximum render depth 5');
    await expect(renderToHtml('x', { maxDepth: 0 })).rejects.toThrow('positive integer');
  });

  it('propagates component failures instead of sending diagnostics as content', async () => {
    const error = new Error('private diagnostic');
    await expect(renderToHtml(jsx(() => { throw error; }, {}))).rejects.toBe(error);
    await expect(renderToHtml(jsx(async () => { throw error; }, {}))).rejects.toBe(error);
  });

  it('rejects malformed markup and unsupported event handlers', async () => {
    await expect(renderToHtml(jsx('div><script', {}))).rejects.toThrow('tag name');
    await expect(renderToHtml(jsx('div', { 'x" onclick': 'bad' }))).rejects.toThrow('attribute');
    await expect(renderToHtml(jsx('div', { onClick: () => {} }))).rejects.toThrow('event attributes');
    await expect(renderToHtml(jsx('img', { children: 'x' }))).rejects.toThrow('void element');
    await expect(renderToHtml({ type: 'image', data: {} } as unknown as JSXNode)).rejects.toThrow('branded');
    await expect(renderToHtml(jsx('div', { class: 'a', className: 'b' }))).rejects.toThrow('Duplicate');
  });

  it('rejects malformed CSS and non-scalar attributes', async () => {
    await expect(renderToHtml(jsx('div', { style: { padding: NaN } }))).rejects.toThrow('style number');
    await expect(renderToHtml(jsx('div', { style: { 'x; color': 'red' } }))).rejects.toThrow('style property');
    await expect(renderToHtml(jsx('div', { title: {} }))).rejects.toThrow('attribute value');
    await expect(renderToHtml(jsx('input', { disabled: 'false' }))).rejects.toThrow('requires boolean');
  });
});
