import { resolveLocale, type Locale } from 'zhin.js/i18n';
import { reminderMessages as t } from './i18n.js';
/**
 * Resolve a ReminderActor from an Agent Tool invocation (IM origin only).
 */
import { createDeliveryTarget, type DeliveryTarget } from "zhin.js";
import { adapterFeatureId, type AdapterIndex } from "zhin.js/adapter";
import type { ToolInvocationOrigin } from "@zhin.js/tool";
import { ReminderInputError, type ReminderActor } from "./service.js";

export interface ToolActorContext {
  readonly origin: ToolInvocationOrigin;
  readonly locale?: Locale;
  readonly principal: Readonly<{ subjectId: string; roles: readonly string[] }>;
  project<T>(feature: typeof adapterFeatureId): T;
}

/** Build the exact conversation DeliveryTarget for the current tool turn. */
export function toolDeliveryTarget(context: ToolActorContext): DeliveryTarget {
  const origin = context.origin;
  if (origin.kind !== "im") {
    throw new ReminderInputError(
      t(context.locale, 'toolOrigin')
    );
  }
  const index = context.project<AdapterIndex>(adapterFeatureId);
  const matches = index
    .describe()
    .filter(
      (endpoint) =>
        (String(endpoint.id) === origin.endpoint ||
          endpoint.name === origin.endpoint) &&
        index.clientAdapter(endpoint.id) === origin.platform
    );
  if (matches.length !== 1) {
    throw new ReminderInputError(t(context.locale, 'toolEndpoint'));
  }
  if (origin.conversation) {
    const canonical = createDeliveryTarget({ conversation: origin.conversation });
    if (canonical.endpoint.id !== String(matches[0]!.id) || canonical.endpoint.adapter !== origin.platform
      || canonical.kind !== origin.scope || canonical.id !== origin.sceneId || canonical.threadId !== origin.threadId) {
      throw new ReminderInputError(t(context.locale, 'toolEndpoint'));
    }
    return canonical;
  }
  return createDeliveryTarget({
    conversation: {
      endpoint: { id: String(matches[0]!.id), adapter: origin.platform },
      kind: origin.scope,
      id: origin.sceneId,
      ...(origin.threadId !== undefined ? { threadId: origin.threadId } : {}),
    },
  });
}

/** Actor bound to the invoking principal and the current IM conversation. */
export function reminderActorFromTool(
  context: ToolActorContext
): ReminderActor {
  const senderId = context.principal.subjectId?.trim();
  if (!senderId) throw new ReminderInputError(t(context.locale, 'toolSender'));
  return { senderId, target: toolDeliveryTarget(context), locale: resolveLocale(context.locale) };
}
