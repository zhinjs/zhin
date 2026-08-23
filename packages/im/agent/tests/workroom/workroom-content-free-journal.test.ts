import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  createWorkroomJournalPayloadObjectId,
  DatabaseWorkroomJournal,
  FileWorkroomJournal,
  MemoryWorkroomJournal,
  type WorkroomJournalPayloadPort,
} from '../../src/workroom/journal.js';
import {
  canonicalWorkroomJson,
  digestCanonicalWorkroomValue as digest,
} from '../../src/workroom/canonical-value.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';
import { LegacyEmbeddedPayloadDetectedError } from '../../src/workroom/legacy-embedded-payload-migration.js';
import {
  WorkflowPlanBuilder,
  type WorkflowPlanProposal,
} from '../../src/workroom/workflow-plan-builder.js';
import { createWorkroomSchedulerPolicySnapshot } from '../../src/workroom/workroom-scheduler.js';
import { createWorkflowPlanRevisionCandidate } from '../../src/workroom/plan-revision.js';
import {
  createAssignmentExecutionEnvelope,
  type AssignmentExecutionEnvelope,
} from '../../src/workroom/assignment-executor.js';
import { AssignmentObservationIngress } from '../../src/workroom/assignment-observation-ingress.js';
import type {
  WorkroomAcceptanceContractPinInput,
  WorkroomAcceptanceDecision,
  WorkroomAcceptanceDecisionInput,
} from '../../src/workroom/acceptance-policy.js';

const SHA = `sha256:${'a'.repeat(64)}`;
const CANDIDATE_HASH = `sha256:${'c'.repeat(64)}`;
const REPORT_DIGEST = `sha256:${'d'.repeat(64)}`;

describe('content-free Workroom Journal', () => {
  it('governs model-controlled identifiers at every Journal seam and replays them exactly', async () => {
    const secret = {
      taskKey: 'task-customer-555-0188-credential',
      dependencyKey: 'dependency-customer-555-0188-secret',
      owner: 'owner-customer-555-0188-private',
      sourceEventRef: 'conversation://customer-555-0188/private-credential',
      claimId: 'claim-customer-555-0188-private',
    };
    const exercise = async (
      journal: FileWorkroomJournal | DatabaseWorkroomJournal | MemoryWorkroomJournal,
    ) => {
      const kernel = new WorkroomKernel({
        journal,
        now: () => 100,
        createId: (() => { let id = 0; return () => `model-controlled-${++id}`; })(),
        acceptancePolicy: acceptancePolicy('Private criterion', 'Private acceptance', secret.claimId),
      });
      const plan = planBuilder('plan-model-controlled')
        .addTask(planTask(secret.dependencyKey, 'Private dependency'))
        .addTask(planTask(secret.taskKey, 'Private task', [secret.dependencyKey]))
        .build();
      const admitted = await kernel.admitWorkflowPlan({
        operationId: 'operation-model-controlled',
        projectId: 'project-support',
        title: 'Private run',
        sourceEventRef: secret.sourceEventRef,
        sourceEventDigest: SHA,
        orchestratorAgentDefinitionId: 'orchestrator-support',
        plan,
      });
      await kernel.execute('project-support', admitted.runId, {
        type: 'block_task', taskKey: secret.taskKey, blockerId: 'private-blocker',
        kind: 'human_input', owner: secret.owner, reason: 'Private reason', deadline: 1_000,
      });
      await kernel.pinTaskAcceptance('project-support', admitted.runId, secret.dependencyKey);
      const envelope = await claimAndStart(kernel, admitted.runId, secret.dependencyKey);
      const state = await kernel.read('project-support', admitted.runId);
      await new AssignmentObservationIngress({ kernel }).apply(envelope, {
        version: 1,
        type: 'execution_completed',
        observationId: 'completed-model-controlled',
        envelopeDigest: envelope.digest,
        completion: {
          report: { ref: 'report://content-free', digest: REPORT_DIGEST },
          candidate: { ref: 'candidate://content-free', hash: CANDIDATE_HASH },
        },
      }, state.sequence);
      await kernel.evaluateTaskAcceptance('project-support', admitted.runId, secret.dependencyKey);
      const headers = await journal.readStoredHeaders(admitted.runId);
      expect(JSON.stringify(headers)).not.toContain(secret.taskKey);
      expect(headers?.events.find(event => event.type === 'task.planned')?.control.taskKey)
        .toMatch(/^workroom-task:/u);
      const replayed = await journal.read(admitted.runId);
      expect(replayed.find(event => event.type === 'plan.admitted')?.payload.sourceEventRef)
        .toBe(secret.sourceEventRef);
      expect(replayed.filter(event => event.type === 'task.planned').map(event => event.payload.taskKey))
        .toEqual([secret.dependencyKey, secret.taskKey]);
      expect(replayed.find(event => event.type === 'task.blocked')?.payload.owner).toBe(secret.owner);
      expect((replayed.find(event => event.type === 'task.accepted')?.payload.record as {
        acceptedClaimIds?: readonly string[];
      }).acceptedClaimIds).toEqual([secret.claimId]);
    };

    const memoryPayloads = new TestGovernedJournalPayloadPort();
    const memory = new MemoryWorkroomJournal(memoryPayloads);
    await exercise(memory);
    for (const value of Object.values(secret)) {
      expect(JSON.stringify(memoryPayloads.writtenValues)).toContain(value);
    }

    const fileRoot = await mkdtemp(join(tmpdir(), 'zhin-content-free-identifiers-'));
    const fileDirectory = join(fileRoot, 'journal');
    await mkdir(fileDirectory);
    const filePayloads = new TestGovernedJournalPayloadPort();
    try {
      await exercise(new FileWorkroomJournal(fileDirectory, filePayloads));
      const raw = (await Promise.all((await readdir(fileDirectory))
        .filter(name => name.endsWith('.json'))
        .map(name => readFile(join(fileDirectory, name), 'utf8')))).join('\n');
      for (const value of Object.values(secret)) expect(raw).not.toContain(value);
    } finally {
      await rm(fileRoot, { recursive: true, force: true });
    }

    const rows: Record<string, unknown>[] = [];
    const where = async ({ run_id: runId }: Record<string, unknown>) =>
      runId === undefined ? rows : rows.filter(row => row.run_id === runId);
    const database = {
      transaction: async <T>(operation: (transaction: {
        select(table: string): { where(condition: Record<string, unknown>): Promise<Record<string, unknown>[]> };
        insertMany(table: string, inserted: Record<string, unknown>[]): Promise<void>;
      }) => Promise<T>) => await operation({
        select: () => ({ where }),
        insertMany: async (_table: string, inserted: Record<string, unknown>[]) => { rows.push(...inserted); },
      }),
    };
    await exercise(new DatabaseWorkroomJournal(database, { select: () => ({ where }) },
      new TestGovernedJournalPayloadPort()));
    for (const value of Object.values(secret)) expect(JSON.stringify(rows)).not.toContain(value);
  });

  it('rejects unknown event payload fields instead of guessing whether they contain content', async () => {
    const journal = new FileWorkroomJournal(
      await mkdtemp(join(tmpdir(), 'zhin-content-free-unknown-field-')),
      new TestGovernedJournalPayloadPort(),
    );
    await expect(journal.append('run-unknown-field', -1, [{
      eventId: 'unknown-field-event',
      occurredAt: 100,
      type: 'run.created',
      payload: {
        projectId: 'project-support',
        title: 'Private run',
        futureModelText: 'credential that a field-name blacklist cannot recognize',
      },
    }])).rejects.toThrow('payload keys');
  });

  it('persists only a governed title reference and reauthorizes it after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-content-free-journal-'));
    const directory = join(root, 'journal');
    await mkdir(directory);
    const payloads = new TestGovernedJournalPayloadPort();
    const secretTitle = 'Customer 555-0100 credential investigation';
    try {
      const first = new WorkroomKernel({
        journal: new FileWorkroomJournal(directory, payloads),
        now: () => 100,
        createId: () => 'event-created',
      });
      const created = await first.createRun({
        runId: 'run-content-free',
        projectId: 'project-support',
        title: secretTitle,
      });
      expect(created.title).toBe(secretTitle);

      const [segment] = (await readdir(directory)).filter(name => name.endsWith('.json'));
      const raw = await readFile(join(directory, segment!), 'utf8');
      expect(raw).not.toContain(secretTitle);
      expect(raw).toContain('governed_workroom_journal_payload');
      expect(JSON.parse(raw)).toMatchObject({
        version: 3,
        events: [{ version: 3, type: 'run.created' }],
      });

      const readsBeforeRestart = payloads.readCount;
      const restarted = new WorkroomKernel({
        journal: new FileWorkroomJournal(directory, payloads),
      });
      expect((await restarted.read('project-support', 'run-content-free')).title).toBe(secretTitle);
      expect(payloads.readCount).toBeGreaterThan(readsBeforeRestart);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('replays an early v3 blocker header without requiring newly added readiness fields', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-v3-blocker-compat-'));
    const payloads = new TestGovernedJournalPayloadPort();
    try {
      const kernel = new WorkroomKernel({
        journal: new FileWorkroomJournal(directory, payloads),
        now: () => 100,
        createId: (() => { let id = 0; return () => `event-${++id}`; })(),
      });
      await kernel.createRun({ projectId: 'project-support', runId: 'run-v3', title: 'Run' });
      await kernel.execute('project-support', 'run-v3', {
        type: 'plan_task', taskKey: 'triage', title: 'Task', required: true, maxAttempts: 1,
      });
      await kernel.execute('project-support', 'run-v3', {
        type: 'block_task', taskKey: 'triage', blockerId: 'approval', kind: 'human_input',
        owner: 'sponsor', reason: 'Approval', deadline: 200,
      });
      const filenames = (await readdir(directory)).filter(name => name.endsWith('.json'));
      for (const filename of filenames) {
        const path = join(directory, filename);
        const stored = JSON.parse(await readFile(path, 'utf8')) as {
          version: 3;
          runId: string;
          expectedSequence: number;
          events: Array<{ type: string; control: Record<string, unknown> }>;
          payloadDigest: string;
        };
        const blocked = stored.events.find(event => event.type === 'task.blocked');
        if (!blocked) continue;
        blocked.control = {
          taskKey: blocked.control.taskKey,
          blockerId: blocked.control.blockerId,
        };
        stored.payloadDigest = digest({
          version: stored.version,
          runId: stored.runId,
          expectedSequence: stored.expectedSequence,
          events: stored.events,
        });
        await writeFile(path, canonicalWorkroomJson(stored), 'utf8');
      }

      await expect(new WorkroomKernel({
        journal: new FileWorkroomJournal(directory, payloads),
      }).read('project-support', 'run-v3')).resolves.toMatchObject({
        tasks: { triage: { blockers: [{ kind: 'human_input', deadline: 200 }] } },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('stores content-free database rows and reauthorizes them after restart', async () => {
    const rows: Record<string, unknown>[] = [];
    const where = async ({ run_id: runId }: Record<string, unknown>) =>
      runId === undefined ? rows : rows.filter(row => row.run_id === runId);
    const database = {
      transaction: async <T>(operation: (transaction: {
        select(table: string): { where(condition: Record<string, unknown>): Promise<Record<string, unknown>[]> };
        insertMany(table: string, inserted: Record<string, unknown>[]): Promise<void>;
      }) => Promise<T>) => await operation({
        select: () => ({ where }),
        insertMany: async (_table: string, inserted: Record<string, unknown>[]) => {
          rows.push(...inserted);
        },
      }),
    };
    const model = { select: () => ({ where }) };
    const payloads = new TestGovernedJournalPayloadPort();
    const secretTitle = 'Private investment thesis: credential and MNPI';
    const secretTask = 'Review non-public customer revenue signal';
    const first = new WorkroomKernel({
      journal: new DatabaseWorkroomJournal(database, model, payloads),
      now: () => 100,
      createId: (() => { let id = 0; return () => `db-content-free-${++id}`; })(),
    });
    await first.createRun({
      runId: 'run-db-content-free', projectId: 'project-investment', title: secretTitle,
    });
    await first.execute('project-investment', 'run-db-content-free', {
      type: 'plan_task', taskKey: 'research', title: secretTask, required: true, maxAttempts: 1,
    });

    const raw = JSON.stringify(rows);
    expect(raw).not.toContain(secretTitle);
    expect(raw).not.toContain(secretTask);
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.version === 3)).toBe(true);
    expect(raw).toContain('governed_workroom_journal_payload');

    const readsBeforeRestart = payloads.readCount;
    const restarted = new WorkroomKernel({
      journal: new DatabaseWorkroomJournal(database, model, payloads),
    });
    await expect(restarted.read('project-investment', 'run-db-content-free')).resolves.toMatchObject({
      title: secretTitle,
      tasks: { research: { title: secretTask } },
    });
    expect(payloads.readCount).toBeGreaterThan(readsBeforeRestart);
  });

  it('keeps Plan revision, blocker, progress and Acceptance text out of every durable segment', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-content-free-kernel-'));
    const directory = join(root, 'journal');
    await mkdir(directory);
    const payloads = new TestGovernedJournalPayloadPort();
    const secrets = [
      'Support incident for customer 555-0199',
      'Investigate leaked credential value',
      'Add a human review for account customer-7',
      'Review customer-7 remediation',
      'Waiting for private security approval',
      'Processed customer-7 secret records',
      'No credential remains in the result',
      'All private acceptance checks passed',
    ];
    try {
      let id = 0;
      const journal = new FileWorkroomJournal(directory, payloads);
      const kernel = new WorkroomKernel({
        journal,
        now: () => 100,
        createId: () => `event-${++id}`,
        acceptancePolicy: acceptancePolicy(secrets[6]!, secrets[7]!),
      });
      const plan = planWithTask('build', secrets[1]!);
      const admitted = await kernel.admitWorkflowPlan({
        operationId: 'operation-content-free',
        projectId: 'project-support',
        title: secrets[0]!,
        sourceEventRef: 'conversation://event/1',
        sourceEventDigest: SHA,
        orchestratorAgentDefinitionId: 'orchestrator-support',
        plan,
      });
      const nextPlan = addPlanTask(plan, 'review', secrets[3]!);
      const revision = createWorkflowPlanRevisionCandidate({
        proposalId: 'revision-content-free',
        projectId: 'project-support',
        runId: admitted.runId,
        expectedSequence: admitted.state.sequence,
        basePlanRevision: 1,
        basePlanDigest: plan.digest,
        baseTaskRevisions: { build: 1 },
        provenance: { sourceRef: 'conversation://event/2', sourceDigest: SHA },
        reason: secrets[2]!,
        basePlan: plan,
        nextPlan,
      });
      await kernel.admitPlanRevision(revision);
      await kernel.execute('project-support', admitted.runId, {
        type: 'block_task', taskKey: 'build', blockerId: 'blocker-private',
        kind: 'human_input', owner: 'sponsor-support', reason: secrets[4]!, deadline: 1_000,
      });
      await kernel.execute('project-support', admitted.runId, {
        type: 'resolve_blocker', taskKey: 'build', blockerId: 'blocker-private',
      });
      await kernel.pinTaskAcceptance('project-support', admitted.runId, 'build');
      const envelope = await claimAndStart(kernel, admitted.runId, 'build');
      let state = await kernel.read('project-support', admitted.runId);
      const ingress = new AssignmentObservationIngress({ kernel });
      state = await ingress.apply(envelope, {
        version: 1,
        type: 'progress',
        observationId: 'progress-private',
        envelopeDigest: envelope.digest,
        progress: { summary: secrets[5]!, completedUnits: 1, totalUnits: 2 },
      }, state.sequence);
      state = await ingress.apply(envelope, {
        version: 1,
        type: 'execution_completed',
        observationId: 'completed-private',
        envelopeDigest: envelope.digest,
        completion: {
          report: { ref: 'report://content-free', digest: REPORT_DIGEST },
          candidate: { ref: 'candidate://content-free', hash: CANDIDATE_HASH },
        },
      }, state.sequence);
      await kernel.evaluateTaskAcceptance('project-support', admitted.runId, 'build');

      const raw = (await Promise.all((await readdir(directory))
        .filter(name => name.endsWith('.json'))
        .map(name => readFile(join(directory, name), 'utf8')))).join('\n');
      for (const secret of secrets) expect(raw).not.toContain(secret);
      expect(raw).not.toContain('plan-content-free');
      expect(raw).not.toContain('criterion-build');
      expect(raw).toContain('governed_workroom_journal_payload');

      const readsBeforeRestart = payloads.readCount;
      const restarted = new WorkroomKernel({
        journal: new FileWorkroomJournal(directory, payloads),
      });
      const replayed = await restarted.read('project-support', admitted.runId);
      expect(replayed).toMatchObject({
        title: secrets[0],
        tasks: {
          build: {
            title: secrets[1],
            status: 'accepted',
            acceptanceContract: { criteria: [{ description: secrets[6] }] },
          },
          review: { title: secrets[3], status: 'ready' },
        },
        assignments: {
          'assignment-content-free': {
            latestProgress: { summary: secrets[5], completedUnits: 1, totalUnits: 2 },
          },
        },
      });
      expect(replayed.tasks.build?.acceptanceRecord?.reason).toBe(secrets[7]);
      expect(payloads.readCount).toBeGreaterThan(readsBeforeRestart);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('quarantines legacy plaintext segments with a content-free offline export/purge instruction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-content-free-legacy-'));
    const directory = join(root, 'journal');
    await mkdir(directory);
    const runId = 'run-legacy-plaintext';
    const filename = `${createHash('sha256').update(runId).digest('hex')}.0000000000000000.json`;
    const secret = 'legacy customer password must not enter an error';
    const legacy = {
      version: 1,
      runId,
      expectedSequence: -1,
      events: [{
        version: 1, eventId: 'legacy-created', runId, sequence: 0, occurredAt: 100,
        type: 'run.created', payload: { projectId: 'project-support', title: secret },
      }],
      payloadDigest: SHA,
    };
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(join(directory, filename), JSON.stringify(legacy)));
    try {
      let failure: unknown;
      try {
        await new FileWorkroomJournal(directory, new TestGovernedJournalPayloadPort()).read(runId);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(LegacyEmbeddedPayloadDetectedError);
      expect((failure as Error).message).toContain('offline export/purge');
      expect((failure as Error).message).not.toContain(secret);
      await expect(new WorkroomKernel({
        journal: new FileWorkroomJournal(directory, new TestGovernedJournalPayloadPort()),
      }).createRun({
        runId: 'run-new-writer-must-not-open', projectId: 'project-support', title: 'new title',
      })).rejects.toBeInstanceOf(LegacyEmbeddedPayloadDetectedError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('blocks database writer activation while any legacy Run remains quarantined', async () => {
    const secret = 'legacy database plan title must remain offline';
    const rows: Record<string, unknown>[] = [{
      id: 'run-legacy-db:0', run_id: 'run-legacy-db', sequence: 0, version: 1,
      type: 'run.created', occurred_at: 100,
      payload_json: JSON.stringify({
        eventId: 'legacy-db-created',
        payload: { projectId: 'project-support', title: secret },
      }),
    }];
    let inserts = 0;
    const database = {
      transaction: async <T>(operation: (transaction: {
        select(table: string): { where(condition: Record<string, unknown>): Promise<Record<string, unknown>[]> };
        insertMany(table: string, inserted: Record<string, unknown>[]): Promise<void>;
      }) => Promise<T>) => await operation({
        select: () => ({ where: async () => rows }),
        insertMany: async () => { inserts += 1; },
      }),
    };
    const journal = new DatabaseWorkroomJournal(
      database,
      { select: () => ({ where: async ({ run_id: runId }: Record<string, unknown>) =>
        rows.filter(row => row.run_id === runId) }) },
      new TestGovernedJournalPayloadPort(),
    );
    let failure: unknown;
    try {
      await new WorkroomKernel({ journal }).createRun({
        runId: 'run-new-db', projectId: 'project-support', title: 'new database title',
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(LegacyEmbeddedPayloadDetectedError);
    expect((failure as Error).message).not.toContain(secret);
    expect(inserts).toBe(0);
  });
});

class TestGovernedJournalPayloadPort implements WorkroomJournalPayloadPort {
  readonly #values = new Map<string, unknown>();
  readonly writtenValues: unknown[] = [];
  readCount = 0;

  async write(input: Parameters<WorkroomJournalPayloadPort['write']>[0]) {
    this.writtenValues.push(structuredClone(input.value));
    const payloadHash = digest(input.value);
    const vaultObjectId = `vault:${digest({
      runId: input.runId,
      eventId: input.eventId,
      fieldPath: input.fieldPath,
      payloadHash,
    })}`;
    this.#values.set(vaultObjectId, structuredClone(input.value));
    const descriptor = {
      vaultObjectId,
      objectId: createWorkroomJournalPayloadObjectId(input),
      payloadHash,
      descriptorDigest: digest({ payloadHash, fieldPath: input.fieldPath }),
      locationManifestDigest: digest({ location: vaultObjectId }),
      bytes: Buffer.byteLength(canonicalWorkroomJson(input.value)),
    };
    const source = {
      kind: 'command' as const,
      ref: input.source.ref,
      digest: input.source.digest,
      bindingDigest: input.source.bindingDigest,
      verification: 'verified' as const,
    };
    return Object.freeze({ descriptor: Object.freeze(descriptor), source: Object.freeze(source) });
  }

  async read(input: Parameters<WorkroomJournalPayloadPort['read']>[0]) {
    this.readCount += 1;
    const value = this.#values.get(input.receipt.descriptor.vaultObjectId);
    if (value === undefined) throw new Error('Test governed Journal payload is unavailable');
    return structuredClone(value);
  }
}

function planWithTask(key: string, title: string): WorkflowPlanProposal {
  return planBuilder('plan-content-free').addTask(planTask(key, title)).build();
}

function addPlanTask(plan: WorkflowPlanProposal, key: string, title: string): WorkflowPlanProposal {
  let builder = planBuilder('plan-content-free-revision');
  for (const task of plan.tasks) builder = builder.addTask(task);
  return builder.addTask(planTask(key, title, ['build'])).build();
}

function planBuilder(proposalId: string) {
  return WorkflowPlanBuilder.create({
    proposalId,
    projectId: 'project-support',
    strategy: { id: 'strategy:support', version: '1', digest: SHA },
    parameterDigest: SHA,
    authority: {
      projectRevision: 'project-revision-1', projectDigest: SHA,
      profileRevisionId: 'profile-1', profileDigest: SHA,
      planningPolicyRevisionId: 'planning-policy-1', planningPolicyDigest: SHA,
      orchestratorAgentDefinitionId: 'orchestrator-support', orchestratorAuthorityDigest: SHA,
    },
    budget: { maxTasks: 4, maxTotalAttempts: 4 },
    schedulerPolicy: createWorkroomSchedulerPolicySnapshot({
      policyRef: 'scheduler-policy:1', revision: 1, pinnedAtSequence: 1, capacity: 2,
      agingStepMs: 1_000,
      starvationBoundMs: { urgent: 1_000, high: 2_000, normal: 3_000, low: 4_000 },
      preemptionDeadlineMs: 1_000,
    }),
  });
}

function planTask(key: string, title: string, dependsOn: readonly string[] = []) {
  return {
    key, title, role: 'executor', required: true, maxAttempts: 1, dependsOn,
    requires: {},
    scheduler: {
      sponsorLane: 'normal' as const, localRank: 10, enqueuedAt: 100,
      deadline: 1_000, preemptibility: 'checkpointable' as const,
    },
  };
}

function acceptancePolicy(description: string, decisionReason: string, claimId = 'claim-1') {
  return {
    pinContract(input: WorkroomAcceptanceContractPinInput) {
      return Object.freeze({
        id: `contract:${input.task.key}:${input.task.revision}`,
        revision: input.task.revision,
        digest: `sha256:contract-${input.task.key}-${input.task.revision}`,
        taskKey: input.task.key,
        taskRevision: input.task.revision,
        kind: 'task_result' as const,
        policy: Object.freeze({ id: 'policy-1', revision: 1, digest: 'sha256:policy-1' }),
        criteria: Object.freeze([{
          id: 'criterion-build', kind: 'deterministic' as const, description,
        }]),
        requiredEvidence: Object.freeze(['evidence://1']),
      });
    },
    decide(input: WorkroomAcceptanceDecisionInput): WorkroomAcceptanceDecision {
      return Object.freeze({
        version: 1,
        disposition: 'accepted',
        route: 'auto_accept',
        candidate: Object.freeze({
          id: 'candidate://content-free', taskKey: input.task.key, taskRevision: input.task.revision,
          producerAssignmentId: input.assignment.id, producerPrincipalId: input.assignment.owner,
          reportRef: input.task.reportRef, hash: CANDIDATE_HASH,
          claimIds: Object.freeze([claimId]), evidenceRefs: Object.freeze(['evidence://1']),
        }),
        contract: input.contract,
        riskAssessment: Object.freeze({
          id: 'risk-1', candidateHash: CANDIDATE_HASH, tier: 'low', factsHash: SHA,
          assessor: 'kernel-risk-engine', sourceRefs: Object.freeze(['plan://build']),
        }),
        checkResults: Object.freeze([{
          id: 'check-1', criterionId: 'criterion-build', status: 'passed',
          candidateHash: CANDIDATE_HASH, runner: 'ci', runnerVersion: 'ci@1',
          evidenceRefs: Object.freeze(['evidence://1']),
        }]),
        acceptedClaimIds: Object.freeze([claimId]), rejectedClaimIds: Object.freeze([]),
        decidedBy: 'acceptance-policy:policy-1', reason: decisionReason,
      });
    },
  };
}

async function claimAndStart(
  kernel: WorkroomKernel,
  runId: string,
  taskKey: string,
): Promise<AssignmentExecutionEnvelope> {
  const state = await kernel.read('project-support', runId);
  const task = state.tasks[taskKey]!;
  const envelope = createAssignmentExecutionEnvelope({
    projectId: state.projectId, runId, taskKey, taskRevision: task.revision,
    assignmentId: 'assignment-content-free', assignmentRevision: 1, attempt: 1, fence: 1,
    principalId: 'executor-support', role: 'executor',
    agentDefinition: { ref: 'agent-definition:support:1', revision: 1, digest: SHA },
    plan: { ref: 'workflow-plan:support:1', revision: 1, digest: SHA },
    contextPolicy: { ref: 'context-policy:support:1', revision: 1, digest: SHA },
    factAnchor: { ref: `workroom-facts:${runId}:${state.sequence}`, sequence: state.sequence, digest: SHA },
    capabilitySnapshot: { ref: 'capability:support:1', revision: 1, digest: SHA },
    policySnapshot: { ref: 'policy:support:1', revision: 1, digest: SHA },
    workspace: {
      leaseRef: 'workspace-lease:content-free', mountRef: 'workspace-mount:content-free',
      baseRevision: 'base-sha-content-free', fence: 1,
    },
  });
  await kernel.execute('project-support', runId, {
    type: 'claim_task', taskKey, assignmentId: envelope.assignmentId,
    assignmentRevision: envelope.assignmentRevision, fence: envelope.fence,
    envelopeDigest: envelope.digest, owner: envelope.principalId, role: 'executor', leaseExpiresAt: 1_000,
  });
  await kernel.execute('project-support', runId, {
    type: 'start_assignment', assignmentId: envelope.assignmentId,
  });
  return envelope;
}
