/**
 * #1250: why an `ask` / `delegate` with `attach_media: true` reached the other agent without (some of) the
 * human's media. The actor turn records the reasons per answered mail; the asking tool takes them once and
 * tells its model next to the reply, so it does not assume the other agent looked at the original.
 */
export type DelegatedMediaSkipReason =
  | 'no_media'
  | 'entry_agent'
  | 'model_input'
  | 'already_attached'
  | 'limit'
  | 'unavailable';

const REASON_TEXT: Readonly<Record<DelegatedMediaSkipReason, string>> = Object.freeze({
  no_media: 'the human\'s message has no media to attach',
  entry_agent: 'the entry agent already has the human\'s message',
  model_input: 'that agent\'s model does not take this kind of media',
  already_attached: 'that agent already received the media in this request',
  limit: 'the media limit for this request (count or size) is used up',
  unavailable: 'the media could not be read',
});

/** Bounded like the attachment side channel: answered mails nobody takes are dropped oldest first. */
const MAX_PENDING_MAILS = 64;
const byHarness = new WeakMap<object, Map<string, readonly DelegatedMediaSkipReason[]>>();

export function recordDelegatedMediaSkips(
  harness: object,
  mailIds: readonly string[],
  reasons: readonly DelegatedMediaSkipReason[],
): void {
  if (reasons.length === 0 || mailIds.length === 0) return;
  let pending = byHarness.get(harness);
  if (!pending) {
    pending = new Map();
    byHarness.set(harness, pending);
  }
  const frozen = Object.freeze([...new Set(reasons)]);
  for (const id of mailIds) {
    pending.delete(id);
    pending.set(id, frozen);
  }
  while (pending.size > MAX_PENDING_MAILS) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) break;
    pending.delete(oldest);
  }
}

/** Takes (once) the reasons recorded for an answered mail; empty when all requested media went along. */
export function takeDelegatedMediaSkips(harness: object, mailId: string | undefined): readonly DelegatedMediaSkipReason[] {
  if (!mailId) return [];
  const pending = byHarness.get(harness);
  const found = pending?.get(mailId);
  if (!found) return [];
  pending!.delete(mailId);
  return found;
}

/** The framework line for the asking model, or `undefined` when nothing was left out. */
export function renderDelegatedMediaNotice(agent: string, reasons: readonly DelegatedMediaSkipReason[]): string | undefined {
  if (reasons.length === 0) return undefined;
  return `[Media not attached to ${agent}: ${reasons.map(reason => REASON_TEXT[reason]).join('; ')}.]`;
}
