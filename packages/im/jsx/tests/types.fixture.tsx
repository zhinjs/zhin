/** @jsxImportSource ../src */
import { Fragment, Raw, createElement, renderToHtml, type JSX, type JSXNode, type JSXRenderable } from '../src/index.js';

function Text({ text }: { text: string }) { return text; }
async function Async({ children }: { children?: JSXNode }): Promise<JSXNode> { return <section>{children}</section>; }
async function AsyncList(): Promise<JSXNode> { return [<b>异步</b>, Promise.resolve(<i>子项</i>), 0]; }
function List() { return [<span>一</span>, false, 0] as const; }

const element: JSX.Element = <Async><Text text="好" /><List /><Fragment><Raw html="<b>trusted</b>" /></Fragment></Async>;
const intrinsic: JSX.Element = <svg viewBox="0 0 24 24"><path strokeWidth={2} /></svg>;
const props: JSX.Element = <div className="card" style={{ padding: 8, opacity: 0.5 }} aria-hidden={false}>{Promise.resolve(element)}</div>;
const node: JSXNode = [element, intrinsic, props];
const settled: Awaited<JSXNode> = [element, Promise.resolve(intrinsic), 0];
const asyncList: JSX.Element = <AsyncList />;
const asyncResult = AsyncList();
const directAsyncChildren: JSX.Element = <div>{asyncResult}</div>;
const asyncNodes: JSXNode = [asyncResult, 0, [AsyncList()]];
const renderable: JSXRenderable = asyncResult;
createElement('div', {}, asyncResult);
createElement('div', { children: asyncResult });
void renderToHtml(Async({ children: node }));
void [settled, asyncList, directAsyncChildren, asyncNodes, renderable];
void node;

// @ts-expect-error Props of function components remain type checked.
const invalidProps = <Text text={42} />;
// @ts-expect-error Promise-valued components are supported, plain segments are not JSX nodes.
const invalidSegment: JSXNode = { type: 'image', data: {} };
// @ts-expect-error JSX expressions have the lazy brand, not plain string identity.
const invalidElement: JSX.Element = '<div />';
void [invalidProps, invalidSegment, invalidElement];
