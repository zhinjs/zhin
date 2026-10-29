/**
 * ADR 0041 §3 / §5: the segment registry. Text kinds become the system prompt in a fixed kind
 * order (system → environment → role_rules → platform → scene) and by descending `weight` within
 * a kind; the budget is {@link enforcePromptBudgetDetailed}. Message kinds are merged by
 * {@link mergeMessageSegments}.
 *
 * Cache split (§5): kinds system..platform are the stable prefix and must be byte-identical across
 * turns when their inputs do not change; `scene` is rendered last, so a provider that supports
 * breakpoints can place one at {@link SystemPromptParts.cacheBreakpoint}.
 */
import { SECTION_SEP } from '../../config/zhin-agent-constants.js';
import { estimatePromptTokens } from '../estimate-tokens.js';
import { enforcePromptBudgetDetailed, type PromptBudgetSection } from '../prompt-budget.js';
import {
  MESSAGE_SEGMENT_KINDS,
  TEXT_SEGMENT_KINDS,
  type MessageSegmentKind,
  type PromptSegment,
  type SegmentInput,
  type SegmentKind,
  type TextSegmentKind,
} from './types.js';
import type { MessageSegmentOutput } from './merge.js';

export interface PromptSegmentDebugInfo {
  readonly id: string;
  readonly kind: TextSegmentKind;
  readonly weight: number;
  /** Rendered characters after budgeting (0 when dropped). */
  readonly chars: number;
  /** Shortened or dropped by `maxChars` / the total budget. */
  readonly trimmed: boolean;
}

export interface SystemPromptParts {
  /** Full system prompt: `stable` + separator + `scene`. */
  readonly text: string;
  /** Kinds system..platform; byte-stable across turns when inputs do not change. */
  readonly stable: string;
  /** Kind `scene`; volatile, rendered after the cache breakpoint. */
  readonly scene: string;
  /** Character offset in `text` where `scene` begins; -1 when there is no scene text. */
  readonly cacheBreakpoint: number;
  readonly segments: readonly PromptSegmentDebugInfo[];
}

const TEXT_KIND_RANK: ReadonlyMap<string, number> = new Map(TEXT_SEGMENT_KINDS.map((kind, index) => [kind, index]));
const MESSAGE_KINDS: ReadonlySet<string> = new Set(MESSAGE_SEGMENT_KINDS);

export function isTextSegmentKind(kind: string): kind is TextSegmentKind {
  return TEXT_KIND_RANK.has(kind);
}

export function isMessageSegmentKind(kind: string): kind is MessageSegmentKind {
  return MESSAGE_KINDS.has(kind);
}

function validate(segment: PromptSegment): void {
  if (!segment || typeof segment.id !== 'string' || !segment.id.trim()) {
    throw new Error('Prompt Segment requires a non-empty id');
  }
  if (!isTextSegmentKind(segment.kind) && !isMessageSegmentKind(segment.kind)) {
    throw new Error(`Prompt Segment ${segment.id} has unknown kind: ${String(segment.kind)}`);
  }
  if (!Number.isFinite(segment.weight)) {
    throw new Error(`Prompt Segment ${segment.id} requires a finite weight`);
  }
  if (typeof segment.inject !== 'function') {
    throw new Error(`Prompt Segment ${segment.id} requires an inject function`);
  }
}

type ResolvedText = PromptSegment<TextSegmentKind> & { readonly content: string };

export class PromptSegmentRegistry {
  private readonly segments = new Map<string, PromptSegment>();

  /** Registers a segment; a duplicate id throws. Returns the matching unregister function. */
  register(segment: PromptSegment): () => void {
    validate(segment);
    if (this.segments.has(segment.id)) throw new Error(`Duplicate Prompt Segment: ${segment.id}`);
    const stored = Object.freeze({ ...segment });
    this.segments.set(segment.id, stored);
    return () => { if (this.segments.get(segment.id) === stored) this.segments.delete(segment.id); };
  }

  registerAll(segments: Iterable<PromptSegment>): this {
    for (const segment of segments) this.register(segment);
    return this;
  }

  unregister(id: string): boolean {
    return this.segments.delete(id);
  }

  has(id: string): boolean {
    return this.segments.has(id);
  }

  get(id: string): PromptSegment | undefined {
    return this.segments.get(id);
  }

  /** Every segment in render order: text kinds first (kind order, weight desc), then message kinds. */
  list(): PromptSegment[] {
    return [...this.segments.values()].sort(compareSegments);
  }

  merge(other: PromptSegmentRegistry): this {
    return this.registerAll(other.list());
  }

  /** Text segments that produced non-blank text, in render order. */
  private resolveText(input: SegmentInput): ResolvedText[] {
    return this.list().flatMap((segment) => {
      if (!isTextSegmentKind(segment.kind)) return [];
      const content = (segment as PromptSegment<TextSegmentKind>).inject(input);
      return typeof content === 'string' && content.trim()
        ? [{ ...(segment as PromptSegment<TextSegmentKind>), content }]
        : [];
    });
  }

  buildSystemPromptParts(input: SegmentInput, maxChars: number): SystemPromptParts {
    return this.assemble(this.resolveText(input), maxChars).parts;
  }

  buildSystemPrompt(input: SegmentInput, maxChars: number): string {
    return this.buildSystemPromptParts(input, maxChars).text;
  }

  /** Trace / debug listing: id, kind, weight, chars, trimmed (+ token estimate). */
  describe(
    input: SegmentInput,
    maxChars: number,
  ): Array<PromptSegmentDebugInfo & { approxChars: number; approxTokens: number }> {
    const { parts, contents } = this.assemble(this.resolveText(input), maxChars);
    return parts.segments.map((info, index) => ({
      ...info,
      approxChars: info.chars,
      approxTokens: estimatePromptTokens(contents[index] ?? ''),
    }));
  }

  /** Runs the message-kind segments, ready for `mergeMessageSegments`. */
  injectMessageSegments(input: SegmentInput): MessageSegmentOutput[] {
    return this.list().flatMap((segment) => {
      if (!isMessageSegmentKind(segment.kind)) return [];
      const messages = (segment as PromptSegment<MessageSegmentKind>).inject(input);
      return messages?.length
        ? [{ id: segment.id, kind: segment.kind as MessageSegmentKind, weight: segment.weight, messages }]
        : [];
    });
  }

  private assemble(resolved: readonly ResolvedText[], maxChars: number): { parts: SystemPromptParts; contents: string[] } {
    const budgetInput: PromptBudgetSection[] = resolved.map(segment => ({
      id: segment.id,
      content: segment.content,
      retention: segment.retention ?? 'preferred',
      order: segment.weight,
      budgetOrder: segment.budgetOrder,
      maxChars: segment.maxChars,
    }));
    const { outcomes } = enforcePromptBudgetDetailed(budgetInput, maxChars);
    const stable: string[] = [];
    const scene: string[] = [];
    const segments: PromptSegmentDebugInfo[] = [];
    const contents: string[] = [];
    resolved.forEach((segment, index) => {
      const outcome = outcomes[index]!;
      contents.push(outcome.content);
      segments.push(Object.freeze({
        id: segment.id,
        kind: segment.kind,
        weight: segment.weight,
        chars: outcome.content.length,
        trimmed: outcome.trimmed,
      }));
      if (outcome.content) (segment.kind === 'scene' ? scene : stable).push(outcome.content);
    });
    const stableText = stable.join(SECTION_SEP);
    const sceneText = scene.join(SECTION_SEP);
    const text = stableText && sceneText ? `${stableText}${SECTION_SEP}${sceneText}` : stableText || sceneText;
    return {
      contents,
      parts: Object.freeze({
        text,
        stable: stableText,
        scene: sceneText,
        cacheBreakpoint: sceneText ? text.length - sceneText.length : -1,
        segments: Object.freeze(segments),
      }),
    };
  }
}

function kindRank(kind: SegmentKind): number {
  const text = TEXT_KIND_RANK.get(kind);
  if (text !== undefined) return text;
  return TEXT_SEGMENT_KINDS.length + MESSAGE_SEGMENT_KINDS.indexOf(kind as MessageSegmentKind);
}

function compareSegments(left: PromptSegment, right: PromptSegment): number {
  return kindRank(left.kind) - kindRank(right.kind)
    || right.weight - left.weight
    || left.id.localeCompare(right.id);
}
