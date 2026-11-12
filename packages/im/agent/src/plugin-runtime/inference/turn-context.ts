import type { ProviderCallContext } from '@zhin.js/ai/provider';
import type { TurnRequest } from '../../index.js';
import type { ConversationRef } from '@zhin.js/im-contract';
import type { RuntimeMessage } from '@zhin.js/core/runtime';
import { createRuntimeTurnAccess, resolveRuntimeSenderRoles, runtimePersonalSessionAddress } from '../ingress/request.js';
import {
  personalSessionIdentity,
  personalSessionOwnerId,
  samePersonalSessionAddress,
  type PersonalSessionService,
} from '../../personal-session/index.js';

export interface InferenceTurnContextOptions {
  readonly rootId: string;
  readonly hostOwnerId: string;
  readonly sessions: PersonalSessionService;
}

/** Canonical trusted ingress fields only; text, model arguments and display names never choose an owner. */
export async function resolveInferenceTurnContext(
  options: InferenceTurnContextOptions,
  request: TurnRequest
): Promise<ProviderCallContext> {
  return resolveContext(options, {
    personal: request.session.personal,
    subjectId: request.principal.subjectId,
    origin: request.origin,
    sessionKey: request.session.key,
    operationId: request.identity.turnId,
  });
}

/** Core passes the authenticated Message, never the plugin's arbitrary data object. */
export async function resolveInferenceMessageContext(
  options: InferenceTurnContextOptions,
  message: RuntimeMessage,
  operationId: string
): Promise<ProviderCallContext> {
  const access = createRuntimeTurnAccess(message, resolveRuntimeSenderRoles(message));
  const personal = runtimePersonalSessionAddress(access, options.rootId);
  return resolveContext(options, {
    personal,
    subjectId: access.principal.subjectId,
    origin: access.origin,
    sessionKey: personalSessionIdentity(personal).key,
    operationId,
  });
}

interface TrustedContextInput {
  readonly personal?: TurnRequest['session']['personal'];
  readonly subjectId: string;
  readonly origin: TurnRequest['origin'];
  readonly sessionKey: string;
  readonly operationId: string;
}
async function resolveContext(
  options: InferenceTurnContextOptions,
  input: TrustedContextInput
): Promise<ProviderCallContext> {
  const { rootId, hostOwnerId } = options;
  const personal = input.personal;
  let ownerId = hostOwnerId;
  let sessionChat: ProviderCallContext['sessionChat'];
  if (personal) {
    const identity = personalSessionIdentity(personal);
    if (
      personal.rootId !== rootId ||
      personal.subjectId !== input.subjectId ||
      identity.key !== input.sessionKey ||
      input.origin.kind !== 'im' ||
      personal.platform !== input.origin.platform ||
      personal.endpoint !== input.origin.endpoint ||
      !input.origin.conversation ||
      !samePersonalSessionAddress(personal, {
        ...personal,
        conversation: input.origin.conversation,
      })
    ) {
      throw new Error('Personal Session does not match trusted turn identity');
    }
    ownerId = personalSessionOwnerId(identity.owner);
    const selection = (await options.sessions.read({ address: personal, owner: identity.owner }))
      .selection;
    if (selection.kind === 'profile') sessionChat = selection.profile;
  }
  const origin = input.origin;
  const conversation = origin.kind === 'im' ? origin.conversation : undefined;
  return {
    rootId,
    hostOwnerId,
    ownerId,
    operationId: input.operationId,
    sessionKey: input.sessionKey,
    ...(sessionChat ? { sessionChat } : {}),
    ...(origin.kind === 'im' && conversation
      ? {
          ...inferencePolicyKeys({
            rootId,
            platform: origin.platform,
            endpoint: origin.endpoint,
            conversation,
          }),
        }
      : {}),
  };
}

/** One canonical encoding for trusted ingress and management's address-only target projection. */
export function inferencePolicyKeys(
  input: Readonly<{
    rootId: string;
    platform: string;
    endpoint: string;
    conversation: ConversationRef;
  }>
) {
  const { rootId, platform, endpoint, conversation } = input;
  return {
    adapterKey: platform,
    endpointKey: JSON.stringify([rootId, platform, endpoint, conversation.endpoint.id]),
    sceneKey: JSON.stringify([
      rootId,
      platform,
      endpoint,
      conversation.endpoint.adapter,
      conversation.endpoint.id,
      conversation.kind,
      conversation.id,
      conversation.parent?.kind ?? null,
      conversation.parent?.id ?? null,
      conversation.threadId ?? null,
    ]),
  };
}
