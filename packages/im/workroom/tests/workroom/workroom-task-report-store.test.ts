import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { vi } from 'vitest';
import {
  FileWorkroomTaskReportStore,
  createWorkroomEvidence,
  createWorkroomStructuredTaskReport,
  type PersistedWorkroomStructuredTaskReport,
  type WorkroomTaskReportPayloadPort,
} from '../../src/workroom/workroom-task-report-store.js';
import type { GovernedPayloadWriteSagaSnapshot } from '../../src/data-governance/governed-payload-write-saga.js';

describe('Workroom Task Report Store', () => {
  it('publishes evidence and the structured report by content address before serving accepted memory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-workroom-report-'));
    await mkdir(join(root, '.zhin'));
    let governedReport: PersistedWorkroomStructuredTaskReport | undefined;
    const payloads: WorkroomTaskReportPayloadPort = {
      write: vi.fn(async input => {
        governedReport = input.report;
        const receipt = governedReceipt('report', 'derived:local-assignment', 'verified');
        await input.publication.publish(receipt, new AbortController().signal);
        return receipt;
      }),
      read: vi.fn(async input => {
        expect(input.purpose).toBe('accepted-source-memory-projector');
        return governedReport!;
      }),
    };
    const store = new FileWorkroomTaskReportStore(
      join(root, '.zhin', 'workroom-task-reports'),
      payloads,
    );
    const evidence = createWorkroomEvidence({
      mediaType: 'text/plain',
      ...governedReceipt('evidence', 'command:trusted-test-run-1', 'verified'),
    });
    await store.writeEvidence(evidence);
    const report = createWorkroomStructuredTaskReport({
      projectId: 'project-1',
      runId: 'run-1',
      planRef: 'plan:run-1:1',
      planRevision: 1,
      taskKey: 'test',
      taskRevision: 1,
      assignmentId: 'assignment-1',
      assignmentAttempt: 1,
      assignmentFence: 7,
      claims: [{
        label: 'tests-pass',
        key: 'verification.tests',
        value: '42 passed',
        status: 'verified',
        evidenceRefs: [evidence.ref],
        artifactRefs: ['git:abc123'],
      }],
    });
    const receipt = await store.writeReport(report);

    expect(receipt).toEqual({ ref: report.ref, digest: expect.stringMatching(/^sha256:/u) });
    await expect(store.read({
      projectId: report.projectId,
      runId: report.runId,
      taskKey: report.taskKey,
      reportRef: report.ref,
      candidateHash: report.candidateHash,
    })).resolves.toEqual(report);
    const reportHeader = await readFile(join(root, '.zhin', 'workroom-task-reports', 'reports', `${report.candidateHash.slice(7)}.json`), 'utf8');
    expect(reportHeader).toContain(report.candidateHash);
    expect(reportHeader).not.toContain('verification.tests');
    expect(reportHeader).not.toContain('42 passed');
    expect(reportHeader).not.toContain('git:abc123');
    const evidenceHeader = await readFile(join(
      root,
      '.zhin',
      'workroom-task-reports',
      'evidence',
      `${evidence.digest.slice(7)}.json`,
    ), 'utf8');
    expect(evidenceHeader).toContain('vault-object:evidence');
    expect(evidenceHeader).not.toContain('vitest: 42 passed');
    expect(evidenceHeader).not.toContain('pnpm test');
    expect(JSON.parse(evidenceHeader)).not.toHaveProperty('content');
    expect(payloads.read).toHaveBeenCalledOnce();
    await expect(store.verifyGovernedPayloadPublication(indexedIntent(
      evidence,
      'evidence_header',
      'evidence-scope',
    ))).resolves.toEqual({ status: 'exact', publicationDigest: evidence.digest });
    await expect(store.verifyGovernedPayloadPublication(indexedIntent(
      governedReceipt('report', 'derived:local-assignment', 'verified'),
      'task_report_header',
      report.ref,
    ))).resolves.toEqual({ status: 'exact', publicationDigest: receipt.digest });
  });

  it('fails closed when a verified claim references evidence that was not durably published', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-workroom-report-missing-'));
    await mkdir(join(root, '.zhin'));
    const store = new FileWorkroomTaskReportStore(
      join(root, '.zhin', 'workroom-task-reports'),
      {
        write: async input => {
          const receipt = governedReceipt('report', 'derived:local-assignment', 'verified');
          await input.publication.publish(receipt, new AbortController().signal);
          return receipt;
        },
        read: async () => { throw new Error('not expected'); },
      },
    );
    const report = createWorkroomStructuredTaskReport({
      projectId: 'project-1',
      runId: 'run-1',
      planRef: 'plan:run-1:1',
      planRevision: 1,
      taskKey: 'test',
      taskRevision: 1,
      assignmentId: 'assignment-1',
      assignmentAttempt: 1,
      assignmentFence: 7,
      claims: [{
        label: 'tests-pass',
        key: 'verification.tests',
        value: '42 passed',
        status: 'verified',
        evidenceRefs: [`workroom-evidence:sha256:${'a'.repeat(64)}`],
        artifactRefs: [],
      }],
    });

    await expect(store.writeReport(report)).rejects.toThrow('Evidence is not durably published');
  });

  it('does not publish a report header when the governed Writer cannot verify its source lineage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-workroom-report-unverified-'));
    await mkdir(join(root, '.zhin'));
    const store = new FileWorkroomTaskReportStore(
      join(root, '.zhin', 'workroom-task-reports'),
      {
        write: async input => {
          const receipt = governedReceipt('report', 'quarantine:derived-report', 'unverified');
          await input.publication.publish(receipt, new AbortController().signal);
          return receipt;
        },
        read: async () => { throw new Error('not expected'); },
      },
    );
    const report = createWorkroomStructuredTaskReport({
      projectId: 'project-1', runId: 'run-1', planRef: 'plan:run-1:1', planRevision: 1,
      taskKey: 'test', taskRevision: 1,
      assignmentId: 'assignment-1', assignmentAttempt: 1, assignmentFence: 7,
      claims: [{
        label: 'assumption', key: 'task.note', value: 'not verified', status: 'assumed',
        evidenceRefs: [], artifactRefs: [],
      }],
    });

    await expect(store.writeReport(report)).rejects.toThrow('lacks verified source lineage');
    await expect(readFile(join(
      root, '.zhin', 'workroom-task-reports', 'reports', `${report.candidateHash.slice(7)}.json`,
    ), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('persists only host-generated canonical claim ids and survives restart without leaking model PII', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-workroom-report-claim-id-'));
    await mkdir(join(root, '.zhin'));
    let governedReport: PersistedWorkroomStructuredTaskReport | undefined;
    const payloads: WorkroomTaskReportPayloadPort = {
      write: vi.fn(async input => {
        governedReport = input.report;
        const receipt = governedReceipt('canonical-claim-report', 'derived:local-assignment', 'verified');
        await input.publication.publish(receipt, new AbortController().signal);
        return receipt;
      }),
      read: vi.fn(async () => governedReport!),
    };
    const directory = join(root, '.zhin', 'workroom-task-reports');
    const report = createWorkroomStructuredTaskReport({
      projectId: 'project-1', runId: 'run-1', planRef: 'plan:run-1:1', planRevision: 1,
      taskKey: 'test', taskRevision: 1,
      assignmentId: 'assignment-1', assignmentAttempt: 2, assignmentFence: 11,
      claims: [{
        label: 'alice@example.com / SSN 123-45-6789',
        key: 'private.customer.email',
        value: 'alice@example.com',
        status: 'assumed', evidenceRefs: [], artifactRefs: ['file:///private/customer.json'],
      }],
    });

    expect(report.claims[0]?.id).toMatch(/^workroom-claim:sha256:[a-f0-9]{64}$/u);
    expect(report.claims[0]?.id).not.toContain('alice');
    expect(report.claims[0]?.label).toBe('alice@example.com / SSN 123-45-6789');
    const nextAttempt = createWorkroomStructuredTaskReport({
      projectId: 'project-1', runId: 'run-1', planRef: 'plan:run-1:1', planRevision: 1,
      taskKey: 'test', taskRevision: 1,
      assignmentId: 'assignment-1', assignmentAttempt: 3, assignmentFence: 12,
      claims: [{
        label: 'alice@example.com / SSN 123-45-6789',
        key: 'private.customer.email', value: 'alice@example.com', status: 'assumed',
        evidenceRefs: [], artifactRefs: ['file:///private/customer.json'],
      }],
    });
    expect(nextAttempt.claims[0]?.id).not.toBe(report.claims[0]?.id);
    await new FileWorkroomTaskReportStore(directory, payloads).writeReport(report);

    const header = await readFile(join(
      directory, 'reports', `${report.candidateHash.slice(7)}.json`,
    ), 'utf8');
    expect(header).toContain(report.claims[0]!.id);
    expect(header).not.toContain('alice@example.com');
    expect(header).not.toContain('123-45-6789');
    expect(header).not.toContain('private.customer.email');
    expect(header).not.toContain('file:///private/customer.json');
    expect(JSON.parse(header)).toMatchObject({
      version: 2,
      claims: [{ claimId: report.claims[0]!.id, status: 'assumed', evidenceRefs: [] }],
    });
    expect(JSON.parse(header).claims[0]).not.toHaveProperty('id');

    await expect(new FileWorkroomTaskReportStore(directory, payloads).read({
      projectId: report.projectId,
      runId: report.runId,
      taskKey: report.taskKey,
      reportRef: report.ref,
      candidateHash: report.candidateHash,
    })).resolves.toEqual(report);
  });

  it('fails closed on legacy v1 headers instead of treating model ids as canonical claim authority', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-workroom-report-legacy-'));
    await mkdir(join(root, '.zhin'));
    let governedReport: PersistedWorkroomStructuredTaskReport | undefined;
    const payloads: WorkroomTaskReportPayloadPort = {
      write: vi.fn(async input => {
        governedReport = input.report;
        const receipt = governedReceipt('legacy-report', 'derived:local-assignment', 'verified');
        await input.publication.publish(receipt, new AbortController().signal);
        return receipt;
      }),
      read: vi.fn(async () => governedReport!),
    };
    const directory = join(root, '.zhin', 'workroom-task-reports');
    const store = new FileWorkroomTaskReportStore(directory, payloads);
    const report = createWorkroomStructuredTaskReport({
      projectId: 'project-1', runId: 'run-1', planRef: 'plan:run-1:1', planRevision: 1,
      taskKey: 'test', taskRevision: 1,
      assignmentId: 'assignment-1', assignmentAttempt: 1, assignmentFence: 7,
      claims: [{
        label: 'legacy-model-id', key: 'task.result', value: 'done', status: 'assumed',
        evidenceRefs: [], artifactRefs: [],
      }],
    });
    await store.writeReport(report);
    const path = join(directory, 'reports', `${report.candidateHash.slice(7)}.json`);
    const header = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    await writeFile(path, JSON.stringify({ ...header, version: 1 }), 'utf8');

    await expect(new FileWorkroomTaskReportStore(directory, payloads).read({
      projectId: report.projectId, runId: report.runId, taskKey: report.taskKey,
      reportRef: report.ref, candidateHash: report.candidateHash,
    })).rejects.toThrow('header version is invalid');
    expect(payloads.read).not.toHaveBeenCalled();

    await writeFile(path, JSON.stringify(header), 'utf8');
    const legacyPayloads: WorkroomTaskReportPayloadPort = {
      write: payloads.write,
      read: vi.fn(async () => ({ ...governedReport!, version: 1 }) as unknown as PersistedWorkroomStructuredTaskReport),
    };
    await expect(new FileWorkroomTaskReportStore(directory, legacyPayloads).read({
      projectId: report.projectId, runId: report.runId, taskKey: report.taskKey,
      reportRef: report.ref, candidateHash: report.candidateHash,
    })).rejects.toThrow('payload version is invalid');
  });
});

function governedReceipt(
  id: string,
  sourceRef: string,
  verification: 'verified' | 'unverified',
) {
  return {
    descriptor: {
      vaultObjectId: `vault-object:${id}`,
      objectId: `object:${id}`,
      payloadHash: `sha256:${'a'.repeat(64)}`,
      descriptorDigest: `sha256:${'b'.repeat(64)}`,
      locationManifestDigest: `sha256:${'c'.repeat(64)}`,
      bytes: 22,
    },
    source: {
      kind: 'command' as const,
      ref: sourceRef,
      digest: `sha256:${'d'.repeat(64)}`,
      bindingDigest: `sha256:${'e'.repeat(64)}`,
      verification,
    },
  };
}

function indexedIntent(
  receipt: ReturnType<typeof governedReceipt>,
  consumer: 'evidence_header' | 'task_report_header',
  publicationScope: string,
): GovernedPayloadWriteSagaSnapshot {
  return Object.freeze({
    version: 1,
    operationId: 'fixture:publication',
    projectId: 'project-1',
    objectId: receipt.descriptor.objectId,
    payloadHash: receipt.descriptor.payloadHash,
    descriptorDigest: receipt.descriptor.descriptorDigest,
    sourceBindingDigest: receipt.source.bindingDigest,
    consumer,
    publicationScope,
    intentId: 'governed-payload-write:fixture',
    sequence: 2,
    state: 'authority_indexed',
    authorityIndexDigest: `sha256:${'d'.repeat(64)}`,
    digest: `sha256:${'e'.repeat(64)}`,
  });
}
