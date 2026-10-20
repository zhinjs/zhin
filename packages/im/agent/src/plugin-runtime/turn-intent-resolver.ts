import type { Message } from '@zhin.js/core/runtime';
import { createToken } from '@zhin.js/plugin-runtime';
import type { TurnIntent } from '../turn/turn-ingress.js';

export interface TurnIntentSenderRoles {
  readonly isMaster: boolean;
  readonly isTrusted: boolean;
}

/** Trusted adapter/plugin policy input at the outer IM ingress boundary. */
export interface TurnIntentResolutionInput {
  readonly message: Message;
  readonly senderRoles: TurnIntentSenderRoles;
  readonly defaultIntent: TurnIntent;
}

export type TurnIntentResolver = (
  input: Readonly<TurnIntentResolutionInput>,
) => TurnIntent | Promise<TurnIntent>;

/**
 * Endpoint-owning plugins may provide this token to resolve scene-specific intent.
 * The Host reads it from the fixed generation snapshot; message metadata cannot
 * manufacture the trusted `authorizedBy` result.
 */
export const turnIntentResolverToken = createToken<TurnIntentResolver>(
  'zhin.agent.turn-intent-resolver',
  'Trusted adapter/plugin policy for canonical shared-session Turn Intent',
);
