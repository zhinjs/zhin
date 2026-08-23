import { describe, expect, it, vi } from 'vitest';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';
import { MemoryWorkroomJournal } from '../../src/workroom/journal.js';
import {
  WorkroomRunControlUnauthorizedError,
  createCatalogWorkroomRunControlAuthority,
  workroomRunControlRequestDigest,
} from '../../src/workroom/workroom-run-control.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';

describe('Workroom typed Run control', () => {
  it('derives standard mutation authority only from the current enabled Catalog Sponsor set', async () => {
    const definition = {
      name: 'Support', enabled: true,
      members: [{ agent: 'support-worker', role: 'executor' as const }],
      sponsors: ['human:alice'],
    };
    const catalogRevision = digest({ catalog: 1 });
    const authority = createCatalogWorkroomRunControlAuthority({
      read: async () => ({ definitions: { support: definition }, revision: catalogRevision }),
    });
    const command = {
      version: 1 as const, operationId: 'replan-1', projectId: 'support', runId: 'run-1',
      expectedSequence: 4, action: 'request_replan' as const,
      reasonCode: 'requirements_changed' as const,
    };
    const input = {
      version: 1 as const,
      purpose: 'commit' as const,
      command,
      authenticatedPrincipalId: 'human:alice',
      requestDigest: workroomRunControlRequestDigest(command, 'human:alice'),
      stateSequence: 4,
      stateStatus: 'active' as const,
      stateDigest: digest({ state: 4 }),
    };

    await expect(authority.authorize(input)).resolves.toMatchObject({
      authorized: true, principalId: 'human:alice', catalogRevision,
      projectDigest: digest(definition),
    });
    await expect(authority.authorize({
      ...input, authenticatedPrincipalId: 'human:mallory',
      requestDigest: workroomRunControlRequestDigest(command, 'human:mallory'),
    })).resolves.toEqual({ authorized: false, reason: 'principal_is_not_project_sponsor' });
  });

  it('commits an authorized cancellation with exact sequence and an auditable closed reason code', async () => {
    const journal = new MemoryWorkroomJournal();
    const authorize = vi.fn(async (input) => ({
      authorized: true as const,
      principalId: input.authenticatedPrincipalId,
      catalogRevision: digest({ catalog: 1 }),
      projectDigest: digest({ project: 'support' }),
      authorizationRef: 'catalog:support:sponsor:alice',
    }));
    const kernel = new WorkroomKernel({
      journal, now: () => 100, createId: (() => { let id = 0; return () => `event-${++id}`; })(),
      runControlAuthority: { authorize },
    });
    await kernel.createRun({ projectId: 'support', runId: 'run-1', title: 'private title' });
    await kernel.execute('support', 'run-1', {
      type: 'plan_task', taskKey: 'triage', title: 'private task', required: true, maxAttempts: 2,
    });

    const receipt = await kernel.controlRun({
      version: 1,
      operationId: 'cancel-operation-1',
      projectId: 'support',
      runId: 'run-1',
      expectedSequence: 1,
      action: 'cancel',
      reasonCode: 'operator_request',
      controlDeadline: 130,
    }, { principalId: 'human:alice' });

    expect(receipt).toMatchObject({ status: 'committed', action: 'cancel' });
    expect(receipt.state).toMatchObject({ status: 'cancelled', cancelRequested: true });
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      version: 1,
      authenticatedPrincipalId: 'human:alice',
      stateSequence: 1,
      stateStatus: 'active',
    }));
    const events = await journal.read('run-1');
    expect(events.map(event => event.type)).toEqual([
      'run.created', 'task.planned', 'run.control_decided',
      'run.cancel_requested', 'task.cancel_requested', 'task.cancelled', 'run.cancelled',
    ]);
    expect(events[2]?.payload).toMatchObject({
      action: 'cancel', reasonCode: 'operator_request', principalId: 'human:alice',
    });

    await expect(kernel.controlRun({
      version: 1, operationId: 'cancel-operation-2', projectId: 'support', runId: 'run-1',
      expectedSequence: 6, action: 'cancel', reasonCode: 'operator_request', controlDeadline: 140,
    }, { principalId: 'human:alice' })).rejects.toThrow('cancellation is already active');
    expect(await journal.read('run-1')).toHaveLength(7);
  });

  it('records an authorized replan request, pauses scheduling, and replays the same operation idempotently', async () => {
    const journal = new MemoryWorkroomJournal();
    const kernel = new WorkroomKernel({
      journal, now: () => 100, createId: (() => { let id = 0; return () => `event-${++id}`; })(),
      runControlAuthority: { authorize: async input => ({
        authorized: true,
        principalId: input.authenticatedPrincipalId,
        catalogRevision: digest({ catalog: 1 }),
        projectDigest: digest({ project: 'support' }),
        authorizationRef: 'catalog:support:sponsor:alice',
      }) },
    });
    await kernel.createRun({ projectId: 'support', runId: 'run-1', title: 'private title' });
    const command = {
      version: 1 as const,
      operationId: 'replan-operation-1',
      projectId: 'support',
      runId: 'run-1',
      expectedSequence: 0,
      action: 'request_replan' as const,
      reasonCode: 'requirements_changed' as const,
    };

    const committed = await kernel.controlRun(command, { principalId: 'human:alice' });
    const duplicate = await kernel.controlRun(command, { principalId: 'human:alice' });

    expect(committed).toMatchObject({
      status: 'committed', action: 'request_replan', state: { status: 'needs_replan' },
    });
    expect(duplicate).toMatchObject({
      status: 'duplicate', action: 'request_replan', state: { status: 'needs_replan' },
    });
    expect((await journal.read('run-1')).map(event => event.type)).toEqual([
      'run.created', 'run.control_decided', 'run.replan_requested',
    ]);
  });

  it('fails closed with zero writes for a stale sequence or denied Sponsor authority', async () => {
    const journal = new MemoryWorkroomJournal();
    const authorize = vi.fn(async input => input.authenticatedPrincipalId === 'human:alice'
      ? {
          authorized: true as const,
          principalId: input.authenticatedPrincipalId,
          catalogRevision: digest({ catalog: 1 }),
          projectDigest: digest({ project: 'support' }),
          authorizationRef: 'catalog:support:sponsor:alice',
        }
      : { authorized: false as const, reason: 'not_project_sponsor' });
    const kernel = new WorkroomKernel({ journal, runControlAuthority: { authorize } });
    await kernel.createRun({ projectId: 'support', runId: 'run-1', title: 'private title' });

    const stale = await kernel.controlRun({
      version: 1, operationId: 'stale', projectId: 'support', runId: 'run-1',
      expectedSequence: 4, action: 'request_replan', reasonCode: 'requirements_changed',
    }, { principalId: 'human:alice' });
    expect(stale).toEqual({ status: 'stale', actualSequence: 0 });
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'stale_probe', stateSequence: 0, authenticatedPrincipalId: 'human:alice',
    }));

    await expect(kernel.controlRun({
      version: 1, operationId: 'stale-denied', projectId: 'support', runId: 'run-1',
      expectedSequence: 4, action: 'request_replan', reasonCode: 'requirements_changed',
    }, { principalId: 'human:mallory' })).rejects
      .toBeInstanceOf(WorkroomRunControlUnauthorizedError);

    await expect(kernel.controlRun({
      version: 1, operationId: 'denied', projectId: 'support', runId: 'run-1',
      expectedSequence: 0, action: 'cancel', reasonCode: 'operator_request',
      controlDeadline: Number.MAX_SAFE_INTEGER,
    }, { principalId: 'human:mallory' })).rejects.toBeInstanceOf(WorkroomRunControlUnauthorizedError);
    expect((await journal.read('run-1'))).toHaveLength(1);
  });

  it('revalidates current Catalog Sponsor authority before returning a duplicate receipt', async () => {
    const definition = {
      name: 'Support', enabled: true,
      members: [{ agent: 'support-worker', role: 'executor' as const }],
      sponsors: ['human:alice'],
    };
    let enabled = true;
    const journal = new MemoryWorkroomJournal();
    const kernel = new WorkroomKernel({
      journal,
      runControlAuthority: createCatalogWorkroomRunControlAuthority({
        read: async () => ({
          definitions: enabled ? { support: definition } : {},
          revision: digest({ catalog: enabled ? 1 : 2 }),
        }),
      }),
    });
    await kernel.createRun({ projectId: 'support', runId: 'run-1', title: 'private title' });
    const command = {
      version: 1 as const, operationId: 'replan-1', projectId: 'support', runId: 'run-1',
      expectedSequence: 0, action: 'request_replan' as const,
      reasonCode: 'requirements_changed' as const,
    };
    await expect(kernel.controlRun(command, { principalId: 'human:alice' }))
      .resolves.toMatchObject({ status: 'committed' });

    enabled = false;
    await expect(kernel.controlRun(command, { principalId: 'human:alice' }))
      .rejects.toBeInstanceOf(WorkroomRunControlUnauthorizedError);
    expect(await journal.read('run-1')).toHaveLength(3);
  });
});
