/**
 * Engagement collaboration graph for `zhin trace --engagements` (ADR 0048 H5).
 * Moved from `@zhin.js/cli` (`commands/trace.ts`): it reads the project database through the
 * instance's DatabaseHost and the harness journal, both IM-layer code.
 */
import {
  DatabaseEngagementJournal,
  defineEngagementEventModel,
  reconstructBoardFromEvents,
  summarizeEngagementEvents,
  type EngagementEvent,
  type EngagementJournalDatabase,
  type EngagementSummary,
} from '@zhin.js/harness';
import { createConfigDocument } from '@zhin.js/runtime';
import { DEFAULT_ROOT_CONFIG_FILE_NAME } from '@zhin.js/plugin-runtime';
import { createDatabaseHost, resolveDatabaseConfig } from '@zhin.js/core/runtime';
import { findConfigFile } from '@zhin.js/gateway/project';

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

export async function openProjectEngagementJournal(root: string): Promise<{
  readonly journal: DatabaseEngagementJournal;
  close(): Promise<void>;
} | null> {
  try {
    const selected = findConfigFile(root);
    const file = selected ? `${root}/${selected}` : `${root}/${DEFAULT_ROOT_CONFIG_FILE_NAME}`;
    let rawDoc: Record<string, unknown> = {};
    try {
      const doc = createConfigDocument(file);
      rawDoc = ((await doc.read()).document ?? {}) as Record<string, unknown>;
    } catch {
      rawDoc = {};
    }
    const dbConfig = await resolveDatabaseConfig(root, rawDoc);
    const dbHost = createDatabaseHost(dbConfig);
    if (!['sqlite', 'mysql', 'pg'].includes(dbHost.dialect)) {
      return null;
    }
    defineEngagementEventModel(dbHost);
    await dbHost.start();
    const journal = new DatabaseEngagementJournal(dbHost as unknown as EngagementJournalDatabase);
    return {
      journal,
      close: () => dbHost.stop(),
    };
  } catch {
    return null;
  }
}
