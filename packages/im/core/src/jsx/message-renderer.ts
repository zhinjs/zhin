import { Fragment, Html, isJsxElement, renderToHtml, type JSXRenderable, type HtmlProps, type JSXProps } from '@zhin.js/jsx';
import type { Segment, TextSegment } from '@zhin.js/im-contract';
import { segment } from '../utils.js';
import { isSegmentContent } from '../plugin-runtime/im/contracts.js';
import { Image, type ButtonProps, type ImageProps } from './message-tags.js';
import { isKeyboardSegment } from '../built/interactive-segments/types.js';

const MESSAGE_TAGS = new Set([
  'text', 'mention', 'image', 'audio', 'video', 'file', 'reply', 'forward', 'face',
  'dice', 'rps', 'share', 'card', 'action', 'html', 'keyboard', 'link', 'markdown',
  'qrcode', 'record', 'tts', 'voice',
]);

export interface MessageRenderOptions {
  readonly maxDepth?: number;
  readonly signal?: AbortSignal;
  readonly bindButton?: (props: ButtonProps) => Segment;
  readonly renderComponent?: (name: string, props: JSXProps) => Promise<JSXRenderable>;
}

/** Default JSX lays out ordered message segments. Only Html changes to HTML semantics. */
export async function renderToSegments(node: JSXRenderable, options: MessageRenderOptions = {}): Promise<readonly Segment[]> {
  const maxDepth = options.maxDepth ?? 100;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1) throw new RangeError('JSX maxDepth must be a positive integer');
  const ancestors = new WeakSet<object>();
  const output: Segment[] = [];
  let lastButtonIndex = -1;
  const render = async (value: unknown, depth: number): Promise<void> => {
    options.signal?.throwIfAborted();
    if (depth > maxDepth) throw new RangeError(`JSX exceeds maximum render depth ${maxDepth}`);
    if (value == null || typeof value === 'boolean') return;
    if (typeof value === 'string' || typeof value === 'number') {
      if (value !== '') output.push(segment.text(String(value)));
      return;
    }
    if (typeof value !== 'object') throw new TypeError('Unsupported JSX child');
    if (ancestors.has(value)) throw new TypeError('Circular JSX tree');
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        for (const child of value) await render(child, depth + 1);
      } else if ('then' in value && typeof value.then === 'function') {
        const then = value.then;
        const resolved = await new Promise<{ node: unknown }>((resolve, reject) => {
          then.call(value, (child: unknown) => resolve({ node: child }), reject);
        });
        await render(resolved.node, depth + 1);
      } else if (isJsxElement(value)) {
        const { type, props } = value;
        if (type === Fragment) await render(props.children, depth + 1);
        else if (type === Html || type === 'html') {
          if (props.html !== undefined && props.children !== undefined) throw new TypeError('Html accepts html or children, not both');
          if (props.html !== undefined && typeof props.html !== 'string') throw new TypeError('Html html must be a string');
          const html = typeof props.html === 'string' ? props.html
            : await renderToHtml(props.children, { maxDepth: Math.max(1, maxDepth - depth) });
          const { width, backgroundColor, fileName, text } = props as HtmlProps;
          if (html || text) output.push(segment.html({ html,
            ...(width === undefined ? {} : { width }),
            ...(backgroundColor === undefined ? {} : { backgroundColor }),
            ...(fileName === undefined ? {} : { fileName }),
            ...(text === undefined ? {} : { text }),
          }));
        } else if (typeof type === 'function') await render(type(props), depth + 1);
        else if (type === 'image' && 'src' in props) await render(Image(props as unknown as ImageProps), depth + 1);
        else if (type === 'button') {
          if (!options.bindButton) throw new TypeError('Button requires an active IM runtime');
          const button = options.bindButton(props as ButtonProps);
          const previous = output[lastButtonIndex];
          if (lastButtonIndex === output.length - 1 && isKeyboardSegment(previous) && isKeyboardSegment(button)) {
            output[lastButtonIndex] = { type: 'keyboard', data: { rows: [[...previous.data.rows.flat(), ...button.data.rows.flat()]] } };
          } else {
            output.push(button);
            lastButtonIndex = output.length - 1;
          }
        } else if (typeof type === 'string' && (MESSAGE_TAGS.has(type) || /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)+$/.test(type))) {
          const { children, ...data } = props;
          if ((type === 'text' || type === 'markdown') && children !== undefined) {
            const field = type === 'text' ? 'text' : 'content';
            if (data[field] !== undefined) throw new TypeError(`${type} accepts ${field} or children, not both`);
            const start = output.length;
            await render(children, depth + 1);
            const parts = output.splice(start);
            if (!parts.every((part): part is TextSegment => part.type === 'text' && 'text' in part.data && typeof part.data.text === 'string')) {
              throw new TypeError(`${type} children must produce text segments`);
            }
            const text = parts.map(part => part.data.text).join('');
            if (text) output.push(segment(type, { ...data, [field]: text }));
          } else if (type === 'card') {
            output.push(segment(type, props));
          } else {
            if (children !== undefined) throw new TypeError(`Message tag ${type} stores content in its data props, not children`);
            output.push(segment(type, data));
          }
        } else if (typeof type === 'string' && options.renderComponent) {
          await render(await options.renderComponent(type, props), depth + 1);
        } else throw new TypeError(`Unknown message tag ${String(type)}; register a component or wrap HTML in <html>`);
      } else if (isSegmentContent(value)) output.push(value);
      else throw new TypeError('Unsupported JSX child: expected a JSX element or Segment');
    } finally {
      ancestors.delete(value);
    }
    options.signal?.throwIfAborted();
  };
  await render(node, 0);
  return output;
}
