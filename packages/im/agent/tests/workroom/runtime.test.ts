import { describe, expect, it, vi } from 'vitest';
import {
  createCatalogGovernedWorkroomProjectionAuthority,
  createCatalogGovernedConsoleDisclosureAuthority,
  createWorkroomRuntime,
} from '../../src/workroom/runtime.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';
import { digestWorkroomCatalogProjectBinding } from '../../src/workroom/catalog-definition.js';
import {
  MemoryWorkroomJournal,
  MemoryWorkroomJournalPayloadPort,
  type WorkroomJournalPayloadReadInput,
} from '../../src/workroom/journal.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';

const SECRET_TITLE = 'customer password reset for alice@example.test';
const SECRET_REASON = 'credential=super-secret';
const SECRET_PROGRESS = 'copied private customer transcript';

class ReadSpyPayloads extends MemoryWorkroomJournalPayloadPort {
  readCount = 0;

  override async read(input: WorkroomJournalPayloadReadInput): Promise<unknown> {
    this.readCount += 1;
    return await super.read(input);
  }
}

describe('Workroom Console runtime projection', () => {
  it('returns content-free headers only after exact principal authorization', async () => {
    const authorize = vi.fn(async () => ({
      catalogRevision: digest({ catalog: 1 }),
      projectDigest: digest({ project: 1 }),
      governanceDigest: digest({ governance: 1 }),
      bindingDigest: digest({ binding: 1 }),
    }));
    const payloads = new ReadSpyPayloads();
    const journal = new MemoryWorkroomJournal(payloads);
    const kernel = new WorkroomKernel({ journal, now: () => 50, createId: (() => {
      let id = 0; return () => `event-${++id}`;
    })() });
    await kernel.createRun({ projectId: 'support', runId: 'run-1', title: SECRET_TITLE });
    await kernel.execute('support', 'run-1', {
      type: 'plan_task', taskKey: 'triage', title: SECRET_TITLE, required: true, maxAttempts: 3,
    });
    await journal.append('run-1', 1, [{
      eventId: 'event-blocked', occurredAt: 51, type: 'task.blocked', payload: {
        taskKey: 'triage', blockerId: 'blocker-1', kind: 'external',
        owner: 'human:alice', reason: SECRET_REASON, deadline: 80,
      },
    }, {
      eventId: 'event-resolved', occurredAt: 52, type: 'task.blocker_resolved',
      payload: { taskKey: 'triage', blockerId: 'blocker-1' },
    }, {
      eventId: 'event-claimed', occurredAt: 53, type: 'assignment.claimed', payload: {
        taskKey: 'triage', assignmentId: 'assignment-1', owner: 'agent:private-support-worker',
        role: 'executor', taskRevision: 1, attempt: 1, assignmentRevision: 3, fence: 4,
        envelopeDigest: digest({ envelope: 1 }), leaseExpiresAt: 70,
      },
    }, {
      eventId: 'event-started', occurredAt: 54, type: 'assignment.started',
      payload: { assignmentId: 'assignment-1' },
    }]);
    payloads.readCount = 0;
    const runtime = createWorkroomRuntime(journal, { authorize });

    const listed = await runtime.listRuns({
      projectId: 'support', authenticatedPrincipal: { principalId: 'human:alice' },
    });
    expect(listed.status).toBe('ready');
    expect(authorize).toHaveBeenCalledWith({
      destination: 'console', projectId: 'support', recipientPrincipalId: 'human:alice',
      requestedMode: 'metadata_only',
    });
    const detail = await runtime.getRun({
      projectId: 'support', runId: 'run-1',
      authenticatedPrincipal: { principalId: 'human:alice' },
    });
    expect(detail.status).toBe('ready');
    const encoded = JSON.stringify({ listed, detail });
    expect(encoded).not.toContain(SECRET_TITLE);
    expect(encoded).not.toContain(SECRET_REASON);
    expect(encoded).not.toContain(SECRET_PROGRESS);
    expect(encoded).not.toContain('private-support-worker');
    expect(encoded).not.toContain('title');
    expect(encoded).not.toContain('reason');
    expect(encoded).not.toContain('progress');
    expect(detail).toMatchObject({
      status: 'ready',
      run: {
        projectId: 'support', runId: 'run-1', status: 'active', sequence: 5,
        counts: { tasks: 1, assignments: 1, reviewerAssignments: 0, sponsorGates: 0 },
      },
    });
    expect(payloads.readCount).toBe(0);
  });

  it('diagnoses active blockers from content-free stored headers without materializing reasons', async () => {
    const payloads = new ReadSpyPayloads();
    const journal = new MemoryWorkroomJournal(payloads);
    const kernel = new WorkroomKernel({ journal, now: () => 50, createId: (() => {
      let id = 0; return () => `event-${++id}`;
    })() });
    await kernel.createRun({ projectId: 'support', runId: 'run-blocked', title: SECRET_TITLE });
    await kernel.execute('support', 'run-blocked', {
      type: 'plan_task', taskKey: 'triage', title: SECRET_TITLE, required: true, maxAttempts: 3,
    });
    await journal.append('run-blocked', 1, [{
      eventId: 'event-blocked', occurredAt: 51, type: 'task.blocked', payload: {
        taskKey: 'triage', blockerId: 'blocker-1', kind: 'external',
        owner: 'human:alice', reason: SECRET_REASON, deadline: 80,
        allowedActions: ['replan', 'cancel'],
      },
    }]);
    payloads.readCount = 0;
    const runtime = createWorkroomRuntime(journal, {
      authorize: async () => ({
        catalogRevision: digest({ catalog: 1 }), projectDigest: digest({ project: 1 }),
        governanceDigest: digest({ governance: 1 }), bindingDigest: digest({ binding: 1 }),
      }),
    });

    const result = await runtime.getReadiness({
      projectId: 'support', runId: 'run-blocked',
      authenticatedPrincipal: { principalId: 'human:alice' },
    });

    expect(result).toMatchObject({
      status: 'ready',
      readiness: {
        projectId: 'support', runId: 'run-blocked', sequence: 2, state: 'blocked',
        recommendedActions: ['resolve', 'replan', 'cancel'],
        blockers: [{
          kind: 'external', deadline: 80, allowedActions: ['resolve', 'replan', 'cancel'],
        }],
      },
    });
    const encoded = JSON.stringify(result);
    expect(encoded).not.toContain(SECRET_TITLE);
    expect(encoded).not.toContain(SECRET_REASON);
    expect(encoded).not.toContain('human:alice');
    expect(payloads.readCount).toBe(0);
  });

  it('fails closed before reading stored headers when Project/recipient authority is absent', async () => {
    const store = {
      scanStoredHeaders: vi.fn(async () => []),
      readStoredHeaders: vi.fn(async () => null),
    };
    const runtime = createWorkroomRuntime(store, {
      authorize: async input => input.projectId === 'support'
        && input.recipientPrincipalId === 'human:alice'
        ? {
            catalogRevision: digest({ catalog: 1 }), projectDigest: digest({ support: 1 }),
            governanceDigest: digest({ governance: 1 }), bindingDigest: digest({ binding: 1 }),
          }
        : null,
    });

    await expect(runtime.listRuns({
      projectId: 'finance', authenticatedPrincipal: { principalId: 'human:alice' },
    })).resolves.toEqual({ status: 'forbidden' });
    await expect(runtime.getRun({
      projectId: 'support', runId: 'run-1',
      authenticatedPrincipal: { principalId: 'human:mallory' },
    })).resolves.toEqual({ status: 'forbidden' });
    expect(store.scanStoredHeaders).not.toHaveBeenCalled();
    expect(store.readStoredHeaders).not.toHaveBeenCalled();
  });

  it('binds Console reads to current Catalog Sponsor and exact P12 console recipient authority', async () => {
    const project = {
      name: 'Support', members: [{ agent: 'support-worker', role: 'executor' as const }],
      sponsors: ['human:alice'],
    };
    const catalogRevision = digest({ definitions: { support: project } });
    const projectDigest = digestWorkroomCatalogProjectBinding(project);
    const recipientDigest = digest({ recipient: 'human:alice', projectId: 'support' });
    const governanceDigest = digest({ governance: 'support-v1' });
    const authority = createCatalogGovernedWorkroomProjectionAuthority({
      catalog: { read: async () => ({ definitions: { support: project }, revision: catalogRevision }) },
      governance: {
        readProject: async projectId => projectId === 'support' ? ({
          projectId: 'support', digest: governanceDigest,
          governanceDecision: { catalogRevision, catalogBindingDigest: projectDigest },
          policy: {
            destinations: {
              console: { recipientSnapshotRevision: 1, recipientSnapshotDigest: recipientDigest },
            },
          },
          sinks: {
            status: {
              channel: 'console', destinationId: 'console', purpose: 'orchestration',
              requestedMode: 'metadata_only',
              principal: { allowedPurposes: ['orchestration'] },
              recipients: {
                revision: 1, digest: recipientDigest,
                recipients: [{
                  principalId: 'human:alice', tenantId: 'tenant-1', projectId: 'support',
                  clearance: 'project_internal',
                }],
              },
            },
          },
        } as never) : undefined,
      },
    });

    await expect(authority.authorize({
      destination: 'console', projectId: 'support', recipientPrincipalId: 'human:alice',
      requestedMode: 'metadata_only',
    })).resolves.toMatchObject({ catalogRevision, projectDigest, governanceDigest });
    await expect(authority.authorize({
      destination: 'console', projectId: 'support', recipientPrincipalId: 'human:mallory',
      requestedMode: 'metadata_only',
    })).resolves.toBeNull();
    await expect(authority.authorize({
      destination: 'console', projectId: 'finance', recipientPrincipalId: 'human:alice',
      requestedMode: 'metadata_only',
    })).resolves.toBeNull();

    const roleGovernedAuthority = createCatalogGovernedConsoleDisclosureAuthority({
      catalog: { read: async () => ({ definitions: { support: project }, revision: catalogRevision }) },
      governance: {
        readProject: async () => ({
          projectId: 'support', digest: governanceDigest,
          governanceDecision: { catalogRevision, catalogBindingDigest: projectDigest },
          policy: { destinations: { console: {
            recipientSnapshotRevision: 1, recipientSnapshotDigest: recipientDigest,
          } } },
          sinks: { status: {
            channel: 'console', destinationId: 'console', purpose: 'orchestration',
            requestedMode: 'metadata_only', principal: { allowedPurposes: ['orchestration'] },
            recipients: { revision: 1, digest: recipientDigest, recipients: [{
              principalId: 'human:privacy', tenantId: 'tenant-1', projectId: 'support',
              clearance: 'project_internal',
            }] },
          } },
        } as never),
      },
    });
    await expect(roleGovernedAuthority.authorize({
      destination: 'console', projectId: 'support', recipientPrincipalId: 'human:privacy',
      requestedMode: 'metadata_only',
    })).resolves.toMatchObject({ catalogRevision, projectDigest, governanceDigest });
  });
});
