import { outboundHostToken, type OutboundHost } from 'zhin.js';
import { gameTargetFromKey, sendGameSessionMessage } from '@zhin.js/game-kit';
import { expireOverdueSessions, type ExpiredSessionNotice } from './game-flow.js';
import { resolveRouletteFlow, rouletteFeatureGateStore, type RouletteCapabilityContext, type RouletteFeatureGate } from './runtime.js';

/** Turn and lobby deadlines are checked every five seconds. */
export const DEADLINE_CRON = '*/5 * * * * *';

/**
 * One deadline sweep. It runs with the schedule's capability context, so a
 * timed-out loser gets the same mute check (adapter projection) as one who
 * was shot in a command.
 */
export async function runDeadlineSweep(context: RouletteCapabilityContext, now: number): Promise<void> {
  const flow = resolveRouletteFlow(context);
  const outbound = readOutbound(context);
  const enabledFor = readFeatureGate(context);
  await expireOverdueSessions(flow, now, (notice) => {
    if (outbound) return announce(outbound, notice);
  }, enabledFor && ((session) => {
    const target = gameTargetFromKey(session.channel_key);
    return !target || enabledFor.isEnabledFor(target);
  }));
}

function readFeatureGate(context: RouletteCapabilityContext): RouletteFeatureGate | undefined {
  try {
    return context.use(rouletteFeatureGateStore);
  } catch {
    return undefined;
  }
}

function readOutbound(context: RouletteCapabilityContext): OutboundHost | undefined {
  try {
    return context.use(outboundHostToken);
  } catch {
    return undefined;
  }
}

async function announce(outbound: OutboundHost, notice: ExpiredSessionNotice): Promise<void> {
  const session = notice.session;
  try {
    await sendGameSessionMessage({ outbound, session, content: notice.text });
  } catch {
    // The result is already stored; a failed notice must not stop the other sessions.
  }
}
