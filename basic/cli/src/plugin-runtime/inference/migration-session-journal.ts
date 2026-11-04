import { providerPlanFingerprint, type JsonObject } from '@zhin.js/ai/provider';
import { rootPluginId, type PersistentStatePort } from '@zhin.js/plugin-runtime';

export interface MigrationSessionJournal {
  readonly sourceId: string;
  readonly key: string;
  readonly sourceRevision: string;
  readonly before: JsonObject;
  readonly after: JsonObject;
  status: 'prepared' | 'unknown' | 'conflict' | 'committed';
}
export interface ApplyMigrationSessionsOptions {
  readonly state: PersistentStatePort;
  readonly sessions: readonly MigrationSessionJournal[];
  /** A migration intent is durable before its CAS; this is recovery control, not optional telemetry. */
  readonly checkpoint: () => Promise<void>;
}
/** Shared by automatic import and explicit existing-Profile binding. Never replays an unknown CAS. */
export async function applyMigrationSessionJournal(
  options: ApplyMigrationSessionsOptions
): Promise<'committed' | 'unknown' | 'conflict'> {
  for (const session of options.sessions) {
    const current = await options.state.read(rootPluginId(), { kind: 'plugin' }, session.key);
    if (
      current?.expiresAt === null &&
      providerPlanFingerprint(current.value) === providerPlanFingerprint(session.after)
    ) {
      session.status = 'committed';
      await options.checkpoint();
      continue;
    }
    if (session.status === 'unknown') return 'unknown';
    if (
      session.status === 'conflict' ||
      !current ||
      current.expiresAt !== null ||
      current.revision !== session.sourceRevision ||
      providerPlanFingerprint(current.value) !== providerPlanFingerprint(session.before)
    ) {
      session.status = 'conflict';
      await options.checkpoint();
      return 'conflict';
    }
    session.status = 'unknown';
    await options.checkpoint();
    let written: boolean;
    try {
      written = await options.state.compareExchange(
        rootPluginId(),
        { kind: 'plugin' },
        session.key,
        session.sourceRevision,
        session.after,
        null
      );
    } catch {
      return 'unknown';
    }
    if (!written) {
      session.status = 'conflict';
      await options.checkpoint();
      return 'conflict';
    }
    session.status = 'committed';
    await options.checkpoint();
  }
  return 'committed';
}
