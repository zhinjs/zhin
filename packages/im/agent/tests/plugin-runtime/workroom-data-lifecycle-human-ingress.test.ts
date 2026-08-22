import { describe, expect, it, vi } from 'vitest';
import {
  createWorkroomDataLifecycleHumanIngressControlPort,
} from '../../src/plugin-runtime/workroom-data-lifecycle-human-ingress.js';
import type { WorkroomDataLifecycleConsoleControlPort } from '../../src/plugin-runtime/workroom-data-lifecycle-console.js';
import type {
  HumanIngressTypedControlInput,
  HumanIngressTypedControlPort,
} from '../../src/workroom/human-ingress-orchestrator.js';

describe('Workroom Data Lifecycle Sponsor Room ingress', () => {
  it.each([
    ['/control data-lifecycle project project-1 hold place object-1 hold-1 legal_hold 20',
      { kind: 'place_hold', objectId: 'object-1', holdId: 'hold-1', reasonCode: 'legal_hold', reviewAt: 20 }],
    ['/control data-lifecycle project project-1 hold review object-1 hold-1 approve',
      { kind: 'review_hold', objectId: 'object-1', holdId: 'hold-1', approved: true }],
    ['/control data-lifecycle project project-1 hold release object-1 hold-1',
      { kind: 'release_hold', objectId: 'object-1', holdId: 'hold-1' }],
    ['/control data-lifecycle project project-1 erasure request tenant-1 subject@example.test',
      { kind: 'request_subject_erasure', tenantId: 'tenant-1', subjectRef: 'subject@example.test' }],
    ['/control data-lifecycle project project-1 export subject tenant-1 subject@example.test 50',
      { kind: 'export_subject', tenantId: 'tenant-1', subjectRef: 'subject@example.test', deadline: 50 }],
  ] as const)('derives exact scope for %s and returns only a content-free receipt', async (text, expected) => {
    const execute = vi.fn(async () => ({ status: 'ready' as const, projection: projection() }));
    const port = ingress({ execute });

    const result = await port.apply(input(text));

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      ...expected,
      operationId: 'human-ingress-application:proposal-1',
      projectId: 'project-1',
    }), { principalId: 'human:alice' }, expect.any(AbortSignal));
    expect(result).toMatchObject({
      status: 'authorized',
      receiptRef: expect.stringMatching(/^workroom-data-lifecycle:sha256:/u),
      receiptDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(JSON.stringify(result)).not.toMatch(/subject@example\.test|subjectRef|human:alice|payload|body/iu);
  });

  it('rejects ordinary Workroom control, extra grammar fields and root authorization denial', async () => {
    const execute = vi.fn(async () => ({ status: 'forbidden' as const }));
    const port = ingress({ execute });

    await expect(port.apply({ ...input('/control data-lifecycle hold release object-1 hold-1'),
      authorityRequirement: 'workroom_control' })).resolves.toMatchObject({
      status: 'clarification_required', reason: 'unauthorized_control',
    });
    await expect(port.apply(input('/control data-lifecycle project project-1 hold release object-1 hold-1 extra')))
      .resolves.toMatchObject({ status: 'clarification_required', reason: 'missing_control_target' });
    await expect(port.apply(input('/control data-lifecycle project project-1 hold release object-1 hold-1')))
      .resolves.toMatchObject({ status: 'clarification_required', reason: 'unauthorized_control' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('binds an aggregate Sponsor Room command to its explicit Project', async () => {
    const execute = vi.fn(async () => ({ status: 'ready' as const, projection: projection() }));
    const port = ingress({ execute });
    await expect(port.apply(input(
      '/control data-lifecycle project project-1 hold release object-1 hold-1',
      false,
    ))).resolves.toMatchObject({ status: 'authorized' });
    await expect(port.apply(input(
      '/control data-lifecycle project project-2 hold release object-1 hold-1',
    ))).resolves.toMatchObject({ status: 'clarification_required', reason: 'missing_control_target' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('requires an explicit Project even when replying to a governed card', async () => {
    const execute = vi.fn(async () => ({ status: 'ready' as const, projection: projection() }));
    const port = ingress({ execute });

    await expect(port.apply(input(
      '/control data-lifecycle hold release object-1 hold-1', false,
    ))).resolves.toMatchObject({ status: 'clarification_required', reason: 'missing_control_target' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('maps stale candidates without exposing projections and delegates plan-gate grammar unchanged', async () => {
    const execute = vi.fn(async () => ({ status: 'stale' as const, candidateDigest: 'sha256:candidate' }));
    const fallback: HumanIngressTypedControlPort = { apply: vi.fn(async () => ({
      status: 'authorized' as const, receiptRef: 'plan-gate:1', receiptDigest: `sha256:${'f'.repeat(64)}`,
    })) };
    const port = ingress({ execute }, fallback);

    await expect(port.apply(input('/control data-lifecycle project project-1 export subject tenant-1 subject@example.test 50')))
      .resolves.toMatchObject({ status: 'clarification_required', reason: 'stale_target' });
    await expect(port.apply(input('/control plan-gate approve run-1 task-1 gate-1')))
      .resolves.toMatchObject({ status: 'authorized', receiptRef: 'plan-gate:1' });
    expect(fallback.apply).toHaveBeenCalledTimes(1);
  });

  it('turns fixed missing Root control or export audit into terminal typed clarification', async () => {
    const absent = createWorkroomDataLifecycleHumanIngressControlPort({
      resolve: () => undefined,
      generationSignal: new AbortController().signal,
    });
    await expect(absent.apply(input('/control data-lifecycle project project-1 hold release object-1 hold-1')))
      .resolves.toMatchObject({ status: 'clarification_required', reason: 'unauthorized_control' });

    const unavailable = ingress({ execute: async () => ({
      status: 'unavailable', reason: 'subject_export_audit',
    }) });
    await expect(unavailable.apply(input(
      '/control data-lifecycle project project-1 export subject tenant-1 subject@example.test 50',
    ))).resolves.toMatchObject({ status: 'clarification_required', reason: 'missing_control_target' });
  });
});

function ingress(
  execute: Pick<WorkroomDataLifecycleConsoleControlPort, 'execute'>,
  fallback?: HumanIngressTypedControlPort,
) {
  return createWorkroomDataLifecycleHumanIngressControlPort({
    resolve: () => execute as WorkroomDataLifecycleConsoleControlPort,
    generationSignal: new AbortController().signal,
    ...(fallback ? { fallback } : {}),
  });
}

function input(text: string, reply = true): HumanIngressTypedControlInput {
  return {
    version: 1,
    operationId: 'human-ingress-application:proposal-1',
    projectId: 'project-1',
    projectRevision: 'catalog-1',
    projectDigest: `sha256:${'a'.repeat(64)}`,
    orchestratorAgentDefinitionId: 'orchestrator-1',
    orchestratorAuthorityDigest: `sha256:${'b'.repeat(64)}`,
    principalId: 'human:alice',
    authorityRequirement: 'typed_sponsor_control',
    text,
    ...(reply ? { projectionReply: {
      version: 1 as const,
      projectionId: 'projection-card',
      projectId: 'project-1',
      bindingRevision: 1,
      messageKey: 'adapter\0bot\0group\0sponsor\0project-card',
      targetDigest: `sha256:${'9'.repeat(64)}`,
    } } : {}),
    source: {
      version: 1, ref: 'conversation-event:message-1', digest: `sha256:${'c'.repeat(64)}`,
      sequence: 1, conversationKey: 'adapter\0bot\0group\0sponsor', eventId: 'message-1', text,
      event: { type: 'message.created', message: {
        ...(reply ? { replyTo: { id: 'project-card' } } : {}),
      } } as never,
    },
  };
}

function projection() {
  return {
    version: 1 as const, projectId: 'project-1', objectId: 'object-1', sequence: 1,
    stateDigest: `sha256:${'d'.repeat(64)}`, authorityDigest: `sha256:${'e'.repeat(64)}`,
    holds: [], erasures: [], purges: [], cryptoErased: false, purgeComplete: false,
    digest: `sha256:${'f'.repeat(64)}`,
  };
}
