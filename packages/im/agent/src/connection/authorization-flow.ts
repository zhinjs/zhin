/**
 * Connection authorization flow — Eve-aligned stream events (ADR 0039 P1).
 * Host completes OAuth via POST /zhin/v1/authorization/:requestId/complete.
 */
import { randomUUID } from 'node:crypto';
import { AgentStreamEventType, type AgentStreamEvent } from '@zhin.js/ai/agent-stream';
import type {
  AuthorizationCompletedData,
  AuthorizationRequiredData,
} from '@zhin.js/ai/authorization-events';

type PendingAuthorization = {
  sessionId: string;
  connection: string;
  resolve: (result: { success: boolean; error?: string }) => void;
};

const pending = new Map<string, PendingAuthorization>();

export function resetAuthorizationFlowForTests(): void {
  for (const entry of pending.values()) {
    entry.resolve({ success: false, error: 'test_reset' });
  }
  pending.clear();
}

export function buildAuthorizationRequiredEvent(
  data: AuthorizationRequiredData,
): AgentStreamEvent {
  return { type: AgentStreamEventType.AUTHORIZATION_REQUIRED, data };
}

export function buildAuthorizationCompletedEvent(
  data: AuthorizationCompletedData,
): AgentStreamEvent {
  return { type: AgentStreamEventType.AUTHORIZATION_COMPLETED, data };
}

export interface RequestConnectionAuthorizationInput {
  sessionId: string;
  connection: string;
  authUrl?: string;
  scope?: string;
  publish?: (event: AgentStreamEvent) => void | Promise<void>;
  timeoutMs?: number;
}

/**
 * Emit authorization.required and wait until Host calls completeConnectionAuthorization.
 */
export async function requestConnectionAuthorization(
  input: RequestConnectionAuthorizationInput,
): Promise<{ success: boolean; error?: string }> {
  const requestId = `auth_${input.connection}_${randomUUID().slice(0, 8)}`;
  const required = buildAuthorizationRequiredEvent({
    sessionId: input.sessionId,
    requestId,
    connection: input.connection,
    authUrl: input.authUrl,
    scope: input.scope,
  });
  await input.publish?.(required);

  return new Promise((resolve) => {
    const timer = input.timeoutMs
      ? setTimeout(() => {
          pending.delete(requestId);
          void input.publish?.(
            buildAuthorizationCompletedEvent({
              sessionId: input.sessionId,
              requestId,
              connection: input.connection,
              success: false,
              error: 'authorization_timeout',
            }),
          );
          resolve({ success: false, error: 'authorization_timeout' });
        }, input.timeoutMs)
      : undefined;

    pending.set(requestId, {
      sessionId: input.sessionId,
      connection: input.connection,
      resolve: (result) => {
        if (timer) clearTimeout(timer);
        pending.delete(requestId);
        resolve(result);
      },
    });
  });
}

export function completeConnectionAuthorization(
  requestId: string,
  result: { success: boolean; error?: string },
  publish?: (event: AgentStreamEvent) => void | Promise<void>,
): boolean {
  const entry = pending.get(requestId);
  if (!entry) return false;
  void publish?.(
    buildAuthorizationCompletedEvent({
      sessionId: entry.sessionId,
      requestId,
      connection: entry.connection,
      success: result.success,
      error: result.error,
    }),
  );
  entry.resolve(result);
  return true;
}

export function getPendingAuthorizationRequestIds(): string[] {
  return [...pending.keys()];
}
