import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createDataCategoryRegistrySnapshot,
  createDataGovernancePolicySnapshot,
  createDisclosureRecipientSetSnapshot,
  createProcessingDestinationContract,
} from '../../src/data-governance/data-governance.js';
import {
  EncryptedFilePayloadVault,
  type PayloadVaultCryptographyPort,
} from '../../src/data-governance/encrypted-file-payload-vault.js';
import {
  FileDataGovernanceAuthorityRepository,
  createProjectDataGovernanceAuthority,
  type DataGovernanceAuthorityRepository,
} from '../../src/data-governance/governance-authority-repository.js';
import {
  FileGovernedPayloadWriteSagaRepository,
  GovernedPayloadWritePurgeConsumer,
  createGovernedPayloadWriteIntentId,
} from '../../src/data-governance/governed-payload-write-saga.js';
import {
  WorkroomDataGovernanceRuntime,
} from '../../src/plugin-runtime/workroom-data-governance-runtime.js';
import { createWorkroomGovernedAcceptanceProjection } from '../../src/plugin-runtime/workroom-acceptance-provider-composition.js';
import {
  createWorkroomDynamicPlanningGenerationSnapshot,
  createWorkroomPlanningDisclosureSourceBinding,
} from '../../src/plugin-runtime/workroom-dynamic-planning-provider.js';
import { digestCanonicalWorkroomValue } from '../../src/workroom/canonical-value.js';
import {
  createWorkroomStructuredTaskReport,
  WorkroomGovernedPayloadHeaderCasLostError,
} from '../../src/workroom/workroom-task-report-store.js';
import { FileWorkroomJournal } from '../../src/workroom/journal.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';

describe('WorkroomDataGovernanceRuntime', () => {
  it('does not purge another in-flight Journal append while preparing or reconciling exact receipts', async () => {
    const root = join(tmpdir(), `zhin-governance-journal-concurrency-${randomUUID()}`);
    await mkdir(root);
    const repository = new FileDataGovernanceAuthorityRepository(
      join(root, 'authority'), { verify: async () => true },
    );
    await repository.appendProject(projectAuthority('full'), undefined);
    const payloadWrites = new FileGovernedPayloadWriteSagaRepository(join(root, 'sagas'));
    const runtime = new WorkroomDataGovernanceRuntime({
      generation: 5,
      repository,
      vault: new EncryptedFilePayloadVault({
        directory: join(root, 'payloads'), generation: 5,
        cryptography: testCryptography(new Uint8Array(32).fill(2), 'kms:key-journal-concurrency'),
      }),
      ...payloadInfrastructure(root, 5, payloadWrites),
      signal: new AbortController().signal,
      now: () => 100,
    });
    const write = async (eventId: string, value: string) => {
      const source = {
        ref: `workroom-journal-event:run-1:${eventId}:$.payload.title`,
        digest: digestCanonicalWorkroomValue({ eventId, value }),
        bindingDigest: digestCanonicalWorkroomValue({ eventId, value, binding: true }),
      };
      const receipt = await runtime.journalPayloads.write({
        projectId: 'project-1', runId: 'run-1', eventId,
        eventType: 'run.created', fieldPath: '$.payload.title', value,
        contentHash: digestCanonicalWorkroomValue(value), source,
      });
      const intentId = createGovernedPayloadWriteIntentId({
        operationId: `journal-publication:run-1`,
        projectId: 'project-1',
        objectId: receipt.descriptor.objectId,
        payloadHash: receipt.descriptor.payloadHash,
        descriptorDigest: receipt.descriptor.descriptorDigest,
        sourceBindingDigest: receipt.source.bindingDigest,
        consumer: 'journal_header',
        publicationScope: 'run-1',
      });
      return { receipt, intentId };
    };
    const first = await write('event-1', 'first private payload');
    const second = await write('event-2', 'second private payload');

    await runtime.journalPayloads.prepare?.({
      projectId: 'project-1', runId: 'run-1', receipts: [first.receipt],
    });
    await runtime.journalPayloads.reconcile?.({
      projectId: 'project-1', runId: 'run-1', receipts: [first.receipt],
      publicationDigest: digestCanonicalWorkroomValue({ header: 1 }),
    });
    await runtime.journalPayloads.abandon?.({
      projectId: 'project-1', runId: 'run-1', receipts: [first.receipt], reason: 'cas_lost',
    });

    await expect(payloadWrites.read(first.intentId)).resolves.toMatchObject({ state: 'published' });
    await expect(payloadWrites.read(second.intentId)).resolves.toMatchObject({ state: 'authority_indexed' });
    await expect(payloadWrites.listPurgeRequired('project-1')).resolves.toEqual([]);
  });

  it('settles an authority-indexed publication during generation handoff without a Vault rewrite', async () => {
    const root = join(tmpdir(), `zhin-governance-handoff-publication-${randomUUID()}`);
    await mkdir(root);
    const payloadWrites = new FileGovernedPayloadWriteSagaRepository(join(root, 'sagas'));
    const begun = await payloadWrites.begin({
      operationId: 'report:handoff', projectId: 'project-1', objectId: 'object:report',
      payloadHash: digestCanonicalWorkroomValue({ payload: 1 }),
      descriptorDigest: digestCanonicalWorkroomValue({ descriptor: 1 }),
      sourceBindingDigest: digestCanonicalWorkroomValue({ source: 1 }),
      consumer: 'task_report_header', publicationScope: 'workroom-report:handoff',
    });
    await payloadWrites.recordVault(begun.intentId, {
      version: 1, vaultObjectId: 'vault:report', objectId: 'object:report',
      payloadHash: digestCanonicalWorkroomValue({ payload: 1 }),
      descriptorDigest: digestCanonicalWorkroomValue({ descriptor: 1 }),
      tenantId: 'tenant-1', projectId: 'project-1',
      locationManifestDigest: digestCanonicalWorkroomValue({ location: 1 }),
    });
    await payloadWrites.recordAuthorityIndex(begun.intentId, digestCanonicalWorkroomValue({ authority: 1 }));
    const putSource = vi.fn();
    const runtime = new WorkroomDataGovernanceRuntime({
      generation: 8,
      repository: new FileDataGovernanceAuthorityRepository(join(root, 'authority')),
      vault: {
        putSource,
        putDerived: async () => { throw new Error('not expected'); },
        readExact: async () => { throw new Error('not expected'); },
      },
      ...payloadInfrastructure(root, 8, payloadWrites),
      payloadPublicationVerifier: {
        verify: async () => ({
          status: 'exact',
          publicationDigest: digestCanonicalWorkroomValue({ header: 1 }),
        }),
      },
      signal: new AbortController().signal,
    });

    await runtime.reconcilePayloadPurges(['project-1'], new AbortController().signal);
    await expect(payloadWrites.read(begun.intentId)).resolves.toMatchObject({ state: 'published' });
    expect(putSource).not.toHaveBeenCalled();
  });

  it('fails before touching Vault bytes unless saga, lifecycle index, and orphan purge are all ready', async () => {
    const root = join(tmpdir(), `zhin-governance-preflight-${randomUUID()}`);
    await mkdir(root);
    const repository = new FileDataGovernanceAuthorityRepository(join(root, 'authority'));
    const vault = new EncryptedFilePayloadVault({
      directory: join(root, 'payloads'), generation: 5,
      cryptography: testCryptography(new Uint8Array(32).fill(1), 'kms:key-preflight'),
    });
    const put = vi.spyOn(vault, 'putSource');
    const write = async (runtime: WorkroomDataGovernanceRuntime) =>
      await runtime.evidencePayloads.write({
        mediaType: 'text/plain', content: 'must-not-reach-vault',
        claimedSource: { kind: 'command', locator: 'test' },
        attribution: {
          projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 1,
          assignmentId: 'assignment-1', attempt: 1, fence: 1,
        },
        publication: publication(),
      }, new AbortController().signal);
    const base = {
      generation: 5, repository, vault, signal: new AbortController().signal,
    };
    await expect(write(new WorkroomDataGovernanceRuntime(base)))
      .rejects.toThrow('durable write saga authority is unavailable');
    const writes = new FileGovernedPayloadWriteSagaRepository(join(root, 'sagas'));
    await expect(write(new WorkroomDataGovernanceRuntime({ ...base, payloadWrites: writes })))
      .rejects.toThrow('Lifecycle index authority is unavailable');
    await expect(write(new WorkroomDataGovernanceRuntime({
      ...base,
      payloadWrites: writes,
      payloadLifecycleIndex: {
        register: async () => ({ digest: digestCanonicalWorkroomValue({ lifecycle: 1 }) }),
      },
    }))).rejects.toThrow('orphan purge authority is unavailable');
    expect(put).not.toHaveBeenCalled();
  });

  it('replays an exact durable header after a lost saga-publish response without rewriting Vault or purging', async () => {
    const root = join(tmpdir(), `zhin-governance-publication-restart-${randomUUID()}`);
    await mkdir(root);
    const repository = new FileDataGovernanceAuthorityRepository(
      join(root, 'authority'), { verify: async () => true },
    );
    await repository.appendProject(projectAuthority('full'), undefined);
    const vault = new EncryptedFilePayloadVault({
      directory: join(root, 'payloads'), generation: 5,
      cryptography: testCryptography(new Uint8Array(32).fill(2), 'kms:key-publication-restart'),
    });
    const put = vi.spyOn(vault, 'putSource');
    const payloadWrites = new FileGovernedPayloadWriteSagaRepository(join(root, 'sagas'));
    const infrastructure = payloadInfrastructure(root, 5, payloadWrites);
    const publishSaga = vi.spyOn(payloadWrites, 'publish');
    publishSaga.mockRejectedValueOnce(new Error('lost after durable header fsync'));
    const runtime = new WorkroomDataGovernanceRuntime({
      generation: 5, repository, vault, ...infrastructure,
      signal: new AbortController().signal, now: () => 100,
    });
    const report = createWorkroomStructuredTaskReport({
      projectId: 'project-1', runId: 'run-1', planRef: 'plan:1', planRevision: 1,
      taskKey: 'build', taskRevision: 1,
      assignmentId: 'assignment-1', assignmentAttempt: 1, assignmentFence: 1,
      claims: [{
        label: 'result', key: 'task.result', value: 'governed body', status: 'assumed',
        evidenceRefs: [], artifactRefs: [],
      }],
    });
    let headerPublishes = 0;
    const publicationPort = Object.freeze({
      publish: async () => {
        headerPublishes += 1;
        return { publicationDigest: digestCanonicalWorkroomValue({ header: report.ref }) };
      },
    });
    const input = {
      report,
      attribution: { projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 1 },
      publication: publicationPort,
    };

    await expect(runtime.taskReportPayloads.write(input, new AbortController().signal))
      .rejects.toThrow('lost after durable header fsync');
    const pending = await payloadWrites.listUnpublished('project-1', report.ref);
    expect(pending).toMatchObject([{ state: 'authority_indexed' }]);
    expect(await payloadWrites.listPurgeRequired('project-1')).toEqual([]);

    const receipt = await runtime.taskReportPayloads.write(input, new AbortController().signal);
    expect(receipt).toMatchObject({
      descriptor: { objectId: `workroom-task-report-payload:${report.candidateHash}` },
    });
    expect(headerPublishes).toBe(2);
    expect(put).toHaveBeenCalledOnce();
    await expect(payloadWrites.read(pending[0]!.intentId)).resolves.toMatchObject({ state: 'published' });

    const read = vi.spyOn(vault, 'readExact');
    const missingPurge = new WorkroomDataGovernanceRuntime({
      generation: 5, repository, vault,
      payloadWrites,
      payloadLifecycleIndex: infrastructure.payloadLifecycleIndex,
      signal: new AbortController().signal,
    });
    await expect(missingPurge.taskReportPayloads.read({
      receipt,
      projectId: 'project-1', runId: 'run-1', taskKey: 'build',
      reportRef: report.ref, candidateHash: report.candidateHash,
      purpose: 'accepted-source-memory-projector',
    }, new AbortController().signal)).rejects.toThrow('orphan purge authority is unavailable');
    expect(read).not.toHaveBeenCalled();
  });

  it('abandons an exact header CAS loser into durable purge-required state', async () => {
    const root = join(tmpdir(), `zhin-governance-header-cas-${randomUUID()}`);
    await mkdir(root);
    const repository = new FileDataGovernanceAuthorityRepository(
      join(root, 'authority'), { verify: async () => true },
    );
    await repository.appendProject(projectAuthority('full'), undefined);
    const payloadWrites = new FileGovernedPayloadWriteSagaRepository(join(root, 'sagas'));
    const runtime = new WorkroomDataGovernanceRuntime({
      generation: 5,
      repository,
      vault: new EncryptedFilePayloadVault({
        directory: join(root, 'payloads'), generation: 5,
        cryptography: testCryptography(new Uint8Array(32).fill(3), 'kms:key-header-cas'),
      }),
      ...payloadInfrastructure(root, 5, payloadWrites),
      signal: new AbortController().signal,
    });
    const report = createWorkroomStructuredTaskReport({
      projectId: 'project-1', runId: 'run-1', planRef: 'plan:1', planRevision: 1,
      taskKey: 'build', taskRevision: 1,
      assignmentId: 'assignment-1', assignmentAttempt: 1, assignmentFence: 1,
      claims: [{
        label: 'result', key: 'task.result', value: 'governed body', status: 'assumed',
        evidenceRefs: [], artifactRefs: [],
      }],
    });

    await expect(runtime.taskReportPayloads.write({
      report,
      attribution: { projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 1 },
      publication: {
        publish: async () => {
          throw new WorkroomGovernedPayloadHeaderCasLostError('exact header CAS loser');
        },
      },
    }, new AbortController().signal)).rejects.toThrow('exact header CAS loser');
    await expect(payloadWrites.listPurgeRequired('project-1')).resolves.toMatchObject([{
      state: 'purge_required', purgeReason: 'cas_lost',
    }]);
  });

  it('does not publish a non-Journal saga until appendSource returns the exact durable CAS winner', async () => {
    const root = join(tmpdir(), `zhin-governance-cas-fault-${randomUUID()}`);
    await mkdir(root);
    const durable = new FileDataGovernanceAuthorityRepository(
      join(root, 'authority'), { verify: async () => true },
    );
    await durable.appendProject(projectAuthority('full'), undefined);
    const repository: DataGovernanceAuthorityRepository = {
      readProject: projectId => durable.readProject(projectId),
      appendProject: (authority, expected) => durable.appendProject(authority, expected),
      readSource: (projectId, sourceRef, sourceDigest) =>
        durable.readSource(projectId, sourceRef, sourceDigest),
      appendSource: async source => {
        await durable.appendSource(source);
        return Object.freeze({ ...source, projectAuthorityDigest: `sha256:${'f'.repeat(64)}` });
      },
      recordBlocker: input => durable.recordBlocker(input),
      listBlockers: projectId => durable.listBlockers(projectId),
    };
    const payloadWrites = new FileGovernedPayloadWriteSagaRepository(join(root, 'sagas'));
    const runtime = new WorkroomDataGovernanceRuntime({
      generation: 5,
      repository,
      vault: new EncryptedFilePayloadVault({
        directory: join(root, 'payloads'), generation: 5,
        cryptography: testCryptography(new Uint8Array(32).fill(4), 'kms:key-cas-fault'),
      }),
      ...payloadInfrastructure(root, 5, payloadWrites),
      signal: new AbortController().signal,
      now: () => 100,
    });
    const report = createWorkroomStructuredTaskReport({
      projectId: 'project-1', runId: 'run-1', planRef: 'plan:1', planRevision: 1,
      taskKey: 'build', taskRevision: 1,
      assignmentId: 'assignment-1', assignmentAttempt: 1, assignmentFence: 1,
      claims: [{
        label: 'claim:1', key: 'task.result', value: 'secret body', status: 'assumed',
        evidenceRefs: [], artifactRefs: [],
      }],
    });

    await expect(runtime.taskReportPayloads.write({
      report,
      attribution: { projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 1 },
      publication: publication(),
    }, new AbortController().signal)).rejects.toThrow('CAS winner drift');

    const pending = await payloadWrites.listPurgeRequired('project-1');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ state: 'purge_required', purgeReason: 'write_failed' });
    expect(pending[0]?.publicationDigest).toBeUndefined();
    expect(JSON.stringify(pending)).not.toContain('secret body');
  });

  it('classifies and encrypts canonical ingress, then returns only policy-minimized materialized text', async () => {
    const root = join(tmpdir(), `zhin-governance-runtime-${randomUUID()}`);
    await mkdir(root);
    const repository = new FileDataGovernanceAuthorityRepository(
      join(root, 'authority'), { verify: async () => true },
    );
    const authority = projectAuthority('metadata_only');
    await repository.appendProject(authority, undefined);
    const vault = new EncryptedFilePayloadVault({
      directory: join(root, 'payloads'), generation: 5,
      cryptography: testCryptography(new Uint8Array(32).fill(7), 'kms:key-5'),
    });
    const runtime = new WorkroomDataGovernanceRuntime({
      generation: 5, repository, vault, ...payloadInfrastructure(root, 5),
      signal: new AbortController().signal, now: () => 100,
    });
    const source = {
      version: 1 as const, ref: 'conversation-event:message-1', digest: `sha256:${'1'.repeat(64)}`,
      sequence: 7, conversationKey: 'sandbox\0bot\0group\0room-1\0\0\0', eventId: 'message-1',
      text: '/work investigate private account 314159',
      event: { timestamp: 100 } as never,
    };
    const input = {
      version: 1 as const,
      generation: createWorkroomDynamicPlanningGenerationSnapshot(5),
      input: {
        version: 1 as const, operationId: 'operation:1', projectId: 'project-1',
        projectRevision: 'catalog:1', projectDigest: `sha256:${'2'.repeat(64)}`,
        orchestratorAgentDefinitionId: 'agent:orchestrator',
        orchestratorAuthorityDigest: `sha256:${'3'.repeat(64)}`,
        principalId: 'principal:sponsor-1', source,
      },
      source: createWorkroomPlanningDisclosureSourceBinding(source),
      destinationKind: 'model_provider' as const,
      purpose: 'orchestration' as const,
    };

    const result = await runtime.planningDisclosure.materialize(input, new AbortController().signal);
    expect(result.text).not.toContain('private account 314159');
    expect(JSON.parse(result.text)).toMatchObject({
      kind: 'source_message', confidentiality: 'confidential', categories: ['customer_content'],
    });
    expect(result.manifest).toMatchObject({
      output: { mode: 'metadata_only' }, channel: 'model_provider', purpose: 'orchestration',
      principal: { principalId: 'principal:sponsor-1' },
      destination: { id: 'destination:model' }, policy: { revision: 4, digest: authority.policy.digest },
    });
    const stored = await repository.readSource('project-1', source.ref, source.digest);
    expect(stored).toMatchObject({
      sourceRef: source.ref, sourceDigest: source.digest,
      projectAuthorityRevision: authority.revision, projectAuthorityDigest: authority.digest,
    });
    expect(JSON.stringify(stored)).not.toContain('private account 314159');

    const registeredRequest = {
      operationId: 'operation:registered-model', projectId: 'project-1',
      sourceRef: source.ref, sourceDigest: source.digest, sinkRuleId: 'sink:model',
      principalId: 'principal:sponsor-1',
    };
    const registered = await runtime.disclosureManifest.materialize(
      registeredRequest,
      new AbortController().signal,
    );
    expect(registered).not.toBeNull();
    const revalidated = await runtime.disclosureManifest.revalidate({
      request: registeredRequest,
      manifest: registered!,
    }, new AbortController().signal);
    expect(revalidated).toMatchObject({ status: 'ready', manifest: registered });
    if (revalidated.status === 'ready') {
      expect(new TextDecoder().decode(revalidated.body)).not.toContain('private account 314159');
      expect(`sha256:${await crypto.subtle.digest('SHA-256', revalidated.body)
        .then(value => Buffer.from(value).toString('hex'))}`).toBe(registered!.output.payloadHash);
    }

    const forged = await runtime.disclosureManifest.materialize({
      operationId: 'operation:forged-caller', projectId: 'project-1',
      sourceRef: source.ref, sourceDigest: source.digest, sinkRuleId: 'sink:model',
      principalId: 'principal:executor-2',
      principal: { clearance: 'restricted', role: 'auditor' },
      recipients: { revision: 999, digest: `sha256:${'9'.repeat(64)}`, recipients: [] },
    } as never, new AbortController().signal);
    expect(forged).toMatchObject({
      principal: { principalId: 'principal:executor-2' },
      destination: { recipientRevision: recipientsRevision(authority), recipientDigest: recipientsDigest(authority) },
    });

    const evidence = await runtime.evidencePayloads.write({
      mediaType: 'text/plain', content: '42 private tests passed',
      claimedSource: { kind: 'command', locator: 'pnpm test --secret-token' },
      attribution: {
        projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 1,
        assignmentId: 'assignment-1', attempt: 1, fence: 3,
      },
      publication: publication(),
    }, new AbortController().signal);
    expect(evidence.source).toMatchObject({ verification: 'unverified' });
    expect(JSON.stringify(evidence)).not.toContain('pnpm test --secret-token');
    expect(JSON.stringify(evidence)).not.toContain('42 private tests passed');

    const report = createWorkroomStructuredTaskReport({
      projectId: 'project-1', runId: 'run-1', planRef: 'plan:1', planRevision: 1,
      taskKey: 'build', taskRevision: 1,
      assignmentId: 'assignment-1', assignmentAttempt: 1, assignmentFence: 3,
      claims: [{
        label: 'claim:1', key: 'task.result', value: 'done', status: 'assumed',
        evidenceRefs: [], artifactRefs: [],
      }],
    });
    const reportReceipt = await runtime.taskReportPayloads.write({
      report,
      attribution: { projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 1 },
      publication: publication(),
    }, new AbortController().signal);
    expect(reportReceipt.source.verification).toBe('verified');
    await expect(runtime.taskReportPayloads.read({
      receipt: reportReceipt,
      projectId: 'project-1', runId: 'run-1', taskKey: 'build',
      reportRef: report.ref, candidateHash: report.candidateHash,
      purpose: 'accepted-source-memory-projector',
    }, new AbortController().signal)).resolves.toEqual(report);

    const journalInput = {
      projectId: 'project-1', runId: 'run-1', eventId: 'event-1',
      eventType: 'run.created' as const, fieldPath: '$.payload.title',
      value: 'private Workroom customer title',
      contentHash: digestCanonicalWorkroomValue('private Workroom customer title'),
      source: {
        ref: 'workroom-journal-event:run-1:event-1:$.payload.title',
        digest: `sha256:${'8'.repeat(64)}`,
        bindingDigest: `sha256:${'9'.repeat(64)}`,
      },
    };
    const journalReceipt = await runtime.journalPayloads.write(journalInput);
    expect(JSON.stringify(journalReceipt)).not.toContain('private Workroom customer title');
    await expect(runtime.journalPayloads.read({
      ...journalInput,
      receipt: journalReceipt,
      purpose: 'kernel-replay',
    })).resolves.toBe('private Workroom customer title');

    const journalDirectory = join(root, 'workroom-journal');
    await mkdir(journalDirectory);
    const kernel = new WorkroomKernel({
      journal: new FileWorkroomJournal(journalDirectory, runtime.journalPayloads),
      now: () => 100,
      createId: () => 'journal-event-runtime',
    });
    await kernel.createRun({
      runId: 'run-governed-runtime', projectId: 'project-1',
      title: 'runtime-only private customer title',
    });
    const rawJournal = (await Promise.all((await readdir(journalDirectory))
      .map(async name => await readFile(join(journalDirectory, name), 'utf8')))).join('\n');
    expect(rawJournal).not.toContain('runtime-only private customer title');
    const restartedRuntime = new WorkroomDataGovernanceRuntime({
      generation: 5,
      repository,
      vault: new EncryptedFilePayloadVault({
        directory: join(root, 'payloads'), generation: 5,
        cryptography: testCryptography(new Uint8Array(32).fill(7), 'kms:key-5'),
      }),
      ...payloadInfrastructure(root, 5),
      signal: new AbortController().signal,
      now: () => 101,
    });
    await expect(new WorkroomKernel({
      journal: new FileWorkroomJournal(journalDirectory, restartedRuntime.journalPayloads),
    }).read('project-1', 'run-governed-runtime')).resolves.toMatchObject({
      title: 'runtime-only private customer title',
    });

    const cancelledSource = {
      ...source,
      ref: 'conversation-event:cancelled', digest: `sha256:${'7'.repeat(64)}`,
      sequence: 8, eventId: 'cancelled', text: '/work cancelled before KMS',
    };
    const cancelledRuntime = new WorkroomDataGovernanceRuntime({
      generation: 5,
      repository,
      vault: new EncryptedFilePayloadVault({
        directory: join(root, 'cancelled-payloads'), generation: 5,
        cryptography: { wrap: async () => new Promise(() => undefined), unwrap: async () => null },
      }),
      ...payloadInfrastructure(root, 5, undefined, 'cancelled'),
      signal: new AbortController().signal,
      now: () => 101,
    });
    const controller = new AbortController();
    const cancelled = cancelledRuntime.planningDisclosure.materialize({
      ...input,
      input: { ...input.input, operationId: 'operation:cancelled', source: cancelledSource },
      source: createWorkroomPlanningDisclosureSourceBinding(cancelledSource),
    }, controller.signal);
    const reason = new DOMException('cancelled', 'AbortError');
    controller.abort(reason);
    await expect(cancelled).rejects.toBe(reason);
    await expect(repository.listBlockers('project-1')).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ operationId: 'operation:cancelled', kind: 'generation_retired' }),
    ]));
  });

  it('persists a typed blocker and fails closed when Project authority is absent', async () => {
    const root = join(tmpdir(), `zhin-governance-runtime-${randomUUID()}`);
    await mkdir(root);
    const repository = new FileDataGovernanceAuthorityRepository(join(root, 'authority'));
    const runtime = new WorkroomDataGovernanceRuntime({
      generation: 2, repository,
      vault: new EncryptedFilePayloadVault({
        directory: join(root, 'payloads'), generation: 2,
        cryptography: { wrap: async () => null, unwrap: async () => null },
      }),
      ...payloadInfrastructure(root, 2),
      signal: new AbortController().signal, now: () => 250,
    });
    const source = {
      version: 1 as const, ref: 'conversation-event:missing', digest: `sha256:${'4'.repeat(64)}`,
      sequence: 1, conversationKey: 'sandbox\0bot\0group\0room\0\0\0', eventId: 'missing',
      text: '/work unavailable', event: { timestamp: 200 } as never,
    };
    await expect(runtime.planningDisclosure.materialize({
      version: 1, generation: createWorkroomDynamicPlanningGenerationSnapshot(2),
      input: {
        version: 1, operationId: 'operation:missing', projectId: 'project-missing',
        projectRevision: 'catalog:1', projectDigest: `sha256:${'5'.repeat(64)}`,
        orchestratorAgentDefinitionId: 'agent:orchestrator', orchestratorAuthorityDigest: `sha256:${'6'.repeat(64)}`,
        principalId: 'principal:sponsor', source,
      },
      source: createWorkroomPlanningDisclosureSourceBinding(source),
      destinationKind: 'model_provider', purpose: 'orchestration',
    }, new AbortController().signal)).rejects.toMatchObject({
      name: 'WorkroomPlanningClarificationError', reason: 'planning_disclosure_unavailable',
    });
    const journalSecret = 'customer credential must never enter a blocker';
    await expect(runtime.journalPayloads.write({
      projectId: 'project-missing', runId: 'run-missing', eventId: 'event-missing',
      eventType: 'run.created', fieldPath: '$.payload.title', value: journalSecret,
      contentHash: digestCanonicalWorkroomValue(journalSecret),
      source: {
        ref: 'workroom-journal-event:run-missing:event-missing:$.payload.title',
        digest: `sha256:${'8'.repeat(64)}`, bindingDigest: `sha256:${'9'.repeat(64)}`,
      },
    })).rejects.toThrow('Project authority is unavailable');
    await expect(repository.listBlockers('project-missing')).resolves.toMatchObject([{
      kind: 'project_authority_unavailable', operationId: 'operation:missing', generation: 2,
    }, {
      kind: 'project_authority_unavailable',
      operationId: `workroom-journal-write:event-missing:${digestCanonicalWorkroomValue('$.payload.title')}`,
      generation: 2,
    }]);
    expect(JSON.stringify(await repository.listBlockers('project-missing'))).not.toContain(journalSecret);
  });

  it('stores exact Profile-policy Acceptance projections and reauthorizes the source before every read', async () => {
    const root = join(tmpdir(), `zhin-governance-acceptance-${randomUUID()}`);
    await mkdir(root);
    const repository = new FileDataGovernanceAuthorityRepository(
      join(root, 'authority'), { verify: async () => true },
    );
    await repository.appendProject(projectAuthority('metadata_only'), undefined);
    const projection = createWorkroomGovernedAcceptanceProjection({
      version: 1,
      projectId: 'project-1',
      profileRevisionId: 'profile-revision:7',
      profileDigest: `sha256:${'d'.repeat(64)}`,
      revision: 7,
      issuer: 'principal:profile-publisher',
      tasks: [{
        taskKey: 'resolve-customer-ticket',
        kind: 'task_result',
        criteria: [{
          id: 'criterion:no-credential-leak',
          kind: 'deterministic',
          description: 'credential material must never leave the governed payload',
        }],
        requiredEvidence: ['test-report'],
        minimumRoute: 'reviewer_required',
        reviewerPrincipalId: 'principal:reviewer',
        sponsorPrincipalId: 'principal:sponsor',
        reviewerTimeoutMs: 60_000,
        sponsorTimeoutMs: 120_000,
      }],
      memorySchema: {
        revision: 2,
        claimRules: [{
          key: 'support.resolution', valueType: 'string',
          allowedStatuses: ['verified'], allowSupersedes: true,
        }],
      },
    });
    const source = {
      kind: 'profile-policy' as const,
      ref: 'profile-policy:project-1:profile-revision-7',
      digest: `sha256:${'e'.repeat(64)}`,
      issuer: projection.issuer,
      issuerDigest: `sha256:${'f'.repeat(64)}`,
      revision: projection.revision,
    };
    const bindingDigest = digestCanonicalWorkroomValue({
      version: 1, projectId: projection.projectId, profileRevisionId: projection.profileRevisionId,
      profileDigest: projection.profileDigest, projectionDigest: projection.digest, source,
    });
    let sourceAuthorized = true;
    const sourceAuthority = {
      resolve: async (input: Readonly<{
        projectId: string;
        projectionDigest: string;
        source: typeof source & Readonly<{ bindingDigest: string }>;
      }>) => sourceAuthorized
        && input.projectId === projection.projectId
        && input.projectionDigest === projection.digest
        && input.source.bindingDigest === bindingDigest
        && input.source.ref === source.ref
        && input.source.digest === source.digest
        && input.source.issuer === source.issuer
        && input.source.issuerDigest === source.issuerDigest
        && input.source.revision === source.revision
        ? { ...source, bindingDigest, verification: 'verified' as const }
        : undefined,
    };
    let unwraps = 0;
    const baseCryptography = testCryptography(new Uint8Array(32).fill(4), 'kms:key-acceptance');
    const cryptography: PayloadVaultCryptographyPort = {
      wrap: baseCryptography.wrap,
      unwrap: async input => {
        unwraps += 1;
        return await baseCryptography.unwrap(input);
      },
    };
    const payloadDirectory = join(root, 'payloads');
    const makeRuntime = () => new WorkroomDataGovernanceRuntime({
      generation: 9,
      repository,
      vault: new EncryptedFilePayloadVault({
        directory: payloadDirectory, generation: 9, cryptography,
      }),
      ...payloadInfrastructure(root, 9),
      acceptanceProjectionSources: sourceAuthority,
      signal: new AbortController().signal,
      now: () => 200,
    });

    const receipt = await makeRuntime().acceptanceProjectionPayloads.write({
      operationId: 'acceptance-projection:publish:7', projectId: projection.projectId,
      projection, source: { ...source, bindingDigest },
    }, new AbortController().signal);
    expect(receipt).toMatchObject({
      payloadHash: projection.digest,
      source: { ...source, bindingDigest, verification: 'verified' },
      sourceBindingDigest: bindingDigest,
    });
    expect(JSON.stringify(receipt)).not.toContain('credential material');

    const restarted = makeRuntime();
    await expect(restarted.acceptanceProjectionPayloads.read({
      operationId: 'acceptance-projection:read:7', projectId: projection.projectId,
      purpose: 'acceptance-policy', receipt,
    }, new AbortController().signal)).resolves.toEqual(projection);
    const unwrapsBeforeRevocation = unwraps;
    expect(unwrapsBeforeRevocation).toBeGreaterThan(0);

    sourceAuthorized = false;
    await expect(restarted.acceptanceProjectionPayloads.read({
      operationId: 'acceptance-projection:read:revoked', projectId: projection.projectId,
      purpose: 'acceptance-policy', receipt,
    }, new AbortController().signal)).resolves.toBeUndefined();
    expect(unwraps).toBe(unwrapsBeforeRevocation);

    const persistedAuthority = (await Promise.all((await readdir(join(root, 'authority'), { recursive: true }))
      .filter(entry => entry.endsWith('.json'))
      .map(async entry => await readFile(join(root, 'authority', entry), 'utf8')))).join('\n');
    expect(persistedAuthority).not.toContain('credential material');
    expect(persistedAuthority).not.toContain('support.resolution');

    await expect(new WorkroomDataGovernanceRuntime({
      generation: 9, repository,
      vault: new EncryptedFilePayloadVault({ directory: join(root, 'denied'), generation: 9, cryptography }),
      ...payloadInfrastructure(root, 9, undefined, 'denied'),
      signal: new AbortController().signal,
    }).acceptanceProjectionPayloads.write({
      operationId: 'acceptance-projection:publish:no-source', projectId: projection.projectId,
      projection, source: { ...source, bindingDigest },
    }, new AbortController().signal)).rejects.toThrow('source is unavailable');

    const generation = new AbortController();
    let retiredSourceResolutions = 0;
    const retired = new WorkroomDataGovernanceRuntime({
      generation: 9, repository,
      vault: new EncryptedFilePayloadVault({ directory: join(root, 'retired'), generation: 9, cryptography }),
      ...payloadInfrastructure(root, 9, undefined, 'retired'),
      acceptanceProjectionSources: {
        resolve: async () => {
          retiredSourceResolutions += 1;
          return { ...source, bindingDigest, verification: 'verified' };
        },
      },
      signal: generation.signal,
    });
    const retirement = new DOMException('generation retired', 'AbortError');
    generation.abort(retirement);
    await expect(retired.acceptanceProjectionPayloads.write({
      operationId: 'acceptance-projection:publish:retired', projectId: projection.projectId,
      projection, source: { ...source, bindingDigest },
    }, new AbortController().signal)).rejects.toBe(retirement);
    expect(retiredSourceResolutions).toBe(0);
  });

  it('blocks exact persisted manifests after recipient/policy drift without reading the body', async () => {
    const authority = projectAuthority('metadata_only');
    const manifest = await materializedFixture(authority);
    let reads = 0;
    const changedRecipients = createDisclosureRecipientSetSnapshot({
      revision: 4,
      recipients: [{
        principalId: 'principal:model-2', tenantId: 'tenant-1', projectId: 'project-1',
        clearance: 'confidential',
      }],
    });
    const changedDestination = createProcessingDestinationContract({
      ...authority.policy.destinations['destination:model']!,
      recipientSnapshotRevision: changedRecipients.revision,
      recipientSnapshotDigest: changedRecipients.digest,
    });
    const changedPolicy = createDataGovernancePolicySnapshot({
      ...authority.policy,
      revision: authority.policy.revision + 1,
      destinations: { [changedDestination.id]: changedDestination },
      // This is deliberately wider. An old Manifest still cannot gain authority.
      channelCeilings: { ...authority.policy.channelCeilings, workroom_projection: 'confidential' },
    });
    const { digest: _authorityDigest, governanceDecision: _governanceDecision, ...authorityInput } = authority;
    const changedCandidate = {
      ...authorityInput,
      revision: authority.revision + 1,
      previousDigest: authority.digest,
      policy: changedPolicy,
      planning: { ...authority.planning, recipients: changedRecipients },
      sinks: Object.fromEntries(Object.entries(authority.sinks).map(([id, rule]) => [
        id, { ...rule, recipients: changedRecipients },
      ])),
    };
    const changed = createProjectDataGovernanceAuthority({
      ...changedCandidate,
      governanceDecision: {
        decisionId: 'governance:decision-2', projectId: authority.projectId,
        expectedPreviousDigest: authority.digest,
        candidateDigest: digestCanonicalWorkroomValue(changedCandidate),
        principalId: 'principal:data-steward', authorizedBy: 'data_steward', decidedAt: 2,
      },
    });
    const repository = {
      readProject: async () => changed,
      readSource: async () => manifest.sourceAuthority,
      appendProject: async () => changed,
      appendSource: async () => manifest.sourceAuthority,
      recordBlocker: async (input: never) => input,
      listBlockers: async () => [],
    };
    const runtime = new WorkroomDataGovernanceRuntime({
      generation: 5,
      repository,
      vault: {
        putSource: async () => manifest.manifest.source.handle,
        putDerived: async () => manifest.manifest.output.handle,
        readExact: async () => { reads += 1; return new Uint8Array(); },
      },
      signal: new AbortController().signal,
      now: () => 100,
    });
    await expect(runtime.disclosureManifest.revalidate({
      request: manifest.request,
      manifest: manifest.manifest,
    }, new AbortController().signal)).resolves.toEqual({
      status: 'blocked', reason: 'disclosure_recipient_revoked',
    });
    expect(reads).toBe(0);
  });
});

function projectAuthority(requestedMode: 'full' | 'metadata_only') {
  const recipients = createDisclosureRecipientSetSnapshot({
    revision: 3,
    recipients: [{ principalId: 'principal:model', tenantId: 'tenant-1', projectId: 'project-1', clearance: 'confidential' }],
  });
  const destination = createProcessingDestinationContract({
    id: 'destination:model', owner: 'owner:ai', endpoint: 'model://provider', tenantId: 'tenant-1',
    projectId: 'project-1', trustDomain: 'trust:processor', processingRegions: ['ap-southeast-1'],
    maxConfidentiality: 'confidential', allowedCategories: ['customer_content'], external: true,
    noTraining: true, loggingMode: 'metadata_only', maximumRetentionSeconds: 60,
    allowsRedisclosure: false, supportsDeletion: true,
    recipientSnapshotRevision: recipients.revision, recipientSnapshotDigest: recipients.digest,
  });
  const categoryRegistry = createDataCategoryRegistrySnapshot({
    id: 'registry:tenant-1', revision: 2, tenantId: 'tenant-1',
    kindFloors: {
      source_message: 'project_internal', projection_payload: 'project_internal',
      evidence: 'project_internal', task_report: 'project_internal', workroom_fact: 'project_internal',
    },
    categories: { customer_content: { confidentialityFloor: 'confidential' } },
  });
  const policy = createDataGovernancePolicySnapshot({
    id: 'policy:project-1', revision: 4, tenantId: 'tenant-1', projectId: 'project-1',
    destinations: { [destination.id]: destination },
    channelCeilings: {
      context_view: 'confidential', evidence_port: 'confidential', workroom_projection: 'project_internal',
      sponsor_projection: 'confidential', console: 'confidential', model_provider: 'confidential', a2a: 'confidential',
    }, transforms: {}, externalApprovalFloor: 'restricted',
  });
  const candidate = {
    version: 1, revision: 1, projectId: 'project-1', tenantId: 'tenant-1', categoryRegistry, policy,
    planning: {
      destinationId: destination.id, recipients,
      principal: { role: 'orchestrator', clearance: 'confidential', allowedPurposes: ['orchestration'] },
      source: {
        proposedConfidentiality: 'confidential', categories: ['customer_content'],
        allowedPurposes: ['orchestration'], allowedRegions: ['ap-southeast-1'],
        retentionClass: 'operational', minimumRetentionMs: 0, maximumRetentionMs: 86_400_000,
        requestedMode, linkPrincipalAsSubject: true,
      },
    }, remote: {}, sinks: {
      'sink:model': {
        destinationId: destination.id, channel: 'model_provider', purpose: 'orchestration',
        recipients, principal: {
          role: 'orchestrator', clearance: 'confidential', allowedPurposes: ['orchestration'],
        }, requestedMode,
      },
      'task-report:accepted-source-memory-projector': {
        destinationId: destination.id, channel: 'context_view', purpose: 'acceptance_review',
        recipients, fixedPrincipalId: 'principal:memory-projector',
        principal: {
          role: 'projector', clearance: 'confidential', allowedPurposes: ['acceptance_review'],
        }, requestedMode: 'full',
      },
      'acceptance-projection:acceptance-policy': {
        destinationId: destination.id, channel: 'context_view', purpose: 'acceptance_review',
        recipients, fixedPrincipalId: 'principal:acceptance-policy',
        principal: {
          role: 'projector', clearance: 'confidential', allowedPurposes: ['acceptance_review'],
        }, requestedMode: 'full',
      },
      'workroom-journal:kernel-replay': {
        destinationId: destination.id, channel: 'context_view', purpose: 'orchestration',
        recipients, fixedPrincipalId: 'principal:workroom-kernel',
        principal: {
          role: 'orchestrator', clearance: 'confidential', allowedPurposes: ['orchestration'],
        }, requestedMode: 'full',
      },
    }, derivedPayloads: {
      evidence: {
        proposedConfidentiality: 'confidential', categories: ['customer_content'],
        allowedPurposes: ['acceptance_review'], allowedRegions: ['ap-southeast-1'],
        retentionClass: 'operational', minimumRetentionMs: 0, maximumRetentionMs: 86_400_000,
      },
      taskReport: {
        proposedConfidentiality: 'confidential', categories: ['customer_content'],
        allowedPurposes: ['acceptance_review'], allowedRegions: ['ap-southeast-1'],
        retentionClass: 'operational', minimumRetentionMs: 0, maximumRetentionMs: 86_400_000,
      },
      acceptanceProjection: {
        proposedConfidentiality: 'confidential', categories: ['customer_content'],
        allowedPurposes: ['acceptance_review'], allowedRegions: ['ap-southeast-1'],
        retentionClass: 'project_record', minimumRetentionMs: 0, maximumRetentionMs: 86_400_000,
      },
      journal: {
        proposedConfidentiality: 'confidential', categories: ['customer_content'],
        allowedPurposes: ['orchestration'], allowedRegions: ['ap-southeast-1'],
        retentionClass: 'project_record', minimumRetentionMs: 0, maximumRetentionMs: 86_400_000,
      },
    }, approvals: [],
  } as const;
  return createProjectDataGovernanceAuthority({
    ...candidate,
    governanceDecision: {
      decisionId: 'governance:decision-1', projectId: 'project-1',
      candidateDigest: digestCanonicalWorkroomValue(candidate),
      principalId: 'principal:data-steward', authorizedBy: 'data_steward', decidedAt: 1,
    },
  });
}

function recipientsRevision(authority: ReturnType<typeof projectAuthority>): number {
  return authority.sinks['sink:model']!.recipients.revision;
}

function recipientsDigest(authority: ReturnType<typeof projectAuthority>): string {
  return authority.sinks['sink:model']!.recipients.digest;
}

async function materializedFixture(authority: ReturnType<typeof projectAuthority>) {
  const root = join(tmpdir(), `zhin-governance-revalidation-${randomUUID()}`);
  await mkdir(root);
  const repository = new FileDataGovernanceAuthorityRepository(
    join(root, 'authority'), { verify: async () => true },
  );
  await repository.appendProject(authority, undefined);
  const vault = new EncryptedFilePayloadVault({
    directory: join(root, 'payloads'), generation: 5,
    cryptography: testCryptography(new Uint8Array(32).fill(9), 'kms:key-revalidation'),
  });
  const runtime = new WorkroomDataGovernanceRuntime({
    generation: 5, repository, vault, ...payloadInfrastructure(root, 5),
    signal: new AbortController().signal, now: () => 100,
  });
  const source = {
    version: 1 as const, ref: 'conversation-event:revalidation', digest: `sha256:${'a'.repeat(64)}`,
    sequence: 1, conversationKey: 'sandbox\0bot\0group\0room-1\0\0\0', eventId: 'revalidation',
    text: 'governed body', event: { timestamp: 100 } as never,
  };
  await runtime.planningDisclosure.materialize({
    version: 1, generation: createWorkroomDynamicPlanningGenerationSnapshot(5),
    input: {
      version: 1, operationId: 'operation:fixture', projectId: authority.projectId,
      projectRevision: 'catalog:1', projectDigest: `sha256:${'b'.repeat(64)}`,
      orchestratorAgentDefinitionId: 'agent:orchestrator',
      orchestratorAuthorityDigest: `sha256:${'c'.repeat(64)}`,
      principalId: 'principal:sponsor-1', source,
    },
    source: createWorkroomPlanningDisclosureSourceBinding(source),
    destinationKind: 'model_provider', purpose: 'orchestration',
  }, new AbortController().signal);
  const request = {
    operationId: 'operation:registered-fixture', projectId: authority.projectId,
    sourceRef: source.ref, sourceDigest: source.digest, sinkRuleId: 'sink:model',
    principalId: 'principal:sponsor-1',
  };
  const manifest = await runtime.disclosureManifest.materialize(request, new AbortController().signal);
  if (!manifest) throw new Error('Fixture Manifest was denied');
  const sourceAuthority = await repository.readSource(authority.projectId, source.ref, source.digest);
  if (!sourceAuthority) throw new Error('Fixture source authority was not persisted');
  return { request, manifest, sourceAuthority };
}

function testCryptography(secret: Uint8Array, keyId: string): PayloadVaultCryptographyPort {
  return {
    wrap: async ({ dataKey }) => ({
      keyId,
      wrappedKey: Buffer.from(dataKey.map((value, index) => value ^ secret[index % secret.length]!))
        .toString('base64'),
    }),
    unwrap: async ({ keyId: requested, wrappedKey }) => requested === keyId
      ? new Uint8Array(Buffer.from(wrappedKey, 'base64')
        .map((value, index) => value ^ secret[index % secret.length]!))
      : null,
  };
}

function payloadInfrastructure(
  root: string,
  generation: number,
  payloadWrites = new FileGovernedPayloadWriteSagaRepository(join(root, 'payload-write-sagas')),
  suffix = '',
) {
  const repository = suffix
    ? new FileGovernedPayloadWriteSagaRepository(join(root, `payload-write-sagas-${suffix}`))
    : payloadWrites;
  return {
    payloadWrites: repository,
    payloadLifecycleIndex: {
      register: async () => ({ digest: digestCanonicalWorkroomValue({ lifecycle: generation }) }),
    },
    payloadPurge: new GovernedPayloadWritePurgeConsumer({
      generation,
      repository,
      provider: {
        purge: async () => { throw new Error('test purge provider outcome unknown'); },
        reconcile: async () => { throw new Error('test purge provider outcome unknown'); },
      },
    }),
  };
}

function publication() {
  return Object.freeze({
    publish: async () => ({
      publicationDigest: digestCanonicalWorkroomValue({ version: 1, header: 'published' }),
    }),
  });
}
