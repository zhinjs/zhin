import type { Message } from '@zhin.js/core'

import type { BridgeInboundGlueState } from './types.js'

/**
 * Per-`Message` bridge outcome is stored in a `WeakMap` so we do not extend
 * `Message` / `MessageBase` in `@zhin.js/core` (would couple core to Bridge v1)
 * and we avoid reserved field collisions on platform-specific message bags.
 */
const bridgeInboundByMessage = new WeakMap<Message, BridgeInboundGlueState>()

export function getBridgeInboundGlueState(message: Message): BridgeInboundGlueState | undefined {
  return bridgeInboundByMessage.get(message)
}

export function setBridgeInboundGlueState(message: Message, state: BridgeInboundGlueState): void {
  bridgeInboundByMessage.set(message, state)
}
