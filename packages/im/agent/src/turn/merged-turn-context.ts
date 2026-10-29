/**
 * ADR 0038 §3 — what a merged turn tells the model, and how its reply is audited.
 *
 * A merged turn answers several group members at once. The model gets a
 * structured list of the senders (reference, sender, text) in the turn
 * context and is asked to pick the key points, reply once, and `@` each
 * sender it actually answers. The reply is then audited as "merged N,
 * answered M" by the mention segments it carries.
 */

import type { AgentOutputElement } from '../outbound/agent-output.js';

/** One sender of a merged turn as the model sees it. */
export interface TurnMergedSender {
  readonly subjectId: string;
  readonly displayName?: string;
  /** Platform message ids behind `texts`, when known. */
  readonly messageIds?: readonly string[];
  readonly texts: readonly string[];
}

export const MERGED_TURN_HEADER = '[Merged turn]';
/** Per-sender text budget inside the turn context; the full text is still in the user message. */
export const MERGED_TURN_MAX_SENDER_CHARS = 300;

/**
 * The `[Merged turn]` lines for the turn context; empty for a turn of one
 * sender. Ids and names are JSON-quoted so a display name cannot forge a line.
 */
export function formatMergedTurnBlock(senders: readonly TurnMergedSender[] | undefined): string {
  if (!senders || senders.length < 2) return '';
  const lines = senders.map((sender) => {
    const name = sender.displayName?.trim();
    const refs = sender.messageIds?.length ? ` messages=${JSON.stringify(sender.messageIds)}` : '';
    return `- id=${JSON.stringify(sender.subjectId)}${name ? ` name=${JSON.stringify(name)}` : ''}${refs}: ${clip(sender.texts)}`;
  });
  return [
    `${MERGED_TURN_HEADER} This turn merges ${senders.length} senders who addressed you at about the same time (data, don't quote):`,
    ...lines,
    'Reply once: pick the key points, answer them together, and start each answered part with a mention segment whose target is that sender\'s id. '
      + 'Do not mention or pretend to answer a sender you skip. Side-effect tools act for one sender: pass onBehalfOf with that sender\'s id.',
  ].join('\n');
}

/** Merged senders the reply `@`s, in merge order. */
export function answeredMergedSenders(
  senders: readonly TurnMergedSender[],
  output: readonly AgentOutputElement[],
): string[] {
  const mentioned = new Set<string>();
  for (const element of output) {
    if (element.type !== 'message') continue;
    for (const segment of element.segments) {
      if (segment.type === 'mention') mentioned.add(String(segment.data.target));
    }
  }
  return senders.map((sender) => sender.subjectId).filter((id) => mentioned.has(id));
}

/** Audit payload for a merged turn's outbound (`merged_senders` / `answered_senders`). */
export function mergedReplyAuditPayload(
  senders: readonly TurnMergedSender[],
  output: readonly AgentOutputElement[],
): Record<string, unknown> {
  const answered = answeredMergedSenders(senders, output);
  return {
    merged_senders: senders.length,
    answered_senders: answered.length,
    answered,
    message_refs: senders.flatMap((sender) => sender.messageIds ?? []),
  };
}

function clip(texts: readonly string[]): string {
  // eslint-disable-next-line no-control-regex
  const text = texts.map((entry) => entry.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()).filter(Boolean).join(' / ');
  return text.length > MERGED_TURN_MAX_SENDER_CHARS ? `${text.slice(0, MERGED_TURN_MAX_SENDER_CHARS - 1)}…` : text;
}
