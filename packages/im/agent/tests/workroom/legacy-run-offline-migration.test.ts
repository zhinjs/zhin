import {
  buildLegacyRunOfflineReport,
  createLegacyRunMigrationProposal,
} from '../../src/workroom/legacy-run-offline-migration.js';

describe('Legacy Run offline migration', () => {
  it('audits repository table exports without promoting completed output to accepted state', () => {
    const report = buildLegacyRunOfflineReport(repositoryExport());

    expect(report.sourceFormat).toBe('orchestration_repository_tables_v1');
    expect(report.runs).toHaveLength(2);
    expect(report.runs[0]).toMatchObject({
      legacyRunId: 'run-active',
      legacyStatus: 'running',
      migrationStatus: 'migration_required',
      accepted: false,
      allowedActions: ['export', 'cancel_proposal', 'replan_proposal'],
      importCandidates: {
        inbox: {
          trust: 'untrusted',
          provenance: { kind: 'legacy_import', sourceFormat: 'orchestration_repository_tables_v1' },
        },
      },
    });
    expect(report.runs[1]).toMatchObject({
      legacyRunId: 'run-completed',
      legacyStatus: 'completed',
      migrationStatus: 'historical_only',
      accepted: false,
      allowedActions: ['export'],
      importCandidates: {
        evidence: [{
          trust: 'untrusted',
          taskId: 'task-completed',
          legacyStatus: 'completed',
          summary: 'old done is not accepted',
        }],
      },
    });
    expect(report.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('recognizes the old mapped RunSnapshot export as a separate read-only format', () => {
    const report = buildLegacyRunOfflineReport({
      run: {
        id: 'snapshot-1', sessionKey: 'session:1', status: 'waiting', title: 'Snapshot',
        createdAt: 1, updatedAt: 2,
      },
      tasks: [{
        id: 'snapshot-task', runId: 'snapshot-1', name: 'work', description: '',
        role: 'worker', goal: 'work', status: 'waiting_result', dependsOn: [],
        executorKind: 'remote_mesh', createdAt: 1, updatedAt: 2,
      }],
      events: [{
        id: 'event-1', runId: 'snapshot-1', type: 'run.started', seq: 0,
        payload: {}, createdAt: 1,
      }],
    });

    expect(report.sourceFormat).toBe('orchestration_run_snapshot_v1');
    expect(report.runs[0]).toMatchObject({
      legacyRunId: 'snapshot-1', migrationStatus: 'migration_required', accepted: false,
    });
  });

  it('creates proposal-only cancel/replan records for active Runs', () => {
    const report = buildLegacyRunOfflineReport(repositoryExport());
    const replan = createLegacyRunMigrationProposal(report, {
      legacyRunId: 'run-active',
      action: 'replan',
      targetProjectId: 'project-1',
    });
    const cancel = createLegacyRunMigrationProposal(report, {
      legacyRunId: 'run-active',
      action: 'cancel',
    });

    expect(replan).toMatchObject({
      kind: 'legacy_run_migration_proposal',
      action: 'replan',
      authority: 'proposal_only',
      targetProjectId: 'project-1',
      requiresExplicitNewKernelAdmission: true,
      writesNewJournal: false,
      candidates: {
        inbox: { trust: 'untrusted', provenance: { kind: 'legacy_import' } },
      },
    });
    expect(cancel).toMatchObject({
      action: 'cancel', authority: 'proposal_only', writesNewJournal: false,
    });
    expect(() => createLegacyRunMigrationProposal(report, {
      legacyRunId: 'run-completed', action: 'replan', targetProjectId: 'project-1',
    })).toThrow('not migration_required');
  });

  it.each([
    ['unknown export shape', { runs: [], tasks: [], events: [] }],
    ['unknown Run status', {
      ...repositoryExport(),
      orchestration_runs: [{ ...repositoryExport().orchestration_runs[0], status: 'accepted' }],
    }],
    ['unknown state schema version', {
      ...repositoryExport(),
      orchestration_runs: [{ ...repositoryExport().orchestration_runs[0], state_version: 2 }],
    }],
    ['corrupt JSON column', {
      ...repositoryExport(),
      orchestration_tasks: [{ ...repositoryExport().orchestration_tasks[0], depends_on: 'not-json' }],
    }],
    ['orphan Task', {
      ...repositoryExport(),
      orchestration_tasks: [{ ...repositoryExport().orchestration_tasks[0], run_id: 'missing' }],
    }],
    ['event sequence gap', {
      ...repositoryExport(),
      orchestration_events: [{ ...repositoryExport().orchestration_events[0], seq: 2 }],
    }],
  ])('fails closed on %s', (_label, input) => {
    expect(() => buildLegacyRunOfflineReport(input)).toThrow(/legacy|unknown|invalid|orphan|sequence/iu);
  });
});

function repositoryExport() {
  return {
    orchestration_runs: [
      runRow('run-active', 'running', 'Active legacy Run'),
      runRow('run-completed', 'completed', 'Completed legacy Run'),
    ],
    orchestration_tasks: [
      taskRow('task-active', 'run-active', 'running', ''),
      taskRow('task-completed', 'run-completed', 'completed', 'old done is not accepted'),
    ],
    orchestration_events: [
      eventRow('event-active', 'run-active', 'task-active'),
      eventRow('event-completed', 'run-completed', 'task-completed'),
    ],
  };
}

function runRow(id: string, status: string, title: string) {
  return {
    id, session_key: `session:${id}`, status, title, template: 'legacy',
    source_json: JSON.stringify({ kind: 'manual', label: 'offline fixture' }),
    state_json: '{}', state_version: 0, created_at: 1, updated_at: 2,
  };
}

function taskRow(id: string, runId: string, status: string, resultSummary: string) {
  return {
    id, run_id: runId, name: id, description: '', role: 'worker', goal: id,
    status, depends_on: '[]', executor_kind: 'local', assigned_to: '',
    remote_agent_id: '', remote_task_id: '', priority: 'medium', context_json: '{}',
    is_writer: 0, phase: '', result_summary: resultSummary, error: '',
    created_at: 1, updated_at: 2, started_at: 1, finished_at: status === 'completed' ? 2 : null,
  };
}

function eventRow(id: string, runId: string, taskId: string) {
  return {
    id, run_id: runId, task_id: taskId, type: 'run.started', seq: 0,
    payload_json: '{}', created_at: 1,
  };
}
