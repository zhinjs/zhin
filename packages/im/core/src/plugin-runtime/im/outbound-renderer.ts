import { componentHostToken, createToken, htmlRendererToken, type CapabilityId, type ComponentHost, type HtmlRendererHost, type TemplateContext, type PluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { EndpointDeliveryError, type ConversationRef } from '@zhin.js/im-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { isJsxElement, type JSXElement, type JSXRenderable } from '@zhin.js/jsx';
import { isNativeMessageTag, renderToSegments, type MessageRenderOptions } from '../../jsx/message-renderer.js';
import { flattenOutboundArray, MAX_OUTBOUND_ARRAY_DEPTH } from '../../built/outbound-content-arrays.js';
import { assertCanonicalSegments } from '../../built/segment-contract/assert.js';
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
import { JsxButtonRegistry } from './interactive-router.js';
import { requireAdapters } from './endpoint-runtime.js';
import type { OutboundFallbackReason, RuntimeMessageRendering } from './message-events.js';
import {
  applyOutboundInteractivePolicy,
  applyOutboundMarkdownPolicy,
  normalizeOutboundPayload,
  resolveOutboundHtmlPolicy,
  resolveOutboundInteractivePolicy,
  resolveOutboundMarkdownPolicy,
  resolveOutboundMediaPolicy,
  resolveOutboundSupportedSegments,
} from './outbound-segments.js';

/** Keep the adapter's presentation or prefer its existing readable text fallback. */
export type OutboundPresentationMode = 'default' | 'text';

export interface OutboundPresentationPreferences {
  readonly html?: OutboundPresentationMode;
  readonly markdown?: OutboundPresentationMode;
  readonly interactive?: OutboundPresentationMode;
}

export interface OutboundPresentationContext {
  readonly conversation: ConversationRef;
  readonly requester: PluginId;
  readonly generation: number;
}

/** A synchronous, side-effect-free decision, shared by delivery and target previews. */
export type OutboundPresentation = (
  context: OutboundPresentationContext,
) => OutboundPresentationPreferences | undefined;

export const outboundPresentationToken = createToken<OutboundPresentation>(
  'zhin.outbound-presentation',
  'Root-selected outbound presentation within the adapter capability boundary',
);

const outboundLogger = getLogger('im.outbound');

/** Resolve once per operation; replacements reuse this detached, immutable decision. */
export function resolveOutboundPresentation(
  snapshot: RuntimeSnapshot,
  conversation: ConversationRef,
  requester: PluginId,
): OutboundPresentationPreferences | undefined {
  const policy = snapshot.resources.get(snapshot.root)?.get(outboundPresentationToken.id) as OutboundPresentation | undefined;
  if (policy === undefined) return undefined;
  try {
    const view: ConversationRef = Object.freeze({
      endpoint: Object.freeze({ id: conversation.endpoint.id, adapter: conversation.endpoint.adapter }),
      kind: conversation.kind,
      id: conversation.id,
      ...(conversation.parent ? { parent: Object.freeze({ kind: conversation.parent.kind, id: conversation.parent.id }) } : {}),
      ...(conversation.threadId !== undefined ? { threadId: conversation.threadId } : {}),
    });
    const result = policy(Object.freeze({ conversation: view, requester, generation: snapshot.generation }));
    if (result === undefined) return undefined;
    if (result && typeof result === 'object' && 'then' in result) {
      // An accidentally async policy is outside the contract. Consume a possible
      // rejection without waiting for it or applying a later decision to this send.
      void Promise.resolve(result).catch(() => undefined);
      throw new TypeError('Outbound presentation must be synchronous');
    }
    if (!result || typeof result !== 'object') throw new TypeError('Invalid outbound presentation');
    const { html, markdown, interactive } = result;
    for (const value of [html, markdown, interactive]) {
      if (value !== undefined && value !== 'default' && value !== 'text') throw new TypeError('Invalid outbound presentation mode');
    }
    return Object.freeze({ html, markdown, interactive });
  } catch {
    // Never log the callback error, content or user-provided values; do not retry it.
    outboundLogger.warn(formatCompact({ op: 'outbound_presentation', status: 'fallback', reason: 'policy_failed', generation: snapshot.generation }));
    return undefined;
  }
}

export interface OutboundProjection {
  readonly payload: unknown;
  readonly rendering: RuntimeMessageRendering;
}

/** Shared by transport and target-aware previews. Does not send or register callbacks. */
export async function projectOutboundPayload(
  rendered: unknown,
  conversation: ConversationRef,
  snapshot: RuntimeSnapshot,
  options: {
    readonly rememberFallback?: (map: Record<string, string>) => Record<string, string> | void;
    readonly inheritedFallbacks?: readonly OutboundFallbackReason[];
    /** Keep keyboard payloads until outbound middleware has had a chance to replace them. */
    readonly deferInteractive?: boolean;
    readonly signal?: AbortSignal;
    readonly presentation?: OutboundPresentationPreferences;
  } = {},
): Promise<OutboundProjection> {
  options.signal?.throwIfAborted();
  const adapter = conversation.endpoint.id as CapabilityId;
  const reasons = new Set(options.inheritedFallbacks);
  const values = Array.isArray(rendered) ? flattenOutboundArray(rendered) : rendered;
  const contains = (type: string) => (Array.isArray(values) ? values : [values])
    .some(value => value && typeof value === 'object' && value.type === type);
  const markdown = options.presentation?.markdown === 'text' ? 'text' : resolveOutboundMarkdownPolicy(adapter, snapshot);
  if (markdown === 'text' && contains('markdown')) reasons.add('markdown_text_policy');
  const host = snapshot.resources.get(snapshot.root)?.get(htmlRendererToken.id) as HtmlRendererHost | undefined;
  let payload = await normalizeOutboundPayload(applyOutboundMarkdownPolicy(values, markdown), host, {
    mediaPolicy: resolveOutboundMediaPolicy(adapter, snapshot),
    htmlPolicy: options.presentation?.html === 'text' ? 'text' : resolveOutboundHtmlPolicy(adapter, snapshot),
    onFallback: reason => reasons.add(reason),
    signal: options.signal,
  });
  options.signal?.throwIfAborted();
  const interactive = options.presentation?.interactive === 'text' ? 'text' : resolveOutboundInteractivePolicy(adapter, snapshot);
  if (interactive === 'text' && Array.isArray(payload) && payload.some(item => item?.type === 'keyboard')) {
    reasons.add('interactive_text_policy');
  }
  if (!options.deferInteractive) payload = applyOutboundInteractivePolicy(payload, interactive, options.rememberFallback);
  if (Array.isArray(payload)) {
    payload = payload.filter(item => !(item?.type === 'text' && item.data?.text === ''));
    assertCanonicalSegments(payload);
  }
  const supported = resolveOutboundSupportedSegments(adapter, snapshot);
  const supportedPayload = options.deferInteractive ? applyOutboundInteractivePolicy(payload, interactive) : payload;
  if (supported && Array.isArray(supportedPayload)) {
    const unsupported = supportedPayload.find(segment => segment && typeof segment === 'object'
      && typeof segment.type === 'string' && !supported.includes(segment.type));
    if (unsupported) throw new EndpointDeliveryError('unsupported_operation', `Adapter does not support canonical segment ${unsupported.type}`, 'not_sent');
  }
  const forms = new Set<'text' | 'image' | 'native'>();
  for (const item of Array.isArray(payload) ? payload : [payload]) {
    if (typeof item === 'string' || item?.type === 'text') forms.add('text');
    else if (item?.type === 'image') forms.add('image');
    else if (item != null) forms.add('native');
  }
  return Object.freeze({ payload, rendering: Object.freeze({
    forms: Object.freeze([...forms]), fallbacks: Object.freeze([...reasons]),
  }) });
}

const maxComponentDepth = 32;
const TEMPLATE_MARKER = '${';

/** One render operation's author, target, dependencies and shared JSX cache. */
export interface OutboundRenderContext {
  readonly requester: PluginId;
  readonly snapshot: RuntimeSnapshot;
  readonly conversation?: ConversationRef;
  readonly incoming?: IncomingContext;
  readonly jsxCache?: WeakMap<JSXElement, Promise<unknown>>;
  readonly bindButton?: MessageRenderOptions['bindButton'];
  readonly signal?: AbortSignal;
}

/** Preview requires a concrete target but never sends or registers live buttons. */
export interface OutboundPreviewContext extends Pick<OutboundRenderContext, 'requester' | 'snapshot' | 'signal'> {
  readonly conversation: ConversationRef;
}

/** Shared dependencies are immutable references; only the request-local cache changes. */
interface RenderOperation extends Pick<OutboundRenderContext, 'requester' | 'snapshot' | 'signal' | 'bindButton'> {
  readonly host?: ComponentHost;
  readonly template?: TemplateContext;
  readonly jsxCache: WeakMap<JSXElement, Promise<unknown>>;
}

/** Each recursive branch owns its depth and ancestry; sibling branches share no mutable sets. */
interface RenderTraversal {
  readonly operation: RenderOperation;
  readonly depth: number;
  readonly arrayAncestors: ReadonlySet<readonly SendContent[]>;
  readonly jsxAncestors: ReadonlySet<JSXElement>;
}

export class OutboundRenderer {
  /** Target projection only: no middleware, transport or live button registration. */
  async preview(content: SendContent, context: OutboundPreviewContext): Promise<OutboundProjection> {
    const { requester, snapshot, conversation, signal } = context;
    const adapters = requireAdapters(snapshot);
    const endpointId = conversation.endpoint.id as import('@zhin.js/plugin-runtime').CapabilityId;
    if (adapters.clientAdapter(endpointId) !== conversation.endpoint.adapter) throw new Error('Preview endpoint identity mismatch');
    if (!adapters.list().find(item => item.id === endpointId)?.capabilities.includes('outbound')) {
      throw new Error('Preview endpoint does not support outbound messages');
    }
    signal?.throwIfAborted();
    const presentation = resolveOutboundPresentation(snapshot, conversation, requester);
    const buttons = new JsxButtonRegistry().prepare({ content, requester, conversation }, snapshot);
    const rendered = await this.render(content, { requester, snapshot, conversation, signal, bindButton: buttons.bind });
    const result = await projectOutboundPayload(rendered, conversation, snapshot, { signal, presentation });
    signal?.throwIfAborted();
    return result;
  }

  async render(content: SendContent, context: OutboundRenderContext): Promise<unknown> {
    const { requester, snapshot, conversation, incoming, signal, bindButton } = context;
    signal?.throwIfAborted();
    const host = resolveComponentHost(snapshot);
    const ctx = conversation ? buildTemplateContext(conversation, incoming) : undefined;
    const operation: RenderOperation = { requester, snapshot, host, template: ctx,
      jsxCache: context.jsxCache ?? new WeakMap(), signal, bindButton };
    const rendered = await this.#render(content, { operation, depth: 0,
      arrayAncestors: new Set(), jsxAncestors: new Set() });
    signal?.throwIfAborted();
    return rendered;
  }

  async #render(content: SendContent, traversal: RenderTraversal): Promise<unknown> {
    const { operation, depth, arrayAncestors, jsxAncestors } = traversal;
    const { requester, snapshot, host, template: ctx, jsxCache, signal, bindButton } = operation;
    signal?.throwIfAborted();
    if (depth > maxComponentDepth) throw new Error('Component render depth exceeded 32');
    if (typeof content === 'string') return compileText(content, host, ctx);
    if (Array.isArray(content)) {
      if (arrayAncestors.has(content)) throw new TypeError('Cyclic SendContent array');
      if (arrayAncestors.size >= MAX_OUTBOUND_ARRAY_DEPTH) throw new RangeError('SendContent array depth exceeded 512');
      // Each parallel branch gets its own ancestry; repeated sibling arrays are valid.
      const ancestors = new Set(arrayAncestors).add(content);
      const items = await Promise.all(content.map((item) => this.#render(item, { ...traversal, arrayAncestors: ancestors })));
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
          return this.#render(rendered as SendContent, { ...traversal, depth: depth + 1, jsxAncestors: ancestors });
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
      return this.#render(rendered, { ...traversal, depth: depth + 1 });
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
