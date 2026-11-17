import type { ReactNode } from 'react';
import type { SandboxLocale } from '../messages.js';

/**
 * ADR 0064 §2: what a Sandbox segment renderer may read about the message it renders in.
 * Renderers never reach into the page's state; interaction goes through `sendAction`.
 */
export interface SandboxSegmentRenderContext {
  readonly locale: SandboxLocale;
  /** The message was sent by the simulated user (inverse colours, never interactive). */
  readonly isSent: boolean;
  readonly messageId?: string;
  /** The message's interaction has been answered. */
  readonly interactionResolved: boolean;
  /** The connection may run actions and this view allows interaction (not history read-only). */
  readonly canInteract: boolean;
  /**
   * Sends an interactive choice for this message; `true` when the frame was submitted. `buttonId` is
   * the button's own id, delivered as the action id exactly like a platform callback (#1250
   * `sandbox-action-button-id-dropped`); the payload travels separately.
   */
  readonly sendAction: (payload: string, buttonId?: string) => boolean;
  /** Payloads already submitted from this message (shown as sent; other buttons stay usable). */
  readonly submittedPayloads?: readonly string[];
  /** Renders nested segments (forward records) with the same registry, never interactively. */
  readonly renderNested: (segments: readonly unknown[]) => ReactNode;
  /**
   * ADR 0064 D12 (I1): a Sandbox-hosted link (`/pub/sandbox-media/…`) as a displayable blob URL,
   * fetched through the Console download with the page's credentials; undefined when it is gone.
   */
  readonly resolveHostedMedia?: SandboxSegmentContextResolver;
}

/** Hosted link → blob URL (undefined when the file is deleted, expired or not in this conversation). */
export type SandboxSegmentContextResolver = (url: string) => Promise<string | undefined>;

/** One segment's best-effect renderer (ADR 0064 §0.1: the Sandbox is the capability ceiling). */
export type SandboxSegmentRenderer = (
  data: Readonly<Record<string, unknown>>,
  context: SandboxSegmentRenderContext,
  key: string | number,
) => ReactNode;

export function stringField(data: Readonly<Record<string, unknown>>, ...names: string[]): string {
  for (const name of names) {
    const value = data[name];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

/**
 * The object items of a list field. Card data is loosely validated (`card` is a Core extension
 * type) and history comes from browser storage, so a malformed item (`null`, a string, …) is
 * skipped instead of breaking the page's render.
 */
export function recordItems(value: unknown): Array<Readonly<Record<string, unknown>>> {
  return Array.isArray(value)
    ? value.filter((item): item is Readonly<Record<string, unknown>> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}
