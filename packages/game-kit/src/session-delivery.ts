import { resolveLocale, DataMigrationError, type OutboundHost } from '@zhin.js/plugin-runtime';
import type { GameEventSession } from './game-events.js';
import { gameTargetFromKey } from './board-sender.js';

/** New scopes use exact targets. The historical branch preserves existing data behavior pending migration approval. */
export async function sendGameSessionMessage(input: Readonly<{
  outbound: OutboundHost;
  session: GameEventSession & Readonly<{ locale?: import('@zhin.js/plugin-runtime').Locale | null }>;
  content: string;
}>): Promise<string | null | undefined> {
  const { outbound, session, content } = input;
  const locale = resolveLocale(session.locale);
  const target = gameTargetFromKey(session.channel_key);
  if (target) {
    if (!outbound.sendTarget) throw new Error('Canonical game delivery requires an exact-target Outbound Host');
    return outbound.sendTarget(target, content, { locale });
  }
  throw new DataMigrationError('unavailable', 'Historical game destination awaits explicit target migration');
}
