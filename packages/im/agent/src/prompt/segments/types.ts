/**
 * ADR 0041 §3 prompt segments: the single way built-in and plugin content enters a request.
 *
 * Text kinds (system → scene) become the system prompt, in the fixed kind order below and by
 * descending `weight` within a kind. Message kinds (user → state) return timestamped messages
 * that the assembler merges chronologically (ties: state → user → tool → assistant, then weight),
 * keeping tool call / result pairs adjacent and only ever appending events after the sent prefix.
 */
import type { AgentMessage, EventMessage } from '@zhin.js/ai';
import type { PromptRetention } from '../prompt-budget.js';

export const TEXT_SEGMENT_KINDS = Object.freeze(['system', 'environment', 'role_rules', 'platform', 'scene'] as const);
export const MESSAGE_SEGMENT_KINDS = Object.freeze(['user', 'tool', 'assistant', 'state'] as const);
export type TextSegmentKind = typeof TEXT_SEGMENT_KINDS[number];
export type MessageSegmentKind = typeof MESSAGE_SEGMENT_KINDS[number];
export type SegmentKind = TextSegmentKind | MessageSegmentKind;

/** Order of message kinds at an equal timestamp (a state change precedes the message it affects). */
export const MESSAGE_KIND_TIE_ORDER: readonly MessageSegmentKind[] = Object.freeze(['state', 'user', 'tool', 'assistant']);

/** Stable runtime facts a segment may read. Must not carry the current wall clock (ADR 0041 §5). */
export interface SegmentRuntimeView {
  readonly modelId?: string;
  readonly providerAlias?: string;
  readonly modelSdk?: string;
  readonly contextWindow?: number;
  readonly timeZone?: string;
  readonly workspaceRoot?: string;
  /** Escape hatch for the built-in section adapters; plugins should not rely on it. */
  readonly legacy?: Readonly<Record<string, unknown>>;
}

/** Conversation scene and member facts resolved by the trusted ingress. */
export interface SegmentSessionView {
  readonly sessionKey: string;
  readonly platform?: string;
  readonly scene?: Readonly<{
    id: string;
    type: string;
    name?: string;
    ownerId?: string;
    adminIds?: readonly string[];
    memberCount?: number;
    globalMute?: boolean;
    assistantRole?: string;
  }>;
}

export interface SegmentInput {
  /** Stored history visible to this request, including the current turn's input, oldest first. */
  readonly history: readonly AgentMessage[];
  readonly runtime: SegmentRuntimeView;
  readonly session: SegmentSessionView;
}

export type SegmentOutput<K extends SegmentKind> =
  K extends TextSegmentKind ? string
    : K extends 'state' ? readonly EventMessage[]
      : readonly AgentMessage[];

export interface PromptSegment<K extends SegmentKind = SegmentKind> {
  readonly id: string;
  readonly kind: K;
  /** Higher first within the same kind. */
  readonly weight: number;
  /** Text kinds only: budget retention (`required` is never trimmed). */
  readonly retention?: PromptRetention;
  readonly maxChars?: number;
  inject(input: SegmentInput): SegmentOutput<K> | null | undefined;
}
