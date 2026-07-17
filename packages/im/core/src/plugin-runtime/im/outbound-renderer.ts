import type { PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import {
  ComponentIndex,
  componentFeatureId,
  isComponentIndex,
} from '@zhin.js/component';
import {
  isComponentCall,
  isRawContent,
  type SendContent,
} from './contracts.js';

const maxComponentDepth = 32;

export class OutboundRenderer {
  async render(
    content: SendContent,
    requester: PluginId,
    snapshot: RuntimeSnapshot,
  ): Promise<unknown> {
    return this.#render(content, requester, snapshot, 0);
  }

  async #render(
    content: SendContent,
    requester: PluginId,
    snapshot: RuntimeSnapshot,
    depth: number,
  ): Promise<unknown> {
    if (depth > maxComponentDepth) throw new Error('Component render depth exceeded 32');
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return Promise.all(content.map((item) => this.#render(item, requester, snapshot, depth)));
    }
    if (isRawContent(content)) return content.payload;
    if (isComponentCall(content)) {
      const rendered = await requireComponents(snapshot).render<unknown, SendContent>(
        requester,
        content.name,
        content.props,
      );
      return this.#render(rendered, requester, snapshot, depth + 1);
    }
    throw new TypeError('Unsupported SendContent');
  }
}

function requireComponents(snapshot: RuntimeSnapshot): ComponentIndex {
  const projection = snapshot.projections.get(componentFeatureId);
  if (!isComponentIndex(projection)) {
    throw new Error('Component Feature projection is not installed');
  }
  return projection;
}
