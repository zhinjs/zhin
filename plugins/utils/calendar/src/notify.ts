import type { DeliveryTarget, OutboundHost } from "zhin.js";
import type { Locale } from "zhin.js/i18n";
import type { CalendarNotifier } from "./chat-auth.js";

/**
 * Authorization notices are not messages, so the dispatch gate does not see them (ADR 0050 / 0055):
 * skip targets whose account or conversation switched calendar off.
 */
export function createCalendarNotifier(
  outbound: Pick<OutboundHost, "sendTarget"> | undefined,
  isEnabledFor: (target: { conversation: DeliveryTarget }) => boolean
): CalendarNotifier<DeliveryTarget> | undefined {
  const sendTarget = outbound?.sendTarget;
  if (!sendTarget) return undefined;
  return async (target: DeliveryTarget, text: string, locale: Locale) => {
    if (!isEnabledFor({ conversation: target })) return;
    await sendTarget.call(outbound, target, text, { locale });
  };
}
