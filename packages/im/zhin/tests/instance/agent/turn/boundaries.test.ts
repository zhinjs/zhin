import { describe, expect, it, vi } from 'vitest';
import { Message, type ImRuntime } from '@zhin.js/core/runtime';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import type { UserInteractionRequest } from '@zhin.js/im-contract';
import type { AITriggerConfig } from '@zhin.js/core';
import { turnIntentResolverToken } from '@zhin.js/agent/runtime';
import { adapterFeatureId, resolveTurnCapabilities, type AdapterCapabilityProfile } from '@zhin.js/adapter';
import {
  createDeterministicApprovalPort,
  createRuntimeApprovalPort,
  createRuntimeQuestionPort,
  createRuntimeTurnAccess,
  createRuntimeTurnRequest,
  deliveryOutcomeFromReceipt,
  isPlainTextRuntimeMessage,
  resolveProductTurnIntent,
  resolveRuntimeSenderRoles,
  resolveRuntimeTurnCapabilities,
  resolveRuntimeTurnContextState,
  resolveRuntimeTurnIntent,
  resolveSnapshotTurnIntentResolver,
  runtimeApprovalPolicy,
  runtimeImSessionKey,
} from '@zhin.js/agent/runtime';
import {
  renderTriggerError,
  resolveTriggerTimeoutMs,
  routeSpecialistAgent,
  withTriggerTimeout,
} from '@zhin.js/agent/runtime';
import { readConfiguredEndpointKeys } from '../../../../src/instance/start-command.js';
import { readLegacyChatRoleConfig } from '../../../../src/instance/chat-role-migration.js';

/** A declared profile (not a legacy-derived one): group scene lookups are usable, private ones are not. */
const sceneProfile = { group: { scene: { groupInfo: true, memberProfile: true } } };

const adapter = capabilityId(rootPluginId(), featureId('zhin.adapter'), 'icqq');

describe('Workroom Orchestrator turn routing', () => {
  const support = {
    $feature: 'zhin.agent/1' as const,
    name: 'support',
    qualifiedName: 'root/support',
    displayName: 'Support', version: '1.0.0',
    description: 'support',
    triggerRules: { filePatterns: [], keywords: [] },
    entryPoints: ['system.md', 'boundaries.md', 'conventions.md'], workflows: [], knowledge: [],
    instructions: 'help',
    owner: rootPluginId(),
    source: '/agents/support.md',
  };

  const icqq = {
    ...support,
    name: 'icqq',
    qualifiedName: 'adapter-icqq__icqq',
    platforms: ['icqq'],
  };

  it('pins a Workroom continuation to the catalog Orchestrator', () => {
    expect(routeSpecialistAgent('处理这个问题', { agents: [support] }, 'support', 'zhin'))
      .toEqual({ userText: '处理这个问题', agent: support });
  });

  it('uses the default binding when it is the catalog Orchestrator', () => {
    expect(routeSpecialistAgent('处理这个问题', { agents: [support] }, 'zhin', 'zhin'))
      .toEqual({ userText: '处理这个问题' });
  });

  it('selects the sole specialist for the ingress platform', () => {
    expect(routeSpecialistAgent('查询群列表', { agents: [support, icqq] }, undefined, 'zhin', 'icqq'))
      .toEqual({ userText: '查询群列表', agent: icqq });
  });

  it('keeps an explicit specialist mention ahead of platform routing', () => {
    expect(routeSpecialistAgent('@support 处理这个问题', { agents: [support, icqq] }, undefined, 'zhin', 'icqq'))
      .toEqual({ userText: '处理这个问题', agent: support });
  });

  it('rejects ambiguous specialists for one platform', () => {
    expect(() => routeSpecialistAgent('查询群列表', {
      agents: [icqq, { ...icqq, name: 'qq-admin', qualifiedName: 'adapter-icqq__qq-admin' }],
    }, undefined, 'zhin', 'icqq')).toThrow('Multiple specialist Agents target platform icqq');
  });
});

describe('Plugin Runtime Tool policy bridge', () => {
  it('requires a fresh human answer even for master and previously remembered permission', async () => {
    const ask = vi.fn(async (_input: UserInteractionRequest) => 'approve-once' as never);
    const memory = { recall: vi.fn(() => true), remember: vi.fn() };
    const port = createRuntimeApprovalPort({ isMaster: true, memory,
      interaction: { ask, async sequence() { return {} as never; } } });
    const request = { requestId: 'kick', toolName: 'group_kick', humanOnly: true,
      conversationScope: 'group' as const, question: '踢出群 129043431 的 123？', signal: new AbortController().signal };
    await expect(port.requestApproval(request)).resolves.toBe(true);
    await expect(port.requestApproval(request)).resolves.toBe(true);
    expect(ask).toHaveBeenCalledTimes(2);
    expect(memory.recall).not.toHaveBeenCalled(); expect(memory.remember).not.toHaveBeenCalled();
    const prompt = ask.mock.calls[0]?.[0];
    if (prompt?.type !== 'select') throw new Error('Expected the real approval choice question');
    expect(prompt.options.map(option => option.value)).toEqual(['reject', 'approve-once']);
    expect(runtimeApprovalPolicy('human')).toBe('human');
  });
  it('preserves never/on-risk/always for the Agent approval gate', () => {
    expect(runtimeApprovalPolicy('never')).toBe('never');
    expect(runtimeApprovalPolicy('on-risk')).toBe('on-risk');
    expect(runtimeApprovalPolicy('always')).toBe('always');
  });

  it('provides deterministic CLI approval ports with deny as the default', async () => {
    const input = {
      requestId: 'r1', toolName: 'danger', question: 'continue?', signal: new AbortController().signal,
    };
    await expect(createDeterministicApprovalPort().requestApproval(input)).resolves.toBe(false);
    await expect(createDeterministicApprovalPort('approve').requestApproval(input)).resolves.toBe(true);
    await expect(createDeterministicApprovalPort('approve').requestApprovalOutcome({ ...input, humanOnly: true }))
      .resolves.toMatchObject({ status: 'unavailable' });
  });
});

describe('runtime reply delivery outcome bridge', () => {
  it('preserves transport uncertainty independently of an identical failure code', () => {
    for (const deliveryUnknown of [undefined, true] as const) {
      expect(deliveryOutcomeFromReceipt({ status: 'failed', failure: {
        code: 'sandbox_delivery_unavailable', message: 'unavailable', ...(deliveryUnknown ? { deliveryUnknown } : {}),
      } })).toEqual({ status: 'failed', code: 'sandbox_delivery_unavailable', retryable: false,
        ...(deliveryUnknown ? { deliveryUnknown } : {}) });
    }
  });
  it('preserves non-sent receipts instead of coercing them to sent', () => {
    expect(deliveryOutcomeFromReceipt({ status: 'suppressed' })).toEqual({ status: 'suppressed' });
    expect(deliveryOutcomeFromReceipt({
      status: 'rejected',
      failure: { code: 'outbound_payload_rejected', message: 'bad payload' },
    })).toEqual({ status: 'rejected', code: 'outbound_payload_rejected' });
    expect(deliveryOutcomeFromReceipt({
      status: 'failed',
      failure: { code: 'endpoint_send_failed', message: 'transport closed', retryable: true },
    })).toEqual({ status: 'failed', code: 'endpoint_send_failed', retryable: true });
  });

  it('maps successful receipts to sent with message id when available', () => {
    expect(deliveryOutcomeFromReceipt({
      status: 'sent',
      outboundTextDigest: '9b0f1b10aff55228716a1fbbc59bda8fe735ed14ccd5e2c5226a9ab72a48d47e',
      message: {
        conversation: {
          endpoint: { id: 'sandbox~main', adapter: 'sandbox' },
          kind: 'private',
          id: 'user-1',
        },
        id: 'message-1',
      },
    }, 'planned')).toEqual({ status: 'sent', messageId: 'message-1', messages: [{
      conversation: { endpoint: { id: 'sandbox~main', adapter: 'sandbox' }, kind: 'private', id: 'user-1' }, id: 'message-1',
    }], messageContexts: [{
      message: { conversation: { endpoint: { id: 'sandbox~main', adapter: 'sandbox' }, kind: 'private', id: 'user-1' }, id: 'message-1' }, plannedText: 'planned',
    }] });
  });
  it('does not claim planned text when final delivery content is unknown or different', () => {
    const message = { conversation: { endpoint: { id: 'main', adapter: 'sandbox' }, kind: 'private' as const, id: 'user' }, id: 'native' };
    expect(deliveryOutcomeFromReceipt({ status: 'sent', message }, 'planned')).toEqual({ status: 'sent', messageId: 'native', messages: [message] });
    expect(deliveryOutcomeFromReceipt({ status: 'sent', message, outboundTextDigest: 'different-body' }, 'planned'))
      .toEqual({ status: 'sent', messageId: 'native', messages: [message] });
  });

  it('keeps ordered known part identities across unknown slots and partial delivery', () => {
    const conversation = { endpoint: { id: 'bot', adapter: 'icqq' }, kind: 'group' as const, id: 'room' };
    const refs = ['first', 'last'].map(id => ({ conversation, id }));
    const parts = [{ message: refs[0] }, {}, { message: refs[1] }];
    expect(deliveryOutcomeFromReceipt({ status: 'sent', message: refs[0], parts }))
      .toEqual({ status: 'sent', messageId: 'first', messages: [refs[0], null, refs[1]] });
    expect(deliveryOutcomeFromReceipt({ status: 'failed', message: refs[0], parts,
      failure: { code: 'partial_delivery', message: 'later part failed', retryable: true } }))
      .toEqual({ status: 'failed', code: 'partial_delivery', retryable: false, messages: [refs[0], null, refs[1]] });
    for (const status of ['rejected', 'unsupported'] as const) {
      expect(deliveryOutcomeFromReceipt({ status, message: refs[0], parts,
        failure: { code: 'later_part_rejected', message: 'later part rejected' } }))
        .toEqual({ status, code: 'later_part_rejected', messages: [refs[0], null, refs[1]] });
    }
  });
});

describe('turn admission message classification (#725)', () => {
  it('treats text-only messages as mergeable', () => {
    expect(isPlainTextRuntimeMessage(makeMessage({
      content: 'hello',
      segments: [{ type: 'text', data: { text: 'hello' } }],
    }))).toBe(true);
  });

  it('keeps quoted, forwarded and media messages out of merges', () => {
    expect(isPlainTextRuntimeMessage(makeMessage({ content: 'see this', replyTo: { id: 'q1' } }))).toBe(false);
    expect(isPlainTextRuntimeMessage(makeMessage({
      content: '[forward]',
      segments: [{ type: 'forward', data: { forward_id: 'f1' } }],
    }))).toBe(false);
    expect(isPlainTextRuntimeMessage(makeMessage({
      content: '[image]',
      segments: [{ type: 'image', data: { media: { kind: 'url', value: 'https://example.com/a.png', mime_type: 'image/png' } } }],
    }))).toBe(false);
  });
});

describe('canonical IM TurnRequest ingress', () => {
  it('uses the receiving generation and exact Endpoint account without trusting metadata', async () => {
    const message = makeMessage({
      content: 'hello',
      metadata: { endpoint: 'configured-name', selfId: 'forged-account', contextState: { bot: { id: 'forged-account' } } },
    });
    const endpointId = message.conversation.endpoint.id;
    const connection = vi.fn((adapterKey, endpointKey) => adapterKey === endpointId && endpointKey === endpointId
      ? { identity: message.conversation.endpoint, selfUserId: 'platform-account' }
      : undefined);
    const snapshot = { projections: new Map([[adapterFeatureId, { $projection: 'zhin.adapter-index/1', capabilityProfile: () => ({}), connection }]]) };
    const signal = new AbortController().signal;
    const state = await resolveRuntimeTurnContextState({ snapshot: snapshot as never, conversation: message.conversation, signal });
    const request = createRuntimeTurnRequest({ message, text: 'hello', roles: { isMaster: false, isTrusted: false } }, {
      traceId: 'trace', turnId: 'turn', signal: new AbortController().signal,
      projectRoot: '/workspace', workspaceRoot: '/workspace', ports: {}, intent: { kind: 'new' }, contextState: state,
    });

    expect(connection).toHaveBeenCalledExactlyOnceWith(endpointId, endpointId);
    expect(request.input.contextState).toEqual({ bot: { id: 'platform-account' } });
    expect(Object.isFrozen(state?.bot)).toBe(true);
    const nextGeneration = { projections: new Map([[adapterFeatureId, {
      $projection: 'zhin.adapter-index/1', capabilityProfile: () => ({}), connection: () => ({ identity: message.conversation.endpoint, selfUserId: 'replacement-account' }),
    }]]) };
    expect(await resolveRuntimeTurnContextState({ snapshot: nextGeneration as never, conversation: message.conversation, signal })).toEqual({ bot: { id: 'replacement-account' } });
    expect(request.input.contextState?.bot?.id).toBe('platform-account');
  });

  it('leaves unknown platform state absent even when configuration and metadata look like accounts', async () => {
    const message = makeMessage({ content: 'hello', metadata: {
      endpoint: '10001', self_id: '20002', botRole: 'owner', muteAll: false,
    } });
    const unknownAccount = { projections: new Map([[adapterFeatureId, {
      $projection: 'zhin.adapter-index/1', capabilityProfile: () => ({}), connection: () => ({ identity: message.conversation.endpoint, name: '10001' }),
    }]]) };
    const signal = new AbortController().signal;
    expect(await resolveRuntimeTurnContextState({ snapshot: unknownAccount as never, conversation: message.conversation, signal })).toBeUndefined();
    expect(await resolveRuntimeTurnContextState({ snapshot: { projections: new Map() }, conversation: message.conversation, signal })).toBeUndefined();
    const request = createRuntimeTurnRequest({ message, text: 'hello', roles: { isMaster: true, isTrusted: false } }, {
      traceId: 'trace', turnId: 'turn', signal: new AbortController().signal,
      projectRoot: '/workspace', workspaceRoot: '/workspace', ports: {}, intent: { kind: 'new' },
    });
    expect(request.input.contextState).toBeUndefined();
  });

  it('computes ADR 0044 platform capabilities once from the resolved facts and attaches them to the turn input', async () => {
    const message = makeMessage({ content: 'hello', metadata: { endpoint: '10001' } });
    const profile: AdapterCapabilityProfile = {
      default: { delivery: { send: true }, actions: { poke: { scopes: ['group'] } } },
      group: { actions: { mute: { scopes: ['group'], requiresRole: 'admin' } } },
    };
    const turnCapabilities = vi.fn((_id: string, input: Parameters<typeof resolveTurnCapabilities>[0] extends infer T
      ? Omit<T & object, 'profile' | 'narrow'> : never) => resolveTurnCapabilities({ ...input, profile }));
    const snapshot = { projections: new Map([[adapterFeatureId, {
      $projection: 'zhin.adapter-index/1', capabilityProfile: () => sceneProfile, turnCapabilities,
    }]]) } as never;
    const asAdmin = resolveRuntimeTurnCapabilities(snapshot, message.conversation, { bot: { id: 'b', platformRole: 'admin' } });
    const asMember = resolveRuntimeTurnCapabilities(snapshot, message.conversation, { bot: { id: 'b', platformRole: 'member' } });
    expect(asAdmin?.has('actions.mute')).toBe(true);
    expect(asMember?.has('actions.mute')).toBe(false);
    expect(asMember?.has('actions.poke')).toBe(true);
    expect(turnCapabilities.mock.calls[0]?.[0]).toBe(message.conversation.endpoint.id);
    expect(resolveRuntimeTurnCapabilities({ projections: new Map() }, message.conversation, undefined)).toBeUndefined();

    const request = createRuntimeTurnRequest({ message, text: 'hello', roles: { isMaster: false, isTrusted: false } }, {
      traceId: 'trace', turnId: 'turn', signal: new AbortController().signal,
      projectRoot: '/workspace', workspaceRoot: '/workspace', ports: {}, intent: { kind: 'new' }, platformCapabilities: asAdmin,
    });
    expect(request.input.platformCapabilities).toBe(asAdmin);
    expect(request.input.platformCapabilities?.has('actions.mute')).toBe(true);
    expect(createRuntimeTurnRequest({ message, text: 'hello', roles: { isMaster: false, isTrusted: false } }, {
      traceId: 'trace', turnId: 'turn', signal: new AbortController().signal,
      projectRoot: '/workspace', workspaceRoot: '/workspace', ports: {}, intent: { kind: 'new' },
    }).input.platformCapabilities).toBeUndefined();
  });

  it.each(['owner', 'admin', 'member'] as const)('propagates the queried Bot %s role through capability access', async platformRole => {
    const message = makeMessage({ content: 'hello', metadata: { endpoint: 'configured-name' } });
    const conversation = { ...message.conversation, endpoint: { ...message.conversation.endpoint, adapter: 'icqq' } };
    const inspectGroupMember = vi.fn(async () => ({ canModerate: false, platformRole }));
    const snapshot = { projections: new Map([[adapterFeatureId, {
      $projection: 'zhin.adapter-index/1', capabilityProfile: () => sceneProfile, connection: () => ({ identity: conversation.endpoint, selfUserId: '8596238' }), management: () => ({ inspectGroupMember }),
    }]]) };
    const signal = new AbortController().signal;
    const contextState = await resolveRuntimeTurnContextState({ snapshot: snapshot as never, conversation, signal });
    expect(inspectGroupMember).toHaveBeenCalledExactlyOnceWith({ groupId: '100', userId: '8596238', signal });
    expect(createRuntimeTurnAccess(message, { isMaster: false, isTrusted: false }, contextState).input)
      .toEqual({ contextState: { bot: { id: '8596238', platformRole } } });
  });

  it.each([
    { adapter: 'icqq', kind: 'private', profile: sceneProfile },
    { adapter: 'icqq', kind: 'channel', profile: sceneProfile },
    { adapter: 'telegram', kind: 'group', profile: {} },
  ] as const)('does not query a Bot role where the profile declares no scene lookup: %j', async scope => {
    const inspectGroupMember = vi.fn();
    const conversation = { endpoint: { id: 'endpoint', adapter: scope.adapter }, kind: scope.kind, id: 'scene' };
    const snapshot = { projections: new Map([[adapterFeatureId, {
      $projection: 'zhin.adapter-index/1', capabilityProfile: () => scope.profile, connection: () => ({ identity: conversation.endpoint, selfUserId: 'actual-account' }), management: () => ({ inspectGroupMember }),
    }]]) };
    expect(await resolveRuntimeTurnContextState({ snapshot: snapshot as never, conversation, signal: new AbortController().signal }))
      .toEqual({ bot: { id: 'actual-account' } });
    expect(inspectGroupMember).not.toHaveBeenCalled();
  });

  it('keeps unsupported, unavailable and failed role reads distinct from a member role', async () => {
    const conversation = { endpoint: { id: 'endpoint', adapter: 'icqq' }, kind: 'group' as const, id: '100' };
    const signal = new AbortController().signal;
    const snapshot = (management?: object) => ({ projections: new Map([[adapterFeatureId, {
      $projection: 'zhin.adapter-index/1', capabilityProfile: () => sceneProfile, connection: () => ({ identity: conversation.endpoint, selfUserId: '8596238' }), management: () => management,
    }]]) });
    expect(await resolveRuntimeTurnContextState({ snapshot: snapshot() as never, conversation, signal }))
      .toEqual({ bot: { id: '8596238', platformRoleError: 'unsupported' } });
    expect(await resolveRuntimeTurnContextState({ snapshot: snapshot({ inspectGroupMember: async () => ({ canModerate: false }) }) as never, conversation, signal }))
      .toEqual({ bot: { id: '8596238', platformRoleError: 'unavailable' } });
    expect(await resolveRuntimeTurnContextState({ snapshot: snapshot({ inspectGroupMember: async () => { throw new Error('member lookup failed'); } }) as never, conversation, signal }))
      .toEqual({ bot: { id: '8596238', platformRoleError: 'lookup_failed' } });
  });

  it('defaults shared-session overlap to supersede and permits an explicit FIFO policy', () => {
    const message = makeMessage({
      content: 'next', sender: { id: 'u' }, metadata: { endpoint: 'bot' },
    });

    expect(resolveRuntimeTurnIntent(message)).toEqual({ kind: 'supersede' });
    expect(resolveRuntimeTurnIntent(message, 'fifo')).toEqual({ kind: 'new' });
    expect(resolveRuntimeTurnIntent(makeMessage({
      content: 'private next',
      target: 'private:u',
      sender: { id: 'u' },
      metadata: { endpoint: 'bot' },
    }), 'fifo')).toEqual({ kind: 'supersede' });
  });

  it('rejects product-policy authorization asserted by message metadata', () => {
    const message = makeMessage({
      content: 'steer',
      sender: { id: 'u' },
      metadata: {
        endpoint: 'bot',
        turnIntent: { kind: 'steer', targetTurnId: 'active', authorizedBy: 'product_policy' },
      },
    });

    expect(() => resolveRuntimeTurnIntent(message)).toThrow('trusted product policy');
  });

  it('accepts cross-participant authorization only from the trusted host resolver', async () => {
    const message = makeMessage({
      content: 'steer', sender: { id: 'bob' }, metadata: { endpoint: 'bot' },
    });
    const resolver = vi.fn(async ({ defaultIntent }) => ({
      ...defaultIntent,
      kind: 'steer' as const,
      targetTurnId: 'turn-alice',
      authorizedBy: 'product_policy' as const,
    }));

    await expect(resolveProductTurnIntent(
      message,
      { isMaster: false, isTrusted: true },
      'supersede',
      resolver,
    )).resolves.toEqual({
      kind: 'steer', targetTurnId: 'turn-alice', authorizedBy: 'product_policy',
    });
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({
      senderRoles: { isMaster: false, isTrusted: true },
      defaultIntent: { kind: 'supersede' },
    }));
  });

  it('loads the endpoint-owning plugin intent policy from the fixed snapshot', () => {
    const requester = rootPluginId();
    const resolver = vi.fn(() => ({ kind: 'observe' as const }));
    const snapshot = {
      resources: new Map([[requester, new Map([
        [turnIntentResolverToken.id, resolver],
      ])]]),
    };

    expect(resolveSnapshotTurnIntentResolver(snapshot, requester)).toBe(resolver);
  });

  it('maps runtime identity, scene, media, policy, and session without classic Message fields', async () => {
    const message = makeMessage({
      content: 'look',
      target: 'group:100',
      sender: { id: 'user-1', name: 'Alice' },
      metadata: { endpoint: '10001' },
      replyTo: { id: 'quoted-1' },
      segments: [
        { type: 'image', data: { media: { kind: 'url', value: 'https://example.com/a.png', mime_type: 'image/png' } } },
        { type: 'forward', data: { forward_id: 'forward-1' } },
      ],
    });
    const signal = new AbortController().signal;
    const readConversationContext = vi.fn(async () => ({ blocks: [], cursor: 0 }));
    const commitConversationContext = vi.fn(async (_consumer: string, _cursor: number) => undefined);
    const request = createRuntimeTurnRequest({ message, text: 'look closer', roles: {
      isMaster: false,
      isTrusted: true,
    } }, {
      traceId: 'trace-1',
      turnId: 'turn-1',
      signal,
      projectRoot: '/workspace', workspaceRoot: '/workspace',
      network: { enabled: true, httpsOnly: true, allowedDomains: ['example.com'] },
      ports: {}, intent: { kind: 'new' },
      resolveReference: async (reference) => reference.kind === 'forward'
        ? ({
            status: 'resolved',
            reference,
            value: Array.from({ length: 4 }, (_, index) => ({
              actor: { id: `user-${index}` },
              segments: [{ type: 'text', data: { text: `entry-${index}-long` } }],
            })),
          } as const)
        : ({ status: 'unsupported', code: 'test' } as const),
      readConversationContext,
      commitConversationContext,
    });

    expect(request).toMatchObject({
      identity: { traceId: 'trace-1', turnId: 'turn-1' },
      origin: {
        kind: 'im',
        platform: 'icqq',
        endpoint: '10001',
        scope: 'group',
        sceneId: '100',
        messageId: 'm1',
      },
      principal: { subjectId: 'user-1', displayName: 'Alice', roles: ['trusted'] },
      input: {
        text: 'look closer',
        media: [{
          kind: 'image',
          source: { kind: 'url', value: 'https://example.com/a.png' },
          mimeType: 'image/png',
        }],
        references: [
          { key: 'ref-1', kind: 'message', sourceId: 'quoted-1' },
          { key: 'ref-2', kind: 'forward', sourceId: 'forward-1' },
        ],
      },
      session: { key: runtimeImSessionKey(createRuntimeTurnAccess(message, { isMaster: false, isTrusted: true }), '/workspace') },
      policy: {
        permissions: ['trusted'],
        unattended: false,
        filesystem: { workspaceRoot: '/workspace' },
        network: { enabled: true, httpsOnly: true, allowedDomains: ['example.com'] },
      },
    });
    expect(request.signal).toBe(signal);
    await request.ports.conversationContext?.readPending(signal);
    await request.ports.conversationContext?.commit(3);
    expect(readConversationContext).toHaveBeenCalledWith(`agent-session:${request.session.key}`, signal);
    expect(commitConversationContext).toHaveBeenCalledWith(`agent-session:${request.session.key}`, 3);
    await expect(request.ports.references?.resolve('ref-2', {
      depth: 2,
      maxEntries: 2,
      maxChars: 10,
    }, signal)).resolves.toMatchObject({
      status: 'resolved',
      truncated: true,
      content: expect.any(Array),
    });
    expect((await request.ports.references?.resolve('ref-2', {
      depth: 2,
      maxEntries: 2,
      maxChars: 10,
    }, signal) as { content: unknown[] }).content).toHaveLength(2);
  });

  it('fails closed when authenticated sender or endpoint identity is absent', () => {
    const signal = new AbortController().signal;
    const options = { traceId: 't', turnId: 'u', signal, projectRoot: '/workspace', workspaceRoot: '/workspace', ports: {}, intent: { kind: 'new' } } as const;
    expect(() => createRuntimeTurnRequest({ message: makeMessage({
      content: 'x', sender: null, metadata: { endpoint: 'bot' },
    }), text: 'x', roles: { isMaster: false, isTrusted: false } }, options)).toThrow('sender identity');
    expect(() => createRuntimeTurnRequest({ message: makeMessage({
      content: 'x', sender: 'u', metadata: {},
    }), text: 'x', roles: { isMaster: false, isTrusted: false } }, options)).toThrow('endpoint identity');
  });

  it('keeps platform role strings out of the principal roles (ADR 0056)', () => {
    const message = makeMessage({
      content: 'x', sender: { id: 'u', roles: ['owner', 'admin'] }, metadata: { endpoint: 'bot' },
    });
    const request = createRuntimeTurnRequest({ message, text: 'x', roles: {
      isMaster: false,
      isTrusted: true,
    } }, { traceId: 't', turnId: 'u', signal: new AbortController().signal, projectRoot: '/workspace', workspaceRoot: '/workspace', ports: {}, intent: { kind: 'new' } });
    expect(request.principal.roles).toEqual(['trusted']);
    expect(request.policy.permissions).toEqual(['trusted']);
  });

  it('uses a trusted Workroom envelope without exposing ordinary conversation context', () => {
    const message = makeMessage({
      content: '继续处理', sender: { id: 'sponsor' }, metadata: { endpoint: 'member-bot' },
    });
    const request = createRuntimeTurnRequest({ message, text: '继续处理', roles: {
      isMaster: false,
      isTrusted: true,
    } }, {
      traceId: 'trace-workroom', turnId: 'turn-workroom',
      signal: new AbortController().signal, projectRoot: '/workspace', workspaceRoot: '/workspace', ports: {},
      intent: { kind: 'new' },
      sessionKey: 'workroom:zhin:orchestrator:software.orchestrator',
      trustedMetadata: {
        workroom: {
          projectId: 'zhin', proposalId: 'proposal-1', disposition: 'discussion',
        },
      },
    });
    expect(request.session.key).toBe('workroom:zhin:orchestrator:software.orchestrator');
    expect(request.input.metadata).toMatchObject({
      workroom: { projectId: 'zhin', proposalId: 'proposal-1', disposition: 'discussion' },
    });
    expect(request.ports.conversationContext).toBeUndefined();
  });

  it('maps an explicit trusted runtime turn intent', () => {
    const message = makeMessage({
      content: 'more detail',
      sender: { id: 'u' },
      metadata: {
        endpoint: 'bot',
        turnIntent: { kind: 'follow_up', targetTurnId: 'active-turn' },
      },
    });
    const request = createRuntimeTurnRequest({ message, text: 'more detail', roles: {
      isMaster: false,
      isTrusted: false,
    } }, {
      traceId: 't',
      turnId: 'u',
      signal: new AbortController().signal,
      projectRoot: '/workspace', workspaceRoot: '/workspace',
      ports: {},
      intent: { kind: 'follow_up', targetTurnId: 'active-turn' },
    });
    expect(request.intent).toEqual({ kind: 'follow_up', targetTurnId: 'active-turn' });
  });
});

describe('canonical IM interaction adapter', () => {
  it('projects QuestionPort through the shared UserInteraction module', async () => {
    const ask = vi.fn(async (request: { type: string }) => {
      if (request.type === 'number') return 42;
      if (request.type === 'confirm') return false;
      if (request.type === 'select') return '生产环境';
      return '';
    });
    const interaction = {
      ask,
      sequence: vi.fn(async () => ({})),
    };
    const im = { createInteraction: vi.fn(() => interaction) } as unknown as ImRuntime;
    const questionMessage = makeMessageWithReply('start', []);
    const port = createRuntimeQuestionPort(im, questionMessage);
    await expect(port.ask({
      requestId: 'q1', question: 'How many?', type: 'number', signal: new AbortController().signal,
    })).resolves.toEqual({ type: 'number', value: 42 });
    expect(ask).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'number',
      title: 'How many?',
      signal: expect.any(AbortSignal),
    }));

    await expect(port.ask({
      requestId: 'q2', question: '确认发布？', type: 'confirm', signal: new AbortController().signal,
    })).resolves.toEqual({ type: 'confirm', value: false });
    expect(ask).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'confirm',
      title: '确认发布？',
      signal: expect.any(AbortSignal),
    }));

    await expect(port.ask({
      requestId: 'q3',
      question: '选择环境',
      type: 'pick',
      options: ['开发环境', '生产环境'],
      signal: new AbortController().signal,
    })).resolves.toEqual({ type: 'pick', value: '生产环境', index: 1 });
    expect(ask).toHaveBeenNthCalledWith(3, expect.objectContaining({
      type: 'select',
      title: '选择环境',
      options: [
        { label: '开发环境', value: '开发环境' },
        { label: '生产环境', value: '生产环境' },
      ],
      signal: expect.any(AbortSignal),
    }));
  });

  it('auto-approves master without asking UserInteraction', async () => {
    let asked = false;
    const port = createRuntimeApprovalPort({
      isMaster: true,
      interaction: {
        async ask() {
          asked = true;
          return false as never;
        },
        async sequence() { return {} as never; },
      },
    });
    await expect(port.requestApproval({
      requestId: 'a1',
      toolName: 'icqq__announce',
      question: 'continue?',
      signal: new AbortController().signal,
    })).resolves.toBe(true);
    expect(asked).toBe(false);
  });

  it('asks master via UserInteraction.ask when the sender is not master', async () => {
    const seen: Array<{ title: string; description?: string; tip?: string }> = [];
    const port = createRuntimeApprovalPort({
      isMaster: false,
      interaction: {
        async ask(request) {
          seen.push(request);
          expect(request.type).toBe('select');
          if (request.type === 'select') {
            // Timeouts must surface as timed_out rather than defaulting to a rejection.
            expect(request.default).toBeUndefined();
            expect(request.options?.[1]?.aliases).toEqual(['同意', '确认']);
            expect(request.options?.map(option => option.value)).toEqual([
              'reject',
              'approve-once',
              'approve-always',
            ]);
          }
          expect(request.signal).toBeDefined();
          return 'approve-once' as never;
        },
        async sequence() { return {} as never; },
      },
    });
    await expect(port.requestApproval({
      requestId: 'a2',
      toolName: 'icqq__announce',
      conversationScope: 'private',
      question: '工具「icqq__announce」需要确认后执行。是否继续？',
      signal: new AbortController().signal,
    })).resolves.toBe(true);
    expect(seen[0]?.title).toBe('操作确认');
    expect(seen[0]?.description).toContain('是否继续');
    expect(seen[0]?.tip).toContain('当前 Host 和会话');
  });

  it.each([
    ['UserInteractionTimeoutError', { status: 'timed_out' }],
    ['UserInteractionDeliveryError', { status: 'unavailable', reason: 'the approval prompt could not be delivered' }],
  ])('maps an approval prompt %s to a typed outcome instead of a user denial', async (name, expected) => {
    const port = createRuntimeApprovalPort({
      isMaster: false,
      interaction: {
        async ask() {
          const error = new Error('interaction ended');
          error.name = name;
          throw error;
        },
        async sequence() { return {} as never; },
      },
    });
    await expect(port.requestApprovalOutcome({
      requestId: 'a-outcome',
      toolName: 'read_file',
      conversationScope: 'private',
      question: 'continue?',
      signal: new AbortController().signal,
    })).resolves.toEqual(expected);
  });

  it('reports a missing approval surface as unavailable', async () => {
    const port = createRuntimeApprovalPort({ isMaster: false });
    await expect(port.requestApprovalOutcome({
      requestId: 'a-none',
      toolName: 'read_file',
      question: 'continue?',
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ status: 'unavailable' });
  });

  it('fails closed when a non-master has no master UserInteraction', async () => {
    const port = createRuntimeApprovalPort({ isMaster: false });
    expect(port.available).toBe(false);
    await expect(port.requestApproval({
      requestId: 'a3',
      toolName: 'icqq__announce',
      question: 'continue?',
      signal: new AbortController().signal,
    })).resolves.toBe(false);
  });

  it('rejects a conversation-wide decision returned for a private conversation', async () => {
    const port = createRuntimeApprovalPort({
      isMaster: false,
      interaction: {
        async ask() { return 'approve-session' as never; },
        async sequence() { return {} as never; },
      },
    });
    await expect(port.requestApproval({
      requestId: 'private-invalid-scope',
      sessionKey: 'private:123',
      conversationScope: 'private',
      requesterId: 'sender-a',
      toolName: 'bash',
      scopeKey: 'bash:test',
      question: 'continue?',
      signal: new AbortController().signal,
    })).resolves.toBe(false);
  });

  it('can remember only the same sender and operation within one sandbox session', async () => {
    const remembered = new Set<string>();
    const ask = vi.fn(async (_input: UserInteractionRequest) => 'approve-always' as never);
    const port = createRuntimeApprovalPort({
      isMaster: false,
      interaction: { ask, async sequence() { return {} as never; } },
      memory: {
        recall: (input) => remembered.has(`${input.sessionKey}:${input.requesterId}:${input.scopeKey ?? input.toolName}`)
          ? true
          : undefined,
        remember: (input, decision) => {
          if (decision === 'approve-always') {
            remembered.add(`${input.sessionKey}:${input.requesterId}:${input.scopeKey ?? input.toolName}`);
          }
        },
      },
    });
    const input = {
      requestId: 'session-approval',
      toolName: 'bash',
      sessionKey: 'group:123',
      conversationScope: 'group' as const,
      requesterId: 'sender-a',
      scopeKey: 'bash:{"command":"pnpm test"}',
      remember: 'session' as const,
      question: 'run cargo?',
      signal: new AbortController().signal,
    };
    await expect(port.requestApproval(input)).resolves.toBe(true);
    await expect(port.requestApproval({ ...input, requestId: 'session-approval-2' })).resolves.toBe(true);
    await expect(port.requestApproval({
      ...input,
      requestId: 'session-approval-3',
      scopeKey: 'bash:{"command":"pnpm build"}',
    })).resolves.toBe(true);
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[0]?.[0]).toMatchObject({
      type: 'select',
      options: [
        { value: 'reject' },
        { value: 'approve-once' },
        { value: 'approve-session' },
        { value: 'approve-always' },
      ],
    });
    expect(remembered).toContain('group:123:sender-a:bash:{"command":"pnpm test"}');
  });
});

/** 测试便利：legacy `kind:id` 串 → ConversationRef（仅测试侧组帧用）。 */
function conversationFromTarget(target: string) {
  const match = /^(private|group|channel):(.+)$/.exec(target);
  return {
    endpoint: { id: String(adapter), adapter: String(adapter).split('\0')[0]! },
    kind: (match?.[1] ?? 'private') as 'private' | 'group' | 'channel',
    id: match?.[2] ?? target,
  };
}

function makeMessage(input: {
  content: string;
  target?: string;
  sender?: string | { id: string; name?: string; roles?: readonly string[] } | null;
  metadata?: Record<string, unknown>;
  segments?: Message['segments'];
  replyTo?: { readonly id: string };
}): Message {
  const conversation = conversationFromTarget(input.target ?? 'group:100');
  const senderRef = input.sender === null
    ? undefined
    : typeof input.sender === 'object'
      ? input.sender
      : { id: input.sender ?? 'user-1', name: input.sender };
  return new Message(
    {
      conversation: conversation,
      content: input.content,
      sender: senderRef,
      metadata: Object.freeze(input.metadata ?? {}),
      segments: input.segments,
      message: { conversation, id: 'm1' },
      endpointId: typeof input.metadata?.endpoint === 'string' ? input.metadata.endpoint : undefined,
      replyTo: input.replyTo,
    },
    { generation: 1, reply: async () => ({ status: 'sent' as const }) },
  );
}

function makeMessageWithReply(content: string, delivered: string[]): Message {
  const conversation = conversationFromTarget('group:100');
  return new Message(
    {
      conversation: conversation,
      content: content,
      sender: { id: 'user-1', name: 'Alice' },
      metadata: Object.freeze({ endpoint: '10001' }),
      message: { conversation, id: `m${delivered.length + 1}` },
      endpointId: '10001',
    },
    {
      generation: 1,
      reply: async (output) => {
        delivered.push(String(output));
        return { status: 'sent' as const };
      },
    },
  );
}

function groupMessage(content: string, metadata?: Record<string, unknown>, sender?: string): Message {
  return makeMessage({
    content,
    sender,
    target: 'group:100',
    metadata: { channelType: 'group', endpoint: '10001', ...metadata },
  });
}

function privateMessage(content: string, metadata?: Record<string, unknown>): Message {
  return makeMessage({
    content,
    target: 'private:user-1',
    metadata: { channelType: 'private', endpoint: '10001', ...metadata },
  });
}

function roleApplication(configs: Record<string, unknown>) { return {configVersion: 2, plugins: Object.fromEntries(Object.keys(configs).map(key => [key, `@zhin.js/adapter-${key}`])), ...configs}; }

describe('缺口 3：ai.trigger timeout / errorTemplate', () => {
  it('timeout 默认 60000，配置生效，非法值回退默认', () => {
    expect(resolveTriggerTimeoutMs(undefined)).toBe(60_000);
    expect(resolveTriggerTimeoutMs({ timeout: 5_000 })).toBe(5_000);
    expect(resolveTriggerTimeoutMs({ timeout: 0 })).toBe(60_000);
    expect(resolveTriggerTimeoutMs({ timeout: Number.NaN })).toBe(60_000);
  });

  it('errorTemplate 默认 ❌ 模板并插值 {error}', () => {
    expect(renderTriggerError(undefined, 'boom')).toBe('❌ AI 处理失败: boom');
  });

  it('errorTemplate 自定义模板插值 {error}', () => {
    expect(renderTriggerError({ errorTemplate: 'ERR {error}' }, 'boom')).toBe('ERR boom');
    // 空白模板回退默认
    expect(renderTriggerError({ errorTemplate: '  ' }, 'boom')).toBe('❌ AI 处理失败: boom');
  });

  it('withTriggerTimeout：限时内完成则正常返回', async () => {
    const result = await withTriggerTimeout(async () => 'ok', 50);
    expect(result).toBe('ok');
  });

  it('withTriggerTimeout：signal-aware turn 会在超时后收到取消信号', async () => {
    let observedSignal: AbortSignal | undefined;
    await expect(withTriggerTimeout(
      (signal) => new Promise((_resolve, reject) => {
        observedSignal = signal;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
      20,
    )).rejects.toThrow('AI 处理超时（20ms）');
    expect(observedSignal?.aborted).toBe(true);
  });
});

describe('缺口 3：chat role → runtime sender roles (ADR 0056)', () => {
  const withRole = (chatRole?: 'owner' | 'admin' | 'trusted', userId: string | null = 'user-1') => makeMessage({
    content: 'hi', target: 'group:100', sender: userId === null ? null : { id: userId, ...(chatRole ? { chatRole } : {}) }, metadata: { endpoint: '10001' },
  });

  it('owner → isMaster; admin / trusted → isTrusted; none → nothing', () => {
    expect(resolveRuntimeSenderRoles(withRole('owner'))).toEqual({ isMaster: true, isTrusted: false });
    expect(resolveRuntimeSenderRoles(withRole('admin'))).toEqual({ isMaster: false, isTrusted: true });
    expect(resolveRuntimeSenderRoles(withRole('trusted'))).toEqual({ isMaster: false, isTrusted: true });
    expect(resolveRuntimeSenderRoles(withRole())).toEqual({ isMaster: false, isTrusted: false });
  });

  it.each(['userId', 'user_id', 'senderId', 'isMaster', 'roles'])('never grants from metadata.%s', (key) => {
    const message = makeMessage({ content: 'hi', target: 'group:100', sender: null, metadata: { endpoint: '10001', [key]: key === 'isMaster' ? true : 'forged-owner' } });
    expect(resolveRuntimeSenderRoles(message)).toEqual({ isMaster: false, isTrusted: false });
  });

  it('principal roles are the expanded chat roles, never platform role strings', () => {
    const message = makeMessage({ content: 'edit please', target: 'private:owner-x', sender: { id: 'owner-x', chatRole: 'owner', roles: ['member'] }, metadata: { endpoint: '知音' } });
    const roles = resolveRuntimeSenderRoles(message);
    expect(createRuntimeTurnAccess(message, roles).principal.roles).toEqual(['owner', 'admin', 'trusted']);
  });
});

describe('缺口 3：configured Endpoint keys and legacy people lists (ADR 0056 §3 migration)', () => {
  it('从候选配置读取 name 或 id 形式的 Endpoint key', async () => {
    await expect(readConfiguredEndpointKeys(roleApplication({
        icqq: { endpoints: [{ id: '10001' }] },
        slack: { endpoints: [{ id: 'ignored-id', name: 'workspace-bot' }] },
      }) as never)).resolves.toEqual(new Set(['icqq:10001', 'slack:workspace-bot']));
  });

  it('endpoints 缺省或为空时读取运行时创建的默认 Endpoint key', async () => {
    await expect(readConfiguredEndpointKeys(roleApplication({
        sandbox: {},
        icqq: { endpoints: [] },
      }) as never)).resolves.toEqual(new Set(['sandbox:sandbox', 'icqq:icqq']));
  });

  it('reads adapter-level master + trusted lists (arrays or strings) as adapter-level grants', () => {
    const legacy = readLegacyChatRoleConfig(roleApplication({ icqq: { master: 'u-owner', name: 'bot1', trusted: 't1, t2', endpoints: [] } }));
    expect(legacy.grants).toEqual([
      { level: 'adapter', key: 'icqq', adapter: 'icqq', userId: 'u-owner', role: 'owner', source: 'icqq.master' },
      { level: 'adapter', key: 'icqq', adapter: 'icqq', userId: 't1', role: 'trusted', source: 'icqq.trusted' },
      { level: 'adapter', key: 'icqq', adapter: 'icqq', userId: 't2', role: 'trusted', source: 'icqq.trusted' },
    ]);
    expect(legacy.paths).toEqual([['icqq', 'master'], ['icqq', 'trusted']]);
  });

  it('reads endpoints[].master / trusted as account-level grants, keyed by id (else name)', () => {
    const legacy = readLegacyChatRoleConfig(roleApplication({ icqq: { endpoints: [{ name: '10001', master: 'u-ep-master', trusted: 't3 t4' }, { id: 'b', master: 'm-b' }] } }));
    expect(legacy.grants.map(grant => `${grant.level}:${grant.key}:${grant.userId}:${grant.role}`)).toEqual([
      'endpoint:icqq/10001:u-ep-master:owner', 'endpoint:icqq/10001:t3:trusted', 'endpoint:icqq/10001:t4:trusted', 'endpoint:icqq/b:m-b:owner']);
    expect(legacy.paths).toEqual([['icqq', 'endpoints', '0', 'master'], ['icqq', 'endpoints', '0', 'trusted'], ['icqq', 'endpoints', '1', 'master']]);
  });

  it('endpoints[].owner 不是人员名单（owner/admin 是群身份或适配器自己的字段），保持不动', () => {
    const legacy = readLegacyChatRoleConfig(roleApplication({ qq: { endpoints: [{ name: '知音', owner: 'should-not-be-master', master: 'real-master' }] } }));
    expect(legacy.grants.map(grant => grant.userId)).toEqual(['real-master']);
    expect(legacy.paths).toEqual([['qq', 'endpoints', '0', 'master']]);
  });

  it('binds ai.trigger.masters / trusted to every configured adapter at the global level; owner wins over trusted', () => {
    const legacy = readLegacyChatRoleConfig({ ...roleApplication({ qq: { endpoints: [] }, tg: { endpoints: [] }, rss: { url: 'x' } }),
      ai: { trigger: { masters: ['g'], trusted: ['g', 'h'] } } });
    expect(legacy.grants.map(grant => `${grant.level}:${grant.adapter}:${grant.userId}:${grant.role}`)).toEqual([
      'global:qq:g:owner', 'global:tg:g:owner', 'global:qq:h:trusted', 'global:tg:h:trusted']);
    expect(legacy.paths).toEqual([['ai', 'trigger', 'masters'], ['ai', 'trigger', 'trusted']]);
  });

  it('createRuntimeTurnAccess 对非 human 来源抛错，human 写入 principal.origin', () => {
    const roles = { isMaster: false, isTrusted: false };
    const make = (origin?: string) => ({
      ...makeMessage({ content: 'hi', target: 'private:u1', sender: { id: 'u1', name: 'U' } }),
      endpointId: 'bot-1',
      ...(origin ? { origin } : {}),
    }) as never;
    for (const origin of ['peer_bot', 'member', 'self']) {
      expect(() => createRuntimeTurnAccess(make(origin), roles)).toThrow(/non-human origin/);
    }
    expect(createRuntimeTurnAccess(make('human'), roles).principal.origin).toBe('human');
    expect(createRuntimeTurnAccess(make(), roles).principal.origin).toBeUndefined();
  });

  it('rejects the removed roles.mappings blocks (adapter and account level) without compatibility', () => {
    const legacy = readLegacyChatRoleConfig(roleApplication({ qq: { roles: { mappings: [] }, endpoints: [{ id: 'bot-1', roles: { inherit: false } }] } }));
    expect(legacy.unsupported).toEqual(['qq.roles', 'qq.endpoints[0].roles']);
  });

  it('无 plugins 配置时没有可迁移的名单', () => {
    expect(readLegacyChatRoleConfig({ configVersion: 2 })).toEqual({ grants: [], paths: [], unsupported: [], skipped: [] });
  });

  it('拒绝旧 plugins 数组而不是按空配置继续启动', async () => {
    await expect(readConfiguredEndpointKeys({ plugins: ['@zhin.js/adapter-icqq'] } as never))
      .rejects.toThrow(/configVersion/);
  });
});
