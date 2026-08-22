import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  executeLegacyRunsOfflineCommand,
} from '../src/commands/agent-legacy-runs.js';

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('zhin agent legacy-runs', () => {
  it('writes a typed offline audit report without creating runtime state', async () => {
    const root = await workspace();
    const input = join(root, 'legacy.json');
    const output = join(root, 'audit.json');
    await writeFile(input, JSON.stringify(repositoryExport()), 'utf8');

    const value = await executeLegacyRunsOfflineCommand({ input, output });
    const persisted = JSON.parse(await readFile(output, 'utf8'));

    expect(value).toMatchObject({
      kind: 'legacy_run_offline_audit', readOnly: true, startsAgent: false,
      writesNewJournal: false,
    });
    expect(persisted).toEqual(value);
    expect(await readdir(root)).toEqual(['audit.json', 'legacy.json']);
  }, 30_000);

  it('emits only an explicit proposal record for active Run replan', async () => {
    const root = await workspace();
    const input = join(root, 'legacy.json');
    const output = join(root, 'proposal.json');
    await writeFile(input, JSON.stringify(repositoryExport()), 'utf8');

    const value = await executeLegacyRunsOfflineCommand({
      input,
      output,
      runId: 'run-active',
      proposal: 'replan',
      projectId: 'project-1',
    });

    expect(value).toMatchObject({
      kind: 'legacy_run_migration_proposal',
      action: 'replan',
      authority: 'proposal_only',
      targetProjectId: 'project-1',
      writesNewJournal: false,
      requiresExplicitNewKernelAdmission: true,
      candidates: { inbox: { trust: 'untrusted', provenance: { kind: 'legacy_import' } } },
    });
  });

  it('fails before output on ambiguous or destructive CLI options', async () => {
    const root = await workspace();
    const input = join(root, 'legacy.json');
    await writeFile(input, JSON.stringify(repositoryExport()), 'utf8');

    await expect(executeLegacyRunsOfflineCommand({
      input, runId: 'run-active', proposal: 'replan',
    })).rejects.toThrow('target Project');
    await expect(executeLegacyRunsOfflineCommand({
      input, output: input,
    })).rejects.toThrow('must not overwrite');
    await expect(executeLegacyRunsOfflineCommand({
      input, proposal: 'cancel',
    })).rejects.toThrow('requires --run');
    expect(await readdir(root)).toEqual(['legacy.json']);
  });

  it('fails closed on invalid JSON before producing an audit', async () => {
    const root = await workspace();
    const input = join(root, 'corrupt.json');
    const output = join(root, 'must-not-exist.json');
    await writeFile(input, '{not-json', 'utf8');

    await expect(executeLegacyRunsOfflineCommand({ input, output }))
      .rejects.toThrow('valid JSON');
    expect(await readdir(root)).toEqual(['corrupt.json']);
  });
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-legacy-runs-'));
  roots.push(root);
  return root;
}

function repositoryExport() {
  return {
    orchestration_runs: [{
      id: 'run-active', session_key: 'session:1', status: 'running', title: 'Legacy',
      template: '', source_json: '', state_json: '{}', state_version: 0,
      created_at: 1, updated_at: 2,
    }],
    orchestration_tasks: [],
    orchestration_events: [{
      id: 'event-1', run_id: 'run-active', task_id: '', type: 'run.started', seq: 0,
      payload_json: '{}', created_at: 1,
    }],
  };
}
