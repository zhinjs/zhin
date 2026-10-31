import { readOperationSession } from '@zhin.js/core';
import { createDeliveryTarget, type DeliveryTarget } from '@zhin.js/plugin-runtime';

/** In-memory execution authority; deliberately absent from JSON, logs and model context. */
export const activityFeedbackSource = Symbol('zhin.activity-feedback.source');
export interface ActivityFeedbackSource {
  readonly target: DeliveryTarget;
  readonly client: unknown;
  readonly signal: AbortSignal;
}
export interface ActivityFeedbackSourceCarrier {
  readonly [activityFeedbackSource]?: ActivityFeedbackSource;
}

/** Copy no Message, snapshot or credential-bearing configuration into a lifecycle event. */
export function bindActivityFeedbackSource<T extends object>(payload: T, input: unknown): T & ActivityFeedbackSourceCarrier {
  // Feedback is optional. A synthetic or already-ended operation grants no platform authority.
  let session: ReturnType<typeof readOperationSession>;
  try { session = readOperationSession(input); } catch { return payload; }
  if (!session || session.signal.aborted) return payload;
  Object.defineProperty(payload, activityFeedbackSource, {
    value: Object.freeze({ target: createDeliveryTarget({ conversation: session.scene }),
      client: session.endpoint, signal: session.signal }), enumerable: false,
  });
  return payload;
}

/** Preserve authority explicitly through internal projections; object spread must not serialize it. */
export function inheritActivityFeedbackSource<T extends object>(payload: T, source: ActivityFeedbackSourceCarrier): T & ActivityFeedbackSourceCarrier {
  const operation = source[activityFeedbackSource];
  if (operation) Object.defineProperty(payload, activityFeedbackSource, { value: operation, enumerable: false });
  return payload;
}

/** FullAgent consumes TurnIngress rather than a RuntimeMessage; its Client port is already source-bound. */
export function bindActivityFeedbackTurnSource<T extends object>(payload: T,
  turn: import('../turn/turn-ingress.js').TurnIngress): T & ActivityFeedbackSourceCarrier {
  if (turn.origin.kind !== 'im' || !turn.origin.conversation || !turn.ports.client || turn.signal.aborted) return payload;
  let client: unknown;
  try { client = turn.ports.client.get(); } catch { return payload; }
  Object.defineProperty(payload, activityFeedbackSource, { value: Object.freeze({
    target: createDeliveryTarget({ conversation: turn.origin.conversation }), client, signal: turn.signal,
  }), enumerable: false });
  return payload;
}
