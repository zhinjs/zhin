import { describe, expect, it } from 'vitest';
import { Message } from '@zhin.js/core/runtime';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { MemoryWorkroomProjectionRepository } from '@zhin.js/agent';
import {
  assertWorkroomCatalogMatchesGeneration,
  classifyWorkroomIngressSource,
  createCatalogSponsorRoomProjectionBinding,
  createCatalogWorkroomProjectionBinding,
  ensureCatalogWorkroomProjectionBinding,
  resolveCatalogSponsorProjectionConversation,
  resolveCatalogWorkroomProjectionConversation,
  resolveIndexedProjectionReply,
} from '../../src/plugin-runtime/workroom-projection.js';

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
      adapter: 'slack', endpoint: 'main', senderId: 'human', space: 'workroom', trustedSenderIsBot: true,
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

describe('Workroom Catalog projection authority', () => {
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

  it('renews Workroom conversation bindings from exact current authorities', () => {
    const definition = {
      name: 'Engineering', members: [{ agent: 'orchestrator', role: 'orchestrator' as const }],
      conversation: {
        adapter: 'slack', endpoint: 'main', kind: 'channel' as const,
        id: 'engineering', agent: 'orchestrator',
      },
    };
    const endpoint = {
      id: 'root\0zhin.adapter\0slack~main', name: 'main', adapter: 'slack', owner: 'adapter-owner',
    };
    expect(resolveCatalogWorkroomProjectionConversation(definition, [endpoint])).toEqual({
      endpoint: { id: endpoint.id, adapter: endpoint.owner },
      kind: 'channel', id: 'engineering',
    });
    expect(resolveCatalogWorkroomProjectionConversation(definition, [endpoint, {
      ...endpoint, id: 'duplicate', owner: 'duplicate-owner',
    }])).toBeUndefined();
    expect(resolveCatalogWorkroomProjectionConversation({
      ...definition,
      conversation: { kind: 'repository' as const, id: 'zhinjs/zhin', agent: 'orchestrator' },
    }, [endpoint])).toBeUndefined();
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
