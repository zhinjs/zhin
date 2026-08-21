import { describe, expect, it } from 'vitest';
import type { MessageGateway } from '@zhin.js/core/runtime';
import {
  createWorkroomProjectionMessageGatewayPort,
} from '../../src/plugin-runtime/workroom-projection-outbound.js';
import type { WorkroomProjectionOutboxItem } from '../../src/workroom/projection-outbox.js';

describe('Workroom Projection unified outbound', () => {
  const body = new TextEncoder().encode('[Developer · executor] build：正在执行');
  it('sends the durable projection through MessageGateway and preserves its canonical receipt', async () => {
    const requests: Parameters<MessageGateway['send']>[0][] = [];
    const gateway = {
      async send(request: Parameters<MessageGateway['send']>[0]) {
        requests.push(request);
        return {
          status: 'sent' as const,
          message: { conversation: request.conversation, id: 'platform-message-1' },
        };
      },
    } as MessageGateway;
    const port = createWorkroomProjectionMessageGatewayPort(
      gateway,
      '@zhin.js/agent' as Parameters<MessageGateway['send']>[0]['requester'],
    );

    const result = await port.send(item(), body, new AbortController().signal);

    expect(requests).toEqual([{
      requester: '@zhin.js/agent',
      conversation: item().conversation,
      content: '[Developer · executor] build：正在执行',
    }]);
    expect(result).toEqual({
      status: 'sent',
      message: { conversation: item().conversation, id: 'platform-message-1' },
    });
  });

  it.each([
    ['failed', true],
    ['suppressed', false],
    ['unsupported', false],
    ['rejected', false],
  ] as const)('turns unified %s receipts into explicit retry policy', async (status, retryable) => {
    const gateway = {
      async send() {
        return status === 'failed'
          ? { status, failure: { code: 'endpoint_timeout', message: 'timeout', retryable } }
          : { status, failure: { code: `projection_${status}`, message: status } };
      },
    } as MessageGateway;
    const port = createWorkroomProjectionMessageGatewayPort(
      gateway,
      '@zhin.js/agent' as Parameters<MessageGateway['send']>[0]['requester'],
    );

    await expect(port.send(item(), body, new AbortController().signal)).resolves.toEqual({
      status: 'failed',
      code: status === 'failed' ? 'endpoint_timeout' : `projection_${status}`,
      retryable,
    });
  });
});

function item(): WorkroomProjectionOutboxItem {
  return {
    version: 1,
    id: `projection:${'a'.repeat(64)}`,
    idempotencyKey: `projection:${'a'.repeat(64)}`,
    digest: `sha256:${'b'.repeat(64)}`,
    projectId: 'project-1',
    runId: 'run-1',
    sourceEventIds: ['event-1'],
    sourceSequence: 4,
    bindingRevision: 3,
    projectionPolicyRevision: 2,
    conversation: {
      endpoint: { id: 'slack-main', adapter: '@zhin.js/adapter-slack' },
      kind: 'channel',
      id: 'project-1-room',
    },
    speaker: {
      principalId: 'agent:developer-1',
      agentDefinitionId: 'software.developer',
      displayName: 'Developer',
      role: 'executor',
    },
    kind: 'status',
    disclosure: disclosure(),
    target: {
      projectId: 'project-1',
      runId: 'run-1',
      taskKey: 'build',
      taskRevision: 1,
      assignmentId: 'assignment-1',
      agentDefinitionId: 'software.developer',
    },
    delivery: { status: 'leased', attempts: 1, fence: 1 },
  };
}

function disclosure(): WorkroomProjectionOutboxItem['disclosure'] {
  const handle = {
    version: 1 as const,
    vaultObjectId: 'vault:projection-1', objectId: 'projection-source:1',
    payloadHash: `sha256:${'c'.repeat(64)}`, descriptorDigest: `sha256:${'d'.repeat(64)}`,
    tenantId: 'tenant-1', projectId: 'project-1', locationManifestDigest: `sha256:${'e'.repeat(64)}`,
  };
  return {
    request: {
      operationId: 'projection:project-1:run-1:4', projectId: 'project-1',
      sourceRef: handle.objectId, sourceDigest: handle.payloadHash,
      sinkRuleId: 'projection:workroom', principalId: 'principal:projection-service',
    },
    manifest: {
      version: 1, id: 'disclosure-manifest:1', digest: `sha256:${'f'.repeat(64)}`,
      requestDigest: `sha256:${'1'.repeat(64)}`,
      source: {
        objectId: handle.objectId, payloadHash: handle.payloadHash,
        descriptorDigest: handle.descriptorDigest, lineageDigest: `sha256:${'2'.repeat(64)}`, handle,
      },
      output: { handle, payloadHash: handle.payloadHash, mode: 'full', subjectLinked: false },
      channel: 'workroom_projection', purpose: 'workroom_awareness',
      principal: { principalId: 'principal:projection-service' },
      destination: {
        id: 'destination:projection', contractDigest: `sha256:${'3'.repeat(64)}`,
        recipientRevision: 1, recipientDigest: `sha256:${'4'.repeat(64)}`,
        loggingMode: 'metadata_only', allowsRedisclosure: false, supportsDeletion: true,
      },
      policy: { revision: 1, digest: `sha256:${'5'.repeat(64)}` },
      approvalIds: [], expiresAt: 1_000_000,
    },
  };
}
