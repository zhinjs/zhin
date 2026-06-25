import type { MessageElement } from '../../types.js';
import { richSegmentRegistry } from './registry.js';
import type {
  RichSegmentRenderContext,
  RichSegmentRenderResult,
} from './types.js';

export abstract class RichSegment<TData> {
  abstract readonly segmentType: string;

  constructor(readonly data: TData) {}

  abstract render(
    mode: string,
    ctx?: RichSegmentRenderContext,
  ): Promise<RichSegmentRenderResult>;

  toJSON(): MessageElement {
    return { type: this.segmentType, data: this.data as Record<string, unknown> };
  }
}

export function isRichSegment(item: unknown): item is RichSegment<unknown> {
  return item instanceof RichSegment;
}

export function richSegmentKind(item: MessageElement | string): string | null {
  if (typeof item === 'string') return null;
  const type = item.type;
  if (typeof type !== 'string') return null;
  if (richSegmentRegistry.has(type)) {
    return type;
  }
  return null;
}
