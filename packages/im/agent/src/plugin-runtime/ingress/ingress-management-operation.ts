/**
 * zhinjs/zhin#1250 第 83 批: the operation an Agent management Root command (`models`, `tree`,
 * `reset` …, see `createRuntimeManagementCommands`) runs in. It resolves the same session an AI turn
 * of the message would use and holds a generation lease for inference until the command settles.
 *
 * Internal module: deliberately not re-exported from the ingress index.
 */
import type { InferenceOperationScope, ModelKind, ProfileQuery } from '@zhin.js/ai/provider';
import { adapterDeclaresLiveDanmaku, type Message } from '@zhin.js/core/runtime';
import type { CapabilityId, RuntimeSnapshot, SnapshotLease } from '@zhin.js/plugin-runtime';
import type { RuntimeManagementOperation } from '../../init/runtime-management-commands.js';
import type { SessionToldLedger } from '../../memory/told-ledger.js';
import { sendFixedReply } from './clear-command.js';
import {
  createRuntimeTurnAccess,
  resolveRuntimeSenderRoles,
  runtimeImSessionKey,
  runtimeSceneTaskSessionKey,
} from './request.js';

export interface ManagementOperationInput {
  readonly message: Message;
  readonly signal: AbortSignal;
  readonly projectRoot: string;
  /** A lease on the current generation; absent: no inference (`models`, `health` fail). */
  readonly acquireLease?: () => SnapshotLease;
  readonly withInferenceScope?: <T>(input: Readonly<{ lease: SnapshotLease; sessionKey: string; signal: AbortSignal }>,
    operation: (scope: InferenceOperationScope) => Promise<T>) => Promise<T>;
  readonly withModelScope?: <T>(input: Readonly<{ lease: SnapshotLease; sessionKey: string; signal: AbortSignal }>,
    operation: () => Promise<T>) => Promise<T>;
  readonly toldLedger?: Pick<SessionToldLedger, 'recordDelivered'>;
}

/** The session an AI turn of `message` would use: the sender's own; a live room's shared scene task. */
export function managementSessionKey(message: Message, snapshot: RuntimeSnapshot | undefined, projectRoot: string): string {
  const access = createRuntimeTurnAccess(message, resolveRuntimeSenderRoles(message));
  const liveRoom = message.conversation.kind !== 'private' && snapshot !== undefined
    && adapterDeclaresLiveDanmaku(message.conversation.endpoint.id as CapabilityId, snapshot);
  return liveRoom ? runtimeSceneTaskSessionKey(access, projectRoot) : runtimeImSessionKey(access, projectRoot);
}

export async function runManagementOperation<T>(
  input: ManagementOperationInput,
  run: (operation: RuntimeManagementOperation) => Promise<T>,
): Promise<T> {
  const { message, signal } = input;
  const lease = input.acquireLease?.();
  try {
    const sessionKey = managementSessionKey(message, lease?.value, input.projectRoot);
    const withInferenceScope = input.withInferenceScope;
    const withModelScope = input.withModelScope;
    const operation: RuntimeManagementOperation = Object.freeze({
      sessionKey,
      ...(lease && withInferenceScope ? {
        inference: Object.freeze({
          list: <K extends ModelKind>(query: ProfileQuery<K>) =>
            withInferenceScope({ lease, sessionKey, signal }, scope => scope.client.list(query)),
        }),
      } : {}),
      ...(lease && withModelScope ? {
        withModelScope: <R>(operation: () => Promise<R>) => withModelScope({ lease, sessionKey, signal }, operation),
      } : {}),
      replyFixed: (text: string) => sendFixedReply({ reply: content => message.$reply(content), toldLedger: input.toldLedger, sessionKey, text }),
    });
    return await run(operation);
  } finally {
    lease?.release();
  }
}
