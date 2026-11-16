/**
 * Engagement collaboration graph for `zhin trace --engagements` (ADR 0048 H5).
 * Moved from `@zhin.js/cli` (`commands/trace.ts`): it reads the project database through the
 * instance's DatabaseHost and the harness journal, both IM-layer code.
 */
import {
  DatabaseEngagementJournal,
  defineEngagementEventMigrationModel,
  defineEngagementEventModel,
  migrateEngagementEventIds,
  reconstructBoardFromEvents,
  summarizeEngagementEvents,
  type EngagementEvent,
  type EngagementJournalDatabase,
  type EngagementSummary,
} from '@zhin.js/harness';
import { retryRelationalOperation, type DatabaseHost } from '@zhin.js/plugin-runtime';
import { createCliProjectDatabaseHost } from './project-database.js';

/**
 * Formats an EngagementSummary (and optional raw events) into an ASCII
 * Collaboration Graph, Blackboard summary, and governance diagnostics (ADR 0048 H5).
 */
export function formatEngagementCollaborationGraph(
  summary: EngagementSummary,
  events?: readonly EngagementEvent[],
): string {
  const lines: string[] = [];
  const durationText = summary.endedAt !== undefined
    ? `${Math.max(0, summary.endedAt - summary.startedAt)}ms`
    : 'open';
  lines.push(`Engagement ${summary.engagementId}  [${summary.status}]`);
  if (summary.initiator) {
    lines.push(`  Initiator: ${summary.initiator.id} (trust: ${summary.initiator.trust})`);
  }
  if (summary.venue) {
    lines.push(`  Venue:     ${summary.venue.kind}:${summary.venue.id}`);
  }
  lines.push(`  Duration:  ${durationText}`);
  lines.push(
    `  Budget:    modelCalls=${summary.consumed.modelCalls}  tokens=${summary.consumed.tokens}  wallMs=${summary.consumed.wallMs}  sideEffects=${summary.consumed.sideEffects}`,
  );
  lines.push(`  Actors:    ${summary.actors.length > 0 ? summary.actors.join(', ') : '(none)'}`);
  if (summary.reason) {
    lines.push(`  Reason:    ${summary.reason}`);
  }

  lines.push('');
  lines.push(`Collaboration Hop Graph (${summary.hops.length} hops, ${summary.mailCount} mails):`);
  if (summary.hops.length === 0) {
    lines.push('  (no mail hops)');
  } else {
    for (const hop of summary.hops) {
      const cause = hop.causationId ? `, cause=${hop.causationId}` : '';
      lines.push(`  ${hop.from} ──[${hop.kind}]──► ${hop.to}  (${hop.status}, id=${hop.mailId}${cause})`);
    }
  }

  lines.push('');
  lines.push(`Blackboard (${summary.boardEntries.length} entries):`);
  if (summary.boardEntries.length === 0) {
    lines.push('  (empty)');
  } else {
    for (const entry of summary.boardEntries) {
      const preview = entry.content.length > 80 ? `${entry.content.slice(0, 77)}...` : entry.content;
      const statusSuffix = entry.status ? `, status=${entry.status}` : '';
      lines.push(
        `  [${entry.kind}] ${entry.key} = ${preview}  (by ${entry.author || 'unknown'}, v${entry.version}${statusSuffix})`,
      );
    }
  }

  lines.push('');
  lines.push(`Diagnostics (tools=${summary.toolCallCount}, guardBlocks=${summary.guardBlocks.length}, escalations=${summary.escalations.length}, projections=${summary.projections.length}):`);
  if (events && events.length > 0) {
    for (const ev of events) {
      if (ev.type === 'tool_called') {
        const actor = typeof ev.data.actor === 'string' ? ev.data.actor : 'agent';
        const tool = typeof ev.data.tool === 'string' ? ev.data.tool : typeof ev.data.name === 'string' ? ev.data.name : 'tool';
        lines.push(`  [tool] ${actor} -> ${tool}`);
      }
    }
  }
  for (const block of summary.guardBlocks) {
    const target = block.to ? ` -> ${block.to}` : '';
    const detail = block.reason.detail ? ` (${block.reason.detail})` : '';
    lines.push(`  [guard_blocked] ${block.from}${target}: ${block.reason.code}${detail}`);
  }
  for (const esc of summary.escalations) {
    lines.push(`  [escalated] ${esc.by}: ${esc.reason}`);
  }
  for (const proj of summary.projections) {
    lines.push(
      `  [venue_projected] ${proj.venue.kind}:${proj.venue.id} by ${proj.actor} [${proj.mode}] (mail=${proj.mailId})`,
    );
  }

  return lines.join('\n');
}

export function formatEngagementList(summaries: readonly EngagementSummary[]): string {
  if (summaries.length === 0) {
    return '没有协作 Engagement 记录。';
  }
  return summaries
    .map((s) => {
      const duration = s.endedAt !== undefined ? `${Math.max(0, s.endedAt - s.startedAt)}ms` : 'open';
      const actors = s.actors.length > 0 ? s.actors.join(',') : '-';
      return `${s.engagementId}  [${s.status}]  ${duration}  actors=${actors}  hops=${s.hops.length}  tools=${s.toolCallCount}  tokens=${s.consumed.tokens}`;
    })
    .join('\n');
}

export function describeEngagement(
  engagementId: string,
  events: readonly EngagementEvent[],
): { readonly summary: EngagementSummary; readonly board: ReturnType<typeof reconstructBoardFromEvents> } {
  return { summary: summarizeEngagementEvents(engagementId, events), board: reconstructBoardFromEvents(events) };
}

/** The journal's table operations over a started DatabaseHost's models (as the Agent Host wires them). */
function hostEngagementJournalDatabase(database: Pick<DatabaseHost, 'models'>): EngagementJournalDatabase {
  const model = (table: string) => {
    const found = database.models.get(table);
    if (!found) throw new Error(`Database table '${table}' is not ready`);
    return found;
  };
  return {
    select: (table, fields) => model(table).select(...fields),
    insert: (table, row) => model(table).insert(row),
    delete: (table, condition) => model(table).delete().where(condition),
  };
}

export async function openProjectEngagementJournal(root: string): Promise<{
  readonly journal: DatabaseEngagementJournal;
  close(): Promise<void>;
} | null> {
  let dbHost: Awaited<ReturnType<typeof createCliProjectDatabaseHost>>;
  try {
    dbHost = await createCliProjectDatabaseHost(root);
  } catch {
    return null;
  }
  if (!['sqlite', 'mysql', 'pg'].includes(dbHost.dialect)) {
    return null;
  }
  try {
    defineEngagementEventModel(dbHost);
    defineEngagementEventMigrationModel(dbHost);
    await dbHost.start();
  } catch {
    await dbHost.stop().catch(() => undefined);
    return null;
  }
  // #1250 b35: a project whose instance has not started since the upgrade still holds
  // engagements merged under pre-b35 counter ids; split them (once) before reading.
  await retryRelationalOperation(() => migrateEngagementEventIds(dbHost)).catch(() => undefined);
  // The journal speaks to tables, the Host exposes models (#1250 trace-engagements-crash:
  // passing the Host itself failed with `this[#db].select is not a function`).
  const journal = new DatabaseEngagementJournal(hostEngagementJournalDatabase(dbHost));
  return {
    journal,
    close: () => dbHost.stop(),
  };
}
