import { componentHostToken, type ComponentHost, type TemplateContext, type PluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { ConversationRef } from '@zhin.js/im-contract';
import { isJsxElement, type JSXElement, type JSXRenderable } from '@zhin.js/jsx';
import { isNativeMessageTag, renderToSegments, type MessageRenderOptions } from '../../jsx/message-renderer.js';
import { flattenOutboundArray, MAX_OUTBOUND_ARRAY_DEPTH } from '../../built/outbound-content-arrays.js';
import {
  ComponentIndex,
  componentFeatureId,
  isComponentIndex,
} from '@zhin.js/component';
import {
  isComponentCall,
  isRawContent,
  isSegmentContent,
  type IncomingContext,
  type SendContent,
} from './contracts.js';
import { JsxButtonRegistry } from './jsx-button-registry.js';
import { requireAdapters } from './endpoint-runtime.js';
import { projectOutboundPayload, type OutboundProjection } from './outbound-projection.js';
import { resolveOutboundPresentation } from './outbound-presentation.js';

const maxComponentDepth = 32;
const TEMPLATE_MARKER = '${';

export interface OutboundRenderOptions {
  readonly jsxCache?: WeakMap<JSXElement, Promise<unknown>>;
  readonly bindButton?: MessageRenderOptions['bindButton'];
  readonly signal?: AbortSignal;
}

export class OutboundRenderer {
  /** Target projection only: no middleware, transport or live button registration. */
  async preview(
    content: SendContent,
    requester: PluginId,
    snapshot: RuntimeSnapshot,
    conversation: ConversationRef,
    options: Pick<OutboundRenderOptions, 'signal'> = {},
  ): Promise<OutboundProjection> {
    const adapters = requireAdapters(snapshot);
    const endpointId = conversation.endpoint.id as import('@zhin.js/plugin-runtime').CapabilityId;
    if (adapters.clientAdapter(endpointId) !== conversation.endpoint.adapter) throw new Error('Preview endpoint identity mismatch');
    if (!adapters.list().find(item => item.id === endpointId)?.capabilities.includes('outbound')) {
      throw new Error('Preview endpoint does not support outbound messages');
    }
    options.signal?.throwIfAborted();
    const presentation = resolveOutboundPresentation(snapshot, conversation, requester);
    const buttons = new JsxButtonRegistry().prepare({ content, requester, conversation }, snapshot);
    const rendered = await this.render(content, requester, snapshot, conversation, undefined, { ...options, bindButton: buttons.bind });
    const result = await projectOutboundPayload(rendered, conversation, snapshot, { ...options, presentation });
    options.signal?.throwIfAborted();
    return result;
  }

  async render(
    content: SendContent,
    requester: PluginId,
    snapshot: RuntimeSnapshot,
    conversation?: ConversationRef,
    incoming?: IncomingContext,
    options: OutboundRenderOptions = {},
  ): Promise<unknown> {
    options.signal?.throwIfAborted();
    const host = resolveComponentHost(snapshot);
    const ctx = conversation ? buildTemplateContext(conversation, incoming) : undefined;
    const rendered = await this.#render(content, requester, snapshot, host, ctx, 0,
      options.jsxCache ?? new WeakMap(), options.signal, new Set(), options.bindButton);
    options.signal?.throwIfAborted();
    return rendered;
  }

  async #render(
    content: SendContent,
    requester: PluginId,
    snapshot: RuntimeSnapshot,
    host: ComponentHost | undefined,
    ctx: TemplateContext | undefined,
    depth: number,
    jsxCache: WeakMap<JSXElement, Promise<unknown>>,
    signal: AbortSignal | undefined,
    arrayAncestors: ReadonlySet<readonly SendContent[]>,
    bindButton: MessageRenderOptions['bindButton'],
    jsxAncestors: ReadonlySet<JSXElement> = new Set(),
  ): Promise<unknown> {
    signal?.throwIfAborted();
    if (depth > maxComponentDepth) throw new Error('Component render depth exceeded 32');
    if (typeof content === 'string') return compileText(content, host, ctx);
    if (Array.isArray(content)) {
      if (arrayAncestors.has(content)) throw new TypeError('Cyclic SendContent array');
      if (arrayAncestors.size >= MAX_OUTBOUND_ARRAY_DEPTH) throw new RangeError('SendContent array depth exceeded 512');
      // Each parallel branch gets its own ancestry; repeated sibling arrays are valid.
      const ancestors = new Set(arrayAncestors).add(content);
      const items = await Promise.all(content.map((item) => this.#render(item, requester, snapshot, host, ctx, depth, jsxCache, signal, ancestors, bindButton, jsxAncestors)));
      signal?.throwIfAborted();
      return flattenOutboundArray(items);
    }
    if (isJsxElement(content)) {
      if (jsxAncestors.has(content)) throw new TypeError('Circular JSX component tree');
      let segments = jsxCache.get(content);
      if (!segments) {
        const ancestors = new Set(jsxAncestors).add(content);
        const renderNamedComponent = async (name: string, props: typeof content.props): Promise<unknown> => {
          const components = snapshot.projections.get(componentFeatureId);
          if (!isComponentIndex(components)) {
            throw new TypeError(`Unknown message tag ${name}; register a component or wrap HTML in <html>`);
          }
          const rendered = await components.render(requester, name, props, { snapshot, ...(signal ? { signal } : {}) });
          if (rendered == null) return [];
          // Resolve every SendContent shape with the same depth and ancestry
          // guards as ComponentCall. Root raw payloads remain opaque.
          return this.#render(rendered as SendContent, requester, snapshot, host, ctx, depth + 1,
            jsxCache, signal, arrayAncestors, bindButton, ancestors);
        };
        segments = typeof content.type === 'string' && !isNativeMessageTag(content.type)
          ? renderNamedComponent(content.type, content.props)
          : renderToSegments(content, { signal, bindButton,
            renderComponent: async (name, props) => await renderNamedComponent(name, props) as JSXRenderable,
          });
        jsxCache.set(content, segments);
      }
      const rendered = await segments;
      signal?.throwIfAborted();
      return rendered;
    }
    if (isRawContent(content)) return content.payload;
    if (isSegmentContent(content)) {
      if (content.type === 'text') {
        const text = (content.data as Record<string, unknown> | undefined)?.text;
        if (typeof text === 'string' && text.includes(TEMPLATE_MARKER) && host && ctx) {
          return { ...content, data: { ...content.data, text: host.compileTemplate(text, ctx) } };
        }
      }
      return content;
    }
    if (isComponentCall(content)) {
      const rendered = await requireComponents(snapshot).render<unknown, SendContent>(
        requester,
        content.name,
        content.props,
        { snapshot, ...(signal ? { signal } : {}) },
      );
      if (rendered == null) return [];
      return this.#render(rendered, requester, snapshot, host, ctx, depth + 1, jsxCache, signal, arrayAncestors, bindButton, jsxAncestors);
    }
    throw new TypeError('Unsupported SendContent');
  }
}

function compileText(
  text: string,
  host: ComponentHost | undefined,
  ctx: TemplateContext | undefined,
): string {
  if (!host || !ctx || !text.includes(TEMPLATE_MARKER)) return text;
  return host.compileTemplate(text, ctx);
}

function buildTemplateContext(
  conversation: ConversationRef,
  incoming?: IncomingContext,
): TemplateContext {
  return {
    adapter: conversation.endpoint.adapter,
    endpoint: conversation.endpoint.id,
    kind: conversation.kind,
    conversationId: conversation.id,
    sender: incoming?.sender,
    content: incoming?.content,
    segments: incoming?.segments,
    messageId: incoming?.messageId,
    timestamp: incoming?.timestamp,
    endpointId: incoming?.endpointId,
    mentioned: incoming?.mentioned,
  };
}

function resolveComponentHost(snapshot: RuntimeSnapshot): ComponentHost | undefined {
  const host = snapshot.resources.get(snapshot.root)?.get(componentHostToken.id);
  return host && typeof (host as ComponentHost).compileTemplate === 'function'
    ? host as ComponentHost
    : undefined;
}

function requireComponents(snapshot: RuntimeSnapshot): ComponentIndex {
  const projection = snapshot.projections.get(componentFeatureId);
  if (!isComponentIndex(projection)) {
    throw new Error('Component Feature projection is not installed');
  }
  return projection;
}
