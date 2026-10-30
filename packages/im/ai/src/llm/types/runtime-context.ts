/**
 * Current-message runtime context (prompt-cache layout).
 *
 * The current user message is sent as `body` + `RUNTIME_CONTEXT_MARKER` + per-turn host blocks.
 * The body (header + participant text) is byte-identical to how the same message renders later as
 * history, so the provider prefix cache stays valid across turns; everything that only describes
 * this turn (rules, memory, skills, tool index, mutable scene state, `[Turn context]` …) follows the marker
 * and is dropped before storage (ADR 0043 §1).
 */
export const RUNTIME_CONTEXT_MARKER = '[Host context]';

/**
 * Host markers a participant could type to impersonate host data. Escaped (the opening `[`
 * becomes a full-width `［`) in participant-authored text at the LLM boundary. Idempotent.
 */
const SPOOFABLE_HOST_MARKER = /\[(?=Host context\]|Runtime context|Context source:|\/?Turn context\])/gu;

export function escapeHostMarkers(text: string): string {
  return text.replace(SPOOFABLE_HOST_MARKER, '［');
}

/** A provider text part that opens the runtime-context tail (after bridge newline joining). */
export function isRuntimeContextMarkerText(text: string): boolean {
  return text.trimStart().startsWith(RUNTIME_CONTEXT_MARKER);
}
