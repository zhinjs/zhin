import type { PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { componentHostToken, type ComponentHost, type TemplateContext } from '@zhin.js/plugin-runtime';
import type { ConversationRef } from '@zhin.js/im-contract';
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

const maxComponentDepth = 32;
const TEMPLATE_MARKER = '${';

export class OutboundRenderer {
  async render(
    content: SendContent,
    requester: PluginId,
    snapshot: RuntimeSnapshot,
    conversation?: ConversationRef,
    incoming?: IncomingContext,
  ): Promise<unknown> {
    const host = resolveComponentHost(snapshot);
    const ctx = conversation ? buildTemplateContext(conversation, incoming) : undefined;
    return this.#render(content, requester, snapshot, host, ctx, 0);
  }

  async #render(
    content: SendContent,
    requester: PluginId,
    snapshot: RuntimeSnapshot,
    host: ComponentHost | undefined,
    ctx: TemplateContext | undefined,
    depth: number,
  ): Promise<unknown> {
    if (depth > maxComponentDepth) throw new Error('Component render depth exceeded 32');
    if (typeof content === 'string') return compileText(content, host, ctx);
    if (Array.isArray(content)) {
      return Promise.all(content.map((item) => this.#render(item, requester, snapshot, host, ctx, depth)));
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
      );
      return this.#render(rendered, requester, snapshot, host, ctx, depth + 1);
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
    endpointName: incoming?.endpointName,
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
