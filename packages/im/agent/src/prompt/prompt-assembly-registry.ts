import { enforcePromptBudget } from './prompt-budget.js';
import type { PromptSection } from './prompt-builder.js';
import type { RichSystemPromptContext } from './system-prompt.js';

export type PromptSectionContent =
  | string
  | ((ctx: RichSystemPromptContext) => string | null | undefined);

export interface PromptAssemblySection extends Omit<PromptSection, 'content'> {
  content: PromptSectionContent;
}

export interface PromptAssemblyEntry extends PromptSection {
  id: string;
}

export interface PromptSectionRegistry {
  register(id: string, section: PromptAssemblySection): void;
  list(ctx?: RichSystemPromptContext): PromptSection[];
  build(maxChars: number, ctx?: RichSystemPromptContext): string;
}

export class PromptAssemblyRegistry implements PromptSectionRegistry {
  private readonly sections = new Map<string, PromptAssemblySection>();
  private onRegisterCallbacks: Array<(id: string, section: PromptAssemblySection) => void> = [];

  register(id: string, section: PromptAssemblySection): void {
    this.sections.set(id, section);
    for (const cb of this.onRegisterCallbacks) cb(id, section);
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

  snapshot(): Array<[string, PromptAssemblySection]> {
    return Array.from(this.sections.entries());
  }

  entries(ctx?: RichSystemPromptContext): PromptAssemblyEntry[] {
    return this.snapshot()
      .sort((a, b) => (b[1].priority ?? 50) - (a[1].priority ?? 50))
      .flatMap(([id, section]) => {
        const content = this.resolveContent(section.content, ctx);
        if (!content?.trim()) return [];
        return [{ ...section, id, content }];
      });
  }

  list(ctx?: RichSystemPromptContext): PromptSection[] {
    return this.entries(ctx).map(({ id: _id, ...section }) => section);
  }

  build(maxChars: number, ctx?: RichSystemPromptContext): string {
    return enforcePromptBudget(
      this.entries(ctx).map(section => ({
        content: section.content,
        truncatable: section.truncatable,
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
