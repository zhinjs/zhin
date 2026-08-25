import { describe, expect, it, vi } from 'vitest';
import { Message, type ImRuntime } from '@zhin.js/core/runtime';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import type { AITriggerConfig } from '@zhin.js/core';
import { turnIntentResolverToken } from '@zhin.js/agent/runtime';
import { MemoryWorkroomProjectionRepository } from '@zhin.js/agent';
import {
  classifyWorkroomIngressSource,
  ensureCatalogWorkroomProjectionBinding,
  createRuntimeTurnAccess,
  createRuntimeTurnRequest,
  createRuntimeQuestionPort,
  createRuntimeApprovalPort,
  resolveRuntimeTurnIntent,
  resolveProductTurnIntent,
  resolveSnapshotTurnIntentResolver,
  resolveRuntimeSenderRoles,
  resolveTriggerTimeoutMs,
  renderTriggerError,
  createDeterministicApprovalPort,
  runtimeApprovalPolicy,
  withTriggerTimeout,
  deliveryOutcomeFromReceipt,
  assertFixedWorkroomStorageMode,
  assertWorkroomCatalogMatchesGeneration,
  createCatalogWorkroomProjectionBinding,
  createCatalogSponsorRoomProjectionBinding,
  resolveCatalogSponsorProjectionConversation,
  resolveWorkroomStorageMode,
  routeSpecialistAgent,
  resolveIndexedProjectionReply,
} from '../../src/plugin-runtime/agent-host-installer.js';
import {
  createEndpointRoleResolver,
  readConfiguredEndpointKeys,
} from '../../src/plugin-runtime/start-command.js';

const adapter = capabilityId(rootPluginId(), featureId('zhin.adapter'), 'icqq');

describe('Workroom ingress source ownership', () => {
  const definition = {
    name: 'Zhin',
    members: [
      { agent: 'zhin', role: 'orchestrator' as const },
      {
        agent: 'reviewer', role: 'reviewer' as const,
        messageRoute: { adapter: 'icqq', endpoint: '329158210' },
      },
    ],
    conversation: {
      adapter: 'icqq', endpoint: '8596238', kind: 'group' as const,
      id: '1108417575', agent: 'zhin',
    },
  };

  it('rejects numeric configured Bot principals and trusted bot metadata before human ingress', () => {
    expect(classifyWorkroomIngressSource(definition, {
      adapter: 'icqq', endpoint: '329158210', senderId: '8596238', space: 'workroom',
    })).toBe('bot_principal');
    expect(classifyWorkroomIngressSource(definition, {
      adapter: 'icqq', endpoint: '8596238', senderId: '329158210', space: 'workroom',
    })).toBe('bot_principal');
    const aliasDefinition = structuredClone(definition);
    aliasDefinition.conversation.adapter = 'slack';
    aliasDefinition.conversation.endpoint = 'main';
    expect(classifyWorkroomIngressSource(aliasDefinition, {
      adapter: 'slack', endpoint: 'main', senderId: 'main', space: 'workroom',
    })).toBe('accept');
    expect(classifyWorkroomIngressSource(aliasDefinition, {
      adapter: 'slack', endpoint: 'main', senderId: 'human', space: 'workroom', senderIsBot: true,
    })).toBe('bot_principal');
  });

  it('admits ordinary human input through primary or an explicitly mentioned member Endpoint', () => {
    expect(classifyWorkroomIngressSource(definition, {
      adapter: 'icqq', endpoint: '8596238', senderId: '1659488338', space: 'workroom',
    })).toBe('accept');
    expect(classifyWorkroomIngressSource(definition, {
      adapter: 'icqq', endpoint: '329158210', senderId: '1659488338', space: 'workroom',
    })).toBe('non_owner_endpoint');
    expect(classifyWorkroomIngressSource(definition, {
      adapter: 'icqq', endpoint: '329158210', senderId: '1659488338',
      space: 'workroom', mentioned: true,
    })).toBe('accept');
  });

  it('admits a projection reply only through the speaking Agent Endpoint', () => {
    expect(classifyWorkroomIngressSource(definition, {
      adapter: 'icqq', endpoint: '329158210', senderId: '1659488338',
      space: 'workroom', replySpeakerAgent: 'reviewer', replySpeakerRole: 'reviewer',
    })).toBe('accept');
    expect(classifyWorkroomIngressSource(definition, {
      adapter: 'icqq', endpoint: '8596238', senderId: '1659488338',
      space: 'workroom', replySpeakerAgent: 'reviewer', replySpeakerRole: 'reviewer',
    })).toBe('non_owner_endpoint');
  });

  it('admits a member projection reply through the primary Endpoint when messageRoute is omitted', () => {
    const defaultRouted = structuredClone(definition);
    delete defaultRouted.members[1]!.messageRoute;
    expect(classifyWorkroomIngressSource(defaultRouted, {
      adapter: 'icqq', endpoint: '8596238', senderId: '1659488338',
      space: 'workroom', replySpeakerAgent: 'reviewer', replySpeakerRole: 'reviewer',
    })).toBe('accept');
  });
});

describe('Workroom projection reply provenance', () => {
  it('finds the original speaking Endpoint when a shared-room reply arrives through another Bot', () => {
    const inboundConversation = {
      endpoint: { id: 'reviewer-cap', adapter: 'root' },
      kind: 'group' as const,
      id: 'shared-room',
    };
    const originalMessage = {
      conversation: {
        endpoint: { id: 'orchestrator-cap', adapter: 'root' },
        kind: 'group' as const,
        id: 'shared-room',
      },
      id: 'projection-1',
    };
    const entry = { message: originalMessage, target: { projectId: 'zhin' } };

    expect(resolveIndexedProjectionReply({
      conversation: inboundConversation,
      replyTo: { conversation: inboundConversation, id: 'projection-1' },
    }, { canonical: entry })).toBe(entry);
  });

  it('fails closed when the room-level reply id is ambiguous', () => {
    const conversation = {
      endpoint: { id: 'member-cap', adapter: 'root' },
      kind: 'group' as const,
      id: 'shared-room',
    };
    const message = { conversation: { ...conversation, endpoint: { id: 'other', adapter: 'root' } }, id: 'same' };
    expect(resolveIndexedProjectionReply({
      conversation,
      replyTo: { conversation, id: 'same' },
    }, { a: { message }, b: { message: { ...message } } })).toBeUndefined();
  });
});

describe('Workroom Orchestrator turn routing', () => {
  const support = {
    $feature: 'zhin.agent/1' as const,
    name: 'support',
    qualifiedName: 'root/support',
    description: 'support',
    instructions: 'help',
    owner: rootPluginId(),
    source: '/agents/support.md',
  };

  it('pins a Workroom continuation to the catalog Orchestrator', () => {
    expect(routeSpecialistAgent('处理这个问题', { agents: [support] }, 'support', 'zhin'))
      .toEqual({ userText: '处理这个问题', agent: support });
  });

  it('uses the default binding when it is the catalog Orchestrator', () => {
    expect(routeSpecialistAgent('处理这个问题', { agents: [support] }, 'zhin', 'zhin'))
      .toEqual({ userText: '处理这个问题' });
  });
});

describe('Workroom projection binding convergence', () => {
  it('advances a stale Catalog projection once and then replays idempotently', async () => {
    const repository = new MemoryWorkroomProjectionRepository();
    const conversation = {
      endpoint: { id: 'runtime-main', adapter: 'root/icqq' },
      kind: 'group' as const,
      id: '1108417575',
    };
    const oldCatalog = {
      revision: 'a'.repeat(64),
      definitions: {
        zhin: {
          name: 'Zhin',
          members: [
            { agent: 'zhin', role: 'orchestrator' as const },
            {
              agent: 'executor', role: 'executor' as const,
              messageRoute: { adapter: 'icqq', endpoint: 'executor-bot' },
            },
          ],
          conversation: {
            adapter: 'icqq', endpoint: 'main', kind: 'group' as const,
            id: '1108417575', agent: 'zhin',
          },
        },
      },
    };
    const endpoints = [
      { id: 'runtime-main', name: 'main', adapter: 'icqq', owner: 'root/icqq' },
      { id: 'runtime-executor', name: 'executor-bot', adapter: 'icqq', owner: 'root/icqq' },
    ];
    await repository.bind(0, createCatalogWorkroomProjectionBinding(
      oldCatalog, 'zhin', conversation, 1, endpoints,
    ));
    const currentCatalog = structuredClone(oldCatalog);
    delete currentCatalog.definitions.zhin.members[1]!.messageRoute;

    await ensureCatalogWorkroomProjectionBinding({
      repository, catalog: currentCatalog, projectId: 'zhin', conversation,
      interactionBindingRevision: 1, endpoints,
    });
    const converged = await repository.read();
    expect(converged.bindings.zhin).toMatchObject({ bindingRevision: 2 });
    expect(converged.bindings.zhin?.agents[0]).not.toHaveProperty('messageEndpoint');

    await ensureCatalogWorkroomProjectionBinding({
      repository, catalog: currentCatalog, projectId: 'zhin', conversation,
      interactionBindingRevision: 1, endpoints,
    });
    expect((await repository.read()).revision).toBe(converged.revision);
  });

  it('catches up to a newer interaction binding revision even when the Catalog digest is unchanged', async () => {
    const repository = new MemoryWorkroomProjectionRepository();
    const conversation = {
      endpoint: { id: 'runtime-main', adapter: 'root/icqq' },
      kind: 'group' as const,
      id: '1108417575',
    };
    const catalog = {
      revision: 'b'.repeat(64),
      definitions: {
        zhin: {
          name: 'Zhin',
          members: [{ agent: 'zhin', role: 'orchestrator' as const }],
          conversation: {
            adapter: 'icqq', endpoint: 'main', kind: 'group' as const,
            id: '1108417575', agent: 'zhin',
          },
        },
      },
    };
    const endpoints = [
      { id: 'runtime-main', name: 'main', adapter: 'icqq', owner: 'root/icqq' },
    ];
    await repository.bind(0, createCatalogWorkroomProjectionBinding(
      catalog, 'zhin', conversation, 1, endpoints,
    ));

    await ensureCatalogWorkroomProjectionBinding({
      repository, catalog, projectId: 'zhin', conversation,
      interactionBindingRevision: 3, endpoints,
    });
    const converged = await repository.read();
    expect(converged.bindings.zhin).toMatchObject({ bindingRevision: 3 });

    await ensureCatalogWorkroomProjectionBinding({
      repository, catalog, projectId: 'zhin', conversation,
      interactionBindingRevision: 3, endpoints,
    });
    expect((await repository.read()).revision).toBe(converged.revision);
  });
});

describe('Plugin Runtime Tool policy bridge', () => {
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
  });
});

describe('process-fixed Workroom storage identity', () => {
  it('constructs the exact named Projection binding from Catalog plus canonical ingress', () => {
    const conversation = {
      endpoint: { id: 'root\0zhin.adapter\0slack~main', adapter: 'adapter-owner' },
      kind: 'channel' as const,
      id: 'engineering',
    };
    expect(createCatalogWorkroomProjectionBinding({
      revision: 'a'.repeat(64),
      definitions: {
        engineering: {
          name: 'Engineering',
          members: [
            { agent: 'orchestrator', role: 'orchestrator' },
            { agent: 'developer', role: 'executor' },
          ],
          conversation: {
            adapter: 'slack', endpoint: 'main', kind: 'channel',
            id: 'engineering', agent: 'orchestrator',
          },
        },
      },
    }, 'engineering', conversation, 4)).toEqual({
      version: 1,
      audience: 'workroom',
      projectId: 'engineering',
      catalogBindingDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      bindingRevision: 4,
      projectionPolicyRevision: 1,
      conversation,
      orchestrator: {
        principalId: 'orchestrator', agentDefinitionId: 'orchestrator',
        displayName: 'orchestrator', role: 'orchestrator',
      },
      agents: [{
        principalId: 'developer', agentDefinitionId: 'developer',
        displayName: 'developer', role: 'executor',
      }],
    });
  });

  it('resolves each Workroom member messageRoute to an exact runtime Endpoint', () => {
    const incoming = {
      endpoint: { id: 'root\0zhin.adapter\0icqq~reviewer', adapter },
      kind: 'group' as const,
      id: '129043431',
    };
    const binding = createCatalogWorkroomProjectionBinding({
      revision: 'c'.repeat(64),
      definitions: {
        zhin: {
          name: 'Zhin',
          members: [
            { agent: 'zhin', role: 'orchestrator' },
            {
              agent: 'reviewer', role: 'reviewer',
              messageRoute: { adapter: 'icqq', endpoint: 'reviewer' },
            },
          ],
          conversation: {
            adapter: 'icqq', endpoint: 'main', kind: 'group', id: '129043431', agent: 'zhin',
          },
        },
      },
    }, 'zhin', incoming, 7, [
      { id: 'runtime-main', name: 'main', adapter: 'icqq', owner: adapter },
      { id: 'runtime-reviewer', name: 'reviewer', adapter: 'icqq', owner: adapter },
    ]);

    expect(binding.conversation.endpoint).toEqual({ id: 'runtime-main', adapter });
    expect(binding.agents[0]?.messageEndpoint).toEqual({ id: 'runtime-reviewer', adapter });
  });

  it('constructs a distinct persistent Sponsor Room projection binding', () => {
    const conversation = {
      endpoint: { id: 'root\0zhin.adapter\0slack~main', adapter: 'adapter-owner' },
      kind: 'channel' as const, id: 'engineering-sponsors',
    };
    expect(createCatalogSponsorRoomProjectionBinding({
      revision: 'b'.repeat(64),
      definitions: { engineering: {
        name: 'Engineering', sponsors: ['root:alice'],
        members: [{ agent: 'orchestrator', role: 'orchestrator' }],
        conversation: { adapter: 'slack', endpoint: 'main', kind: 'channel', id: 'engineering', agent: 'orchestrator' },
        sponsorConversation: { adapter: 'slack', endpoint: 'main', kind: 'channel', id: 'engineering-sponsors', agent: 'orchestrator' },
      } },
    }, 'engineering', conversation, 7)).toMatchObject({
      version: 1, audience: 'sponsor_room', projectId: 'engineering',
      bindingRevision: 7, conversation,
      orchestrator: { agentDefinitionId: 'orchestrator', role: 'orchestrator' },
    });
  });

  it('resolves first-outbound Sponsor delivery to the exact current Endpoint capability', () => {
    const definition = {
      name: 'Engineering', members: [{ agent: 'orchestrator', role: 'orchestrator' as const }],
      conversation: { adapter: 'slack', endpoint: 'main', kind: 'channel' as const, id: 'engineering', agent: 'orchestrator' },
      sponsorConversation: { adapter: 'slack', endpoint: 'main', kind: 'channel' as const, id: 'portfolio-sponsors', agent: 'orchestrator' },
    };
    expect(resolveCatalogSponsorProjectionConversation(definition, [{
      id: 'root\0zhin.adapter\0slack~main', name: 'main', adapter: 'slack', owner: 'adapter-owner',
    }])).toEqual({
      endpoint: { id: 'root\0zhin.adapter\0slack~main', adapter: 'adapter-owner' },
      kind: 'channel', id: 'portfolio-sponsors',
    });
    expect(resolveCatalogSponsorProjectionConversation(definition, [])).toBeUndefined();
  });

  it('derives one backend from the initial process configuration', () => {
    expect(resolveWorkroomStorageMode(undefined)).toBe('database');
    expect(resolveWorkroomStorageMode({ sessions: { useDatabase: false } } as never)).toBe('file');
  });

  it('rejects a generation that tries to switch the Workroom authority', () => {
    expect(() => assertFixedWorkroomStorageMode('database', 'file'))
      .toThrow('process restart required');
    expect(() => assertFixedWorkroomStorageMode('file', 'database'))
      .toThrow('process restart required');
    expect(() => assertFixedWorkroomStorageMode('database', 'database')).not.toThrow();
  });

  it('rejects a persisted Catalog that references another Agent generation', async () => {
    const catalog = {
      read: async () => ({
        revision: 'a'.repeat(64),
        definitions: {
          support: {
            name: 'Support',
            members: [{ agent: 'removed-agent', role: 'orchestrator' as const }],
            conversation: {
              adapter: 'telegram', endpoint: 'bot', kind: 'group' as const,
              id: 'support', agent: 'removed-agent',
            },
          },
        },
      }),
    };

    await expect(assertWorkroomCatalogMatchesGeneration(
      catalog,
      ['zhin'],
    )).rejects.toThrow(/incompatible|unknown Agent/u);
  });

  it('does not validate a candidate Agent generation against the previously committed Endpoint projection', async () => {
    const catalog = {
      read: async () => ({
        revision: 'a'.repeat(64),
        definitions: {
          support: {
            name: 'Support',
            members: [{
              agent: 'zhin',
              role: 'orchestrator' as const,
              messageRoute: { adapter: 'icqq', endpoint: 'bot' },
            }],
            conversation: {
              adapter: 'icqq', endpoint: 'bot', kind: 'group' as const,
              id: 'support', agent: 'zhin',
            },
          },
        },
      }),
    };

    // Root resources are installed before the candidate AdapterIndex is projected.
    // An empty/old live projection must not make a valid persisted Catalog fail startup.
    await expect(assertWorkroomCatalogMatchesGeneration(
      catalog,
      ['zhin'],
    )).resolves.toBeUndefined();
  });

  it('validates persisted routes against endpoint keys read from the candidate config', async () => {
    const catalog = {
      read: async () => ({
        revision: 'a'.repeat(64),
        definitions: {
          support: {
            name: 'Support',
            members: [{ agent: 'zhin', role: 'orchestrator' as const }],
            conversation: {
              adapter: 'telegram', endpoint: 'removed-bot', kind: 'group' as const,
              id: 'support', agent: 'zhin',
            },
          },
        },
      }),
    };

    await expect(assertWorkroomCatalogMatchesGeneration(
      catalog,
      ['zhin'],
      new Set(['telegram:current-bot']),
    )).rejects.toThrow(/unknown configured Bot Endpoint/u);
  });
});

describe('runtime reply delivery outcome bridge', () => {
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
      message: {
        conversation: {
          endpoint: { id: 'sandbox~main', adapter: 'sandbox' },
          kind: 'private',
          id: 'user-1',
        },
        id: 'message-1',
      },
    })).toEqual({ status: 'sent', messageId: 'message-1' });
  });
});

describe('canonical IM TurnRequest ingress', () => {
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
    const commitConversationContext = vi.fn(async () => undefined);
    const request = createRuntimeTurnRequest(message, 'look closer', {
      isMaster: false,
      isTrusted: true,
    }, {
      traceId: 'trace-1',
      turnId: 'turn-1',
      signal,
      workspaceRoot: '/workspace',
      network: { enabled: true, httpsOnly: true, allowedDomains: ['example.com'] },
      ports: {},
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
      session: { key: 'icqq:10001:group:100' },
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
    expect(readConversationContext).toHaveBeenCalledWith('agent-session:icqq:10001:group:100', signal);
    expect(commitConversationContext).toHaveBeenCalledWith('agent-session:icqq:10001:group:100', 3);
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
    const options = { traceId: 't', turnId: 'u', signal, workspaceRoot: '/workspace', ports: {} } as const;
    expect(() => createRuntimeTurnRequest(makeMessage({
      content: 'x', sender: null, metadata: { endpoint: 'bot' },
    }), 'x', { isMaster: false, isTrusted: false }, options)).toThrow('sender identity');
    expect(() => createRuntimeTurnRequest(makeMessage({
      content: 'x', sender: 'u', metadata: {},
    }), 'x', { isMaster: false, isTrusted: false }, options)).toThrow('endpoint identity');
  });

  it('preserves platform roles alongside framework trust roles', () => {
    const message = makeMessage({
      content: 'x', sender: { id: 'u', roles: ['owner', 'admin'] }, metadata: { endpoint: 'bot' },
    });
    const request = createRuntimeTurnRequest(message, 'x', {
      isMaster: false,
      isTrusted: true,
    }, { traceId: 't', turnId: 'u', signal: new AbortController().signal, workspaceRoot: '/workspace', ports: {} });
    expect(request.principal.roles).toEqual(['owner', 'admin', 'trusted']);
    expect(request.policy.permissions).toEqual(['owner', 'admin', 'trusted']);
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
    const request = createRuntimeTurnRequest(message, 'more detail', {
      isMaster: false,
      isTrusted: false,
    }, {
      traceId: 't',
      turnId: 'u',
      signal: new AbortController().signal,
      workspaceRoot: '/workspace',
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
          expect(request.type).toBe('confirm');
          if (request.type === 'confirm') expect(request.default).toBe(false);
          expect(request.signal).toBeDefined();
          return true as never;
        },
        async sequence() { return {} as never; },
      },
    });
    await expect(port.requestApproval({
      requestId: 'a2',
      toolName: 'icqq__announce',
      question: '工具「icqq__announce」需要确认后执行。是否继续？',
      signal: new AbortController().signal,
    })).resolves.toBe(true);
    expect(seen[0]?.title).toBe('操作确认');
    expect(seen[0]?.description).toContain('是否继续');
    expect(seen[0]?.tip).toContain('master');
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

  it('can remember only the same concrete operation within one sandbox session', async () => {
    const remembered = new Set<string>();
    const ask = vi.fn(async () => 'session' as never);
    const port = createRuntimeApprovalPort({
      isMaster: false,
      interaction: { ask, async sequence() { return {} as never; } },
      rememberSession: {
        isApproved: (input) => remembered.has(input.scopeKey ?? input.toolName),
        grant: (input) => { remembered.add(input.scopeKey ?? input.toolName); },
      },
    });
    const input = {
      requestId: 'session-approval',
      toolName: 'bash',
      scopeKey: 'bash:{"command":"pnpm test"}',
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
    expect(remembered).toContain('bash:{"command":"pnpm test"}');
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
  segments?: ConstructorParameters<typeof Message>[6];
  replyTo?: { readonly id: string };
}): Message {
  const conversation = conversationFromTarget(input.target ?? 'group:100');
  const senderRef = input.sender === null
    ? undefined
    : typeof input.sender === 'object'
      ? input.sender
      : { id: input.sender ?? 'user-1', name: input.sender };
  return new Message(
    conversation,
    input.content,
    1,
    async () => ({ status: 'sent' as const }),
    senderRef,
    Object.freeze(input.metadata ?? {}),
    input.segments,
    { conversation, id: 'm1' },
    typeof input.metadata?.endpoint === 'string' ? input.metadata.endpoint : undefined,
    undefined,
    input.replyTo,
  );
}

function makeMessageWithReply(content: string, delivered: string[]): Message {
  const conversation = conversationFromTarget('group:100');
  return new Message(
    conversation,
    content,
    1,
    async (output) => {
      delivered.push(String(output));
      return { status: 'sent' as const };
    },
    { id: 'user-1', name: 'Alice' },
    Object.freeze({ endpoint: '10001' }),
    undefined,
    { conversation, id: `m${delivered.length + 1}` },
    '10001',
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
    const result = await withTriggerTimeout(Promise.resolve('ok'), 50);
    expect(result).toBe('ok');
  });

  it('withTriggerTimeout：超时 reject，迟到的 settle 不影响结果', async () => {
    const slow = new Promise<string>((resolve) => {
      setTimeout(() => resolve('late'), 100);
    });
    await expect(withTriggerTimeout(slow, 20)).rejects.toThrow('AI 处理超时（20ms）');
    // 等待迟到 settle，确保不产生 unhandledRejection / 二次 settle 异常
    await expect(slow).resolves.toBe('late');
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

describe('缺口 3：masters / trusted 角色解析', () => {
  it('endpoint owner 命中 → master', () => {
    const roles = resolveRuntimeSenderRoles(groupMessage('hi', { userId: 'user-1' }), 'user-1', [], undefined);
    expect(roles).toEqual({ isMaster: true, isTrusted: false });
  });

  it('trigger.masters 命中 → master（无 endpoint owner 时）', () => {
    const trigger: AITriggerConfig = { masters: ['user-1'] };
    const roles = resolveRuntimeSenderRoles(groupMessage('hi', { userId: 'user-1' }), undefined, [], trigger);
    expect(roles).toEqual({ isMaster: true, isTrusted: false });
  });

  it('endpoint trusted 命中 → trusted', () => {
    const roles = resolveRuntimeSenderRoles(groupMessage('hi', { userId: 'user-1' }), undefined, ['user-1'], undefined);
    expect(roles).toEqual({ isMaster: false, isTrusted: true });
  });

  it('trigger.trusted 命中 → trusted', () => {
    const trigger: AITriggerConfig = { trusted: ['user-1'] };
    const roles = resolveRuntimeSenderRoles(groupMessage('hi', { userId: 'user-1' }), undefined, [], trigger);
    expect(roles).toEqual({ isMaster: false, isTrusted: true });
  });

  it('master 优先于 trusted（对齐 legacy resolveSenderRoles）', () => {
    const trigger: AITriggerConfig = { masters: ['user-1'], trusted: ['user-1'] };
    const roles = resolveRuntimeSenderRoles(groupMessage('hi', { userId: 'user-1' }), undefined, ['user-1'], trigger);
    expect(roles).toEqual({ isMaster: true, isTrusted: false });
  });

  it('普通用户无角色', () => {
    const roles = resolveRuntimeSenderRoles(groupMessage('hi'), 'owner-x', ['trusted-y'], undefined);
    expect(roles).toEqual({ isMaster: false, isTrusted: false });
  });

  it('sender.id 不匹配 master 时不授权', () => {
    const message = groupMessage('hi', { userId: 'attacker-id' }, 'attacker-id');
    const roles = resolveRuntimeSenderRoles(message, 'owner-x', ['owner-x'], {
      masters: ['owner-x'],
      trusted: ['owner-x'],
    });
    expect(roles).toEqual({ isMaster: false, isTrusted: false });
  });

  it('sender.id 匹配 master 时授权（无需 metadata）', () => {
    const message = makeMessage({
      content: 'hi',
      target: 'group:100',
      sender: { id: 'owner-x', name: '昵称' },
      metadata: { endpoint: '10001' },
    });
    const roles = resolveRuntimeSenderRoles(message, 'owner-x', [], {
      masters: ['owner-x'],
    });
    expect(roles).toEqual({ isMaster: true, isTrusted: false });
  });

  it.each([
    ['user_id', 'legacy-user'],
    ['senderId', 'runtime-user'],
  ])('sender.id 缺失时 fallback metadata.%s 作为授权身份', (key, id) => {
    const message = makeMessage({
      content: 'hi',
      target: 'group:100',
      sender: null,
      metadata: { endpoint: '10001', [key]: id },
    });
    const roles = resolveRuntimeSenderRoles(message, id, [], undefined);
    expect(roles).toEqual({ isMaster: true, isTrusted: false });
  });

});

describe('缺口 3：createEndpointRoleResolver（plugins.<key>.trusted）', () => {
  it('从候选配置读取 name 或 id 形式的 Endpoint key', async () => {
    await expect(readConfiguredEndpointKeys({
      plugins: {
        icqq: { endpoints: [{ id: '10001' }] },
        slack: { endpoints: [{ id: 'ignored-id', name: 'workspace-bot' }] },
      },
    } as never)).resolves.toEqual(new Set(['icqq:10001', 'slack:workspace-bot']));
  });

  it('master + trusted 数组解析，name 别名键可查', async () => {
    const resolver = await createEndpointRoleResolver({
      plugins: {
        icqq: { master: 'u-owner', name: 'bot1', trusted: ['t1', 't2'] },
      },
    } as never);
    expect(resolver.resolveOwner('icqq', 'x')).toBe('u-owner');
    expect(resolver.resolveOwner('bot1', 'y')).toBe('u-owner');
    expect(resolver.resolveTrusted('icqq', 'x')).toEqual(['t1', 't2']);
    expect(resolver.resolveTrusted('bot1', 'y')).toEqual(['t1', 't2']);
  });

  it('endpoints[].master / endpoints[].trusted 解析', async () => {
    const resolver = await createEndpointRoleResolver({
      plugins: {
        icqq: {
          endpoints: [{ name: '10001', master: 'u-ep-master', trusted: 't3 t4' }],
        },
      },
    } as never);
    expect(resolver.resolveOwner('icqq', '10001')).toBe('u-ep-master');
    expect(resolver.resolveOwner('10001', '10001')).toBe('u-ep-master');
    // 不挂到插件键，避免污染同适配器其它 endpoint
    expect(resolver.resolveOwner('icqq', 'other')).toBeUndefined();
    expect(resolver.resolveTrusted('icqq', '10001')).toEqual(['t3', 't4']);
  });

  it('endpoints[].owner 不作为框架 master（owner/admin 是群身份）', async () => {
    const resolver = await createEndpointRoleResolver({
      plugins: {
        qq: {
          endpoints: [{ name: '知音', owner: 'should-not-be-master', master: 'real-master' }],
        },
      },
    } as never);
    expect(resolver.resolveOwner('qq', '知音')).toBe('real-master');
    expect(resolver.resolveOwner('知音', '知音')).toBe('real-master');
  });

  it('多 endpoint 各自 master 互不覆盖', async () => {
    const resolver = await createEndpointRoleResolver({
      plugins: {
        qq: {
          endpoints: [
            { name: 'zhin', master: 'master-a' },
            { name: '知音', master: 'master-b' },
          ],
        },
      },
    } as never);
    expect(resolver.resolveOwner('qq', 'zhin')).toBe('master-a');
    expect(resolver.resolveOwner('qq', '知音')).toBe('master-b');
  });

  it('endpoints[].master → canonical principal role', async () => {
    const masterId = '477561AD3A89AFCDABB6AFCB71FF54DF';
    const resolver = await createEndpointRoleResolver({
      plugins: {
        qq: {
          endpoints: [{ name: '知音', master: masterId }],
        },
      },
    } as never);
    const endpointMaster = resolver.resolveOwner('qq', '知音');
    expect(endpointMaster).toBe(masterId);

    const message = makeMessage({
      content: 'edit please',
      target: `private:${masterId}`,
      sender: { id: masterId, name: '昵称可变' },
      metadata: {
        endpoint: '知音',
      },
    });
    const roles = resolveRuntimeSenderRoles(message, endpointMaster, [], undefined);
    expect(roles).toEqual({ isMaster: true, isTrusted: false });
    expect(createRuntimeTurnAccess(message, roles).principal.roles).toContain('master');
  });

  it('无 plugins 配置时返回空解析', async () => {
    const resolver = await createEndpointRoleResolver({} as never);
    expect(resolver.resolveOwner('icqq', 'x')).toBeUndefined();
    expect(resolver.resolveTrusted('icqq', 'x')).toEqual([]);
  });
});
