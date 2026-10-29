import type { PromptRetention } from './prompt-budget.js';
import type { PromptLayer } from './prompt-builder.js';
import type { RichSystemPromptContext } from './system-prompt.js';
import { PromptSegmentRegistry } from './segments/registry.js';
import type { PromptSegment, SegmentInput, TextSegmentKind } from './segments/types.js';

/** Platform guidance with `placement: 'tail'` sorts after every other platform segment. */
const TAIL_WEIGHT_OFFSET = 1_000_000;

/** ADR 0041 §3: legacy layers map onto text segment kinds. */
export function segmentKindForLayer(layer: PromptLayer): TextSegmentKind {
  switch (layer) {
    case 'system':
    case 'safety':
      return 'system';
    case 'context':
      return 'environment';
    case 'role':
    case 'task':
    case 'constraints':
    case 'memory':
      return 'role_rules';
    default:
      return 'platform';
  }
}

export type PromptSectionContent =
  | string
  | ((ctx: RichSystemPromptContext) => string | null | undefined);

export interface PromptAssemblySection {
  readonly layer: PromptLayer;
  /** ADR 0041 segment kind; defaults to the kind of `layer` (`platform` for tail placement). */
  readonly kind?: TextSegmentKind;
  readonly title: string;
  content: PromptSectionContent;
  readonly order: number;
  /** Platform guidance follows the current capability catalog. */
  readonly placement?: 'tail';
  /** Retention priority when placement differs from the original section. */
  readonly budgetOrder?: number;
  readonly retention: PromptRetention;
  readonly maxChars?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface PromptAssemblyEntry extends Omit<PromptAssemblySection, 'content'> {
  id: string;
  content: string;
}

export interface PromptSectionRegistry {
  register(id: string, section: PromptAssemblySection): void;
  list(ctx?: RichSystemPromptContext): Array<Omit<PromptAssemblyEntry, 'id'>>;
  build(maxChars: number, ctx?: RichSystemPromptContext): string;
}

/**
 * @deprecated ADR 0041: thin adapter that registers text segments. Contribute through
 * `promptSegmentToken` / PromptSegmentRegistry instead; removed one version after 0041 lands.
 */
export class PromptAssemblyRegistry implements PromptSectionRegistry {
  private readonly sections = new Map<string, PromptAssemblySection>();
  private onRegisterCallbacks: Array<(id: string, section: PromptAssemblySection) => void> = [];

  register(id: string, section: PromptAssemblySection): void {
    if (this.sections.has(id)) throw new Error(`Duplicate Prompt Section: ${id}`);
    const stored = Object.freeze({
      ...section,
      ...(section.metadata ? { metadata: Object.freeze({ ...section.metadata }) } : {}),
    });
    this.sections.set(id, stored);
    for (const cb of this.onRegisterCallbacks) cb(id, stored);
  }

  /**
   * 注册回调函数，在新节点注册时调用（用于 debug/logging）。
   * 返回取消注册的函数。
   */
  onRegister(callback: (id: string, section: PromptAssemblySection) => void): () => void {
    this.onRegisterCallbacks.push(callback);
    return () => {
      this.onRegisterCallbacks = this.onRegisterCallbacks.filter(cb => cb !== callback);
    };
  }

  merge(other: PromptAssemblyRegistry): this {
    for (const [id, section] of other.snapshot()) {
      this.register(id, section);
    }
    return this;
  }

  snapshot(): Array<readonly [string, PromptAssemblySection]> {
    return Array.from(this.sections.entries(), ([id, section]) => Object.freeze([id, section] as const));
  }

  entries(ctx?: RichSystemPromptContext): PromptAssemblyEntry[] {
    return this.snapshot()
      .sort((left, right) => Number(left[1].placement === 'tail') - Number(right[1].placement === 'tail')
        || right[1].order - left[1].order || left[0].localeCompare(right[0]))
      .flatMap(([id, section]) => {
        const content = this.resolveContent(section.content, ctx);
        if (!content?.trim()) return [];
        return [{ ...section, id, content }];
      });
  }

  list(ctx?: RichSystemPromptContext): Array<Omit<PromptAssemblyEntry, 'id'>> {
    return this.entries(ctx).map(({ id: _id, ...section }) => section);
  }

  /** The sections as text segments (`id`, kind from the layer, `order` as weight). */
  toSegments(ctx?: RichSystemPromptContext): PromptSegment[] {
    return this.snapshot().map(([id, section]) => {
      const tail = section.placement === 'tail';
      return {
        id,
        kind: section.kind ?? (tail ? 'platform' as const : segmentKindForLayer(section.layer)),
        weight: tail ? section.order - TAIL_WEIGHT_OFFSET : section.order,
        budgetOrder: section.budgetOrder ?? section.order,
        retention: section.retention,
        maxChars: section.maxChars,
        inject: () => this.resolveContent(section.content, ctx),
      };
    });
  }

  build(maxChars: number, ctx?: RichSystemPromptContext): string {
    const input: SegmentInput = { history: [], runtime: {}, session: { sessionKey: '' } };
    return new PromptSegmentRegistry().registerAll(this.toSegments(ctx)).buildSystemPrompt(input, maxChars);
  }

  private resolveContent(
    content: PromptSectionContent,
    ctx?: RichSystemPromptContext,
  ): string | null {
    if (typeof content === 'string') return content;
    if (!ctx) return null;
    return content(ctx) ?? null;
  }
}
