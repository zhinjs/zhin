/**
 * Resolve a ReminderActor from an Agent Tool invocation (IM origin only).
 */
import { createDeliveryTarget, type DeliveryTarget } from "zhin.js";
import { adapterFeatureId, type AdapterIndex } from "zhin.js/adapter";
import type { ToolInvocationOrigin } from "@zhin.js/tool";
import { ReminderInputError, type ReminderActor } from "./service.js";

export interface ToolActorContext {
  readonly origin: ToolInvocationOrigin;
  readonly principal: Readonly<{ subjectId: string; roles: readonly string[] }>;
  project<T>(feature: typeof adapterFeatureId): T;
}

/** Build the exact conversation DeliveryTarget for the current tool turn. */
export function toolDeliveryTarget(context: ToolActorContext): DeliveryTarget {
  const origin = context.origin;
  if (origin.kind !== "im") {
    throw new ReminderInputError(
      "提醒工具只能在聊天会话中使用（不能用于 http/schedule 等来源）"
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
    throw new ReminderInputError("无法确定当前会话所属的机器人账号");
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
  if (!senderId) throw new ReminderInputError("提醒工具需要真实发送者");
  return { senderId, target: toolDeliveryTarget(context) };
}
