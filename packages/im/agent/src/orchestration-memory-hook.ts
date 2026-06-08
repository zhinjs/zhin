/**
 * Optional hook: write orchestration run summary to memory_entries on complete (L4 v1).
 */
import { getMemoryEntryRepository } from './memory-entry-registry.js';
import type { OrchestrationRunWithTasks } from './orchestrator/orchestration-repository.js';

export async function writeOrchestrationRunSummaryToMemory(
  snapshot: OrchestrationRunWithTasks,
): Promise<void> {
  const repo = getMemoryEntryRepository();
  if (!repo) return;

  const completed = snapshot.tasks.filter((t) => t.status === 'completed').length;
  const total = snapshot.tasks.length;
  const summary = `run ${snapshot.run.id} ${snapshot.run.status}: ${completed}/${total} tasks`
    + (snapshot.run.title ? ` — ${snapshot.run.title}` : '');

  await repo.upsert({
    scope: 'global',
    key: `orchestration:run:${snapshot.run.id}`,
    content: summary,
    tags: ['orchestration', snapshot.run.template || 'custom'],
    source: 'hook:orchestration_complete',
    confidence: 0.9,
  });
}
