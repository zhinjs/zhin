import { enforcePromptBudget } from './prompt-budget.js';
import type { PromptLayer } from './prompt-builder.js';
import type { PromptRetention } from './prompt-budget.js';
import type { RichSystemPromptContext } from './system-prompt.js';

export type PromptSectionContent =
  | string
  | ((ctx: RichSystemPromptContext) => string | null | undefined);

export interface PromptAssemblySection {
  readonly layer: PromptLayer;
  readonly title: string;
  content: PromptSectionContent;
  readonly order: number;
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
      .sort((left, right) => right[1].order - left[1].order || left[0].localeCompare(right[0]))
      .flatMap(([id, section]) => {
        const content = this.resolveContent(section.content, ctx);
        if (!content?.trim()) return [];
        return [{ ...section, id, content }];
      });
  }

  list(ctx?: RichSystemPromptContext): Array<Omit<PromptAssemblyEntry, 'id'>> {
    return this.entries(ctx).map(({ id: _id, ...section }) => section);
  }

  build(maxChars: number, ctx?: RichSystemPromptContext): string {
    return enforcePromptBudget(
      this.entries(ctx).map(section => ({
        id: section.id,
        content: section.content,
        retention: section.retention,
        order: section.order,
        maxChars: section.maxChars,
      })),
      maxChars,
    );
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
