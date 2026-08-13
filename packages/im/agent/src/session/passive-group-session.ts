/**
 * Passive group context is keyed by the canonical Agent session identity.
 * IM and collaboration adapters resolve that identity before entering here.
 */
import { buildAgentSessionCreateInput } from './session-io.js';
import {
  drainPassiveGroupBuffer,
  formatPassiveGroupContextBlock,
  pushPassiveGroupLine,
} from './passive-group-buffer.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';

export interface PassiveGroupObservation {
  readonly sessionKey: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly text: string;
}

export async function recordPassiveGroupObservation(
  agent: Pick<ZhinAgentPrivate, 'agentSessionStore'>,
  observation: PassiveGroupObservation,
): Promise<void> {
  const sessionKey = observation.sessionKey.trim();
  const text = observation.text.trim();
  if (!sessionKey) throw new TypeError('Passive group observation requires a session key');
  if (!text) return;

  await agent.agentSessionStore.getOrCreateActive(buildAgentSessionCreateInput(sessionKey));
  pushPassiveGroupLine(sessionKey, {
    senderId: normalizeIdentity(observation.senderId),
    senderName: normalizeIdentity(observation.senderName),
    text,
    at: Date.now(),
  });
}

export function consumePassiveGroupContextForTurn(sessionKey: string): string | null {
  const key = sessionKey.trim();
  if (!key) throw new TypeError('Passive group context requires a session key');
  return formatPassiveGroupContextBlock(drainPassiveGroupBuffer(key));
}

function normalizeIdentity(value: string): string {
  const normalized = value.trim().replace(/[\]\s]+/g, '_');
  return normalized ? normalized.slice(0, 64) : 'unknown';
}
