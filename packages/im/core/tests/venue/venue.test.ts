import { describe, expect, it, vi } from 'vitest';
import {
  createVenueFloorController,
  createVenueMembershipPort,
  createVenueProjector,
  createVenueRegistry,
  createVenueSendLimiter,
  findUnreadyVenueEndpoints,
  resolveVenueVisibility,
  routeVenueMessage,
  validateVenueDefinitions,
  venueProjectorToken,
  venueRegistryToken,
  VenueValidationError,
  type VenueDefinition,
  type VenueProjectedEvent,
  type VenueProjectionSendInput,
} from '../../src/venue/index.js';
import { adapterFeatureId } from '@zhin.js/adapter';
import { InboundRuntime } from '../../src/plugin-runtime/im/inbound-runtime.js';
import { roomMembershipToken } from '../../src/plugin-runtime/im/inbound-dedup.js';
import { getLogger } from '@zhin.js/logger';

const sampleVenue: VenueDefinition = {
  id: 'dev-room',
  label: 'Dev Team Room',
  conversation: {
    platform: 'qq',
    sceneType: 'group',
    sceneId: 'group-100',
  },
  members: [
    { agent: 'lead', botEndpoint: 'qq:lead-bot', aliases: ['队长', 'leader'] },
    { agent: 'coder', botEndpoint: 'qq:coder-bot', aliases: ['码农'] },
    { agent: 'reviewer', botEndpoint: 'qq:reviewer-bot', aliases: ['审稿'] },
  ],
  entry: 'lead',
  visibility: 'visible',
};

describe('Venue contracts & visibility', () => {
  it('resolves explicit visibility or defaults by sceneType (private -> backstage, group/channel -> visible)', () => {
    expect(resolveVenueVisibility(sampleVenue)).toBe('visible');
    expect(
      resolveVenueVisibility({
        ...sampleVenue,
        visibility: undefined,
        conversation: { platform: 'qq', sceneType: 'group', sceneId: 'g1' },
      }),
    ).toBe('visible');
    expect(
      resolveVenueVisibility({
        ...sampleVenue,
        visibility: undefined,
        conversation: { platform: 'qq', sceneType: 'private', sceneId: 'u1' },
      }),
    ).toBe('backstage');
    expect(
      resolveVenueVisibility({
        ...sampleVenue,
        visibility: 'summary',
      }),
    ).toBe('summary');
  });

  it('exports resource tokens for VenueRegistry and VenueProjector', () => {
    expect(String(venueRegistryToken.id)).toBe('im.venue-registry');
    expect(String(venueProjectorToken.id)).toBe('im.venue-projector');
  });
});

describe('validateVenueDefinitions', () => {
  it('accepts valid venue definitions', () => {
    expect(() => validateVenueDefinitions([sampleVenue])).not.toThrow();
  });

  it('rejects duplicate venue ids', () => {
    const dup: VenueDefinition = {
      ...sampleVenue,
      conversation: { platform: 'qq', sceneType: 'group', sceneId: 'group-200' },
    };
    expect(() => validateVenueDefinitions([sampleVenue, dup])).toThrow(VenueValidationError);
    expect(() => validateVenueDefinitions([sampleVenue, dup])).toThrow(/duplicate venue id "dev-room"/);
  });

  it('rejects duplicate member agent or duplicate botEndpoint within a venue', () => {
    const dupAgent: VenueDefinition = {
      ...sampleVenue,
      id: 'dup-agent',
      members: [
        { agent: 'lead', botEndpoint: 'qq:bot-1' },
        { agent: 'lead', botEndpoint: 'qq:bot-2' },
      ],
    };
    expect(() => validateVenueDefinitions([dupAgent])).toThrow(/duplicate member agent "lead"/);

    const dupEndpoint: VenueDefinition = {
      ...sampleVenue,
      id: 'dup-endpoint',
      members: [
        { agent: 'lead', botEndpoint: 'qq:shared-bot' },
        { agent: 'coder', botEndpoint: 'qq:shared-bot' },
      ],
    };
    expect(() => validateVenueDefinitions([dupEndpoint])).toThrow(/duplicate member botEndpoint "qq:shared-bot"/);
  });

  it('rejects invalid entry agent not in members', () => {
    const badEntry: VenueDefinition = {
      ...sampleVenue,
      id: 'bad-entry',
      entry: 'nonexistent',
    };
    expect(() => validateVenueDefinitions([badEntry])).toThrow(
      /entry "nonexistent" does not match any member agent/,
    );
  });

  it('rejects duplicate conversation binding across venues', () => {
    const secondVenue: VenueDefinition = {
      ...sampleVenue,
      id: 'other-room',
      conversation: {
        platform: 'qq',
        sceneType: 'group',
        sceneId: 'group-100',
      },
    };
    expect(() => validateVenueDefinitions([sampleVenue, secondVenue])).toThrow(/duplicate conversation/);
  });

  it('rejects empty members and invalid visibility mode', () => {
    expect(() =>
      validateVenueDefinitions([
        {
          ...sampleVenue,
          id: 'empty-members',
          members: [],
        },
      ]),
    ).toThrow(/members must be a non-empty array/);

    expect(() =>
      validateVenueDefinitions([
        {
          ...sampleVenue,
          id: 'bad-vis',
          visibility: 'invalid' as never,
        },
      ]),
    ).toThrow(/visibility must be "visible", "summary", or "backstage"/);
  });
});

describe('createVenueRegistry & createVenueMembershipPort', () => {
  const selfIds: Record<string, string | undefined> = {
    'qq:lead-bot': '10001',
    'qq:coder-bot': '10002',
    'qq:reviewer-bot': '10003',
  };
  const resolveEndpointSelfId = (_platform: string, endpointId: string) => selfIds[endpointId];

  it('indexes venues by id, conversation, agent, endpoint, and entry member', () => {
    const registry = createVenueRegistry([sampleVenue]);
    expect(registry.list()).toHaveLength(1);
    expect(registry.get('dev-room')?.id).toBe('dev-room');
    expect(registry.get('missing')).toBeUndefined();

    expect(
      registry.findByConversation({ platform: 'qq', sceneType: 'group', sceneId: 'group-100' })?.id,
    ).toBe('dev-room');
    expect(
      registry.findByConversation({ platform: 'qq', sceneType: 'private', sceneId: 'group-100' }),
    ).toBeUndefined();

    expect(registry.resolveMemberByAgent('dev-room', 'coder')?.botEndpoint).toBe('qq:coder-bot');
    expect(registry.resolveMemberByEndpoint('dev-room', 'qq:reviewer-bot')?.agent).toBe('reviewer');
    expect(registry.resolveEntryMember('dev-room')?.agent).toBe('lead');
  });

  it('resolves room info and addressed endpoints via createVenueMembershipPort', () => {
    const registry = createVenueRegistry([sampleVenue]);
    const port = createVenueMembershipPort({ registry, resolveEndpointSelfId });

    const resolved = port.resolveRoom({
      platform: 'qq',
      sceneType: 'group',
      sceneId: 'group-100',
    });
    expect(resolved).toEqual({
      roomId: 'dev-room',
      defaultEndpointId: 'qq:lead-bot',
      memberEndpoints: ['qq:lead-bot', 'qq:coder-bot', 'qq:reviewer-bot'],
    });

    // Mention by selfUserId
    expect(
      port.isAddressedEndpoint({
        platform: 'qq',
        sceneType: 'group',
        sceneId: 'group-100',
        endpointId: 'qq:coder-bot',
        mentions: ['10002'],
      }),
    ).toBe(true);

    // Mention by @alias in rawText
    expect(
      port.isAddressedEndpoint({
        platform: 'qq',
        sceneType: 'group',
        sceneId: 'group-100',
        endpointId: 'qq:reviewer-bot',
        rawText: '@审稿 帮我看下这段代码',
      }),
    ).toBe(true);

    // Reply to member selfUserId
    expect(
      port.isAddressedEndpoint({
        platform: 'qq',
        sceneType: 'group',
        sceneId: 'group-100',
        endpointId: 'qq:coder-bot',
        replyToSenderId: '10002',
      }),
    ).toBe(true);

    // Unaddressed endpoint
    expect(
      port.isAddressedEndpoint({
        platform: 'qq',
        sceneType: 'group',
        sceneId: 'group-100',
        endpointId: 'qq:reviewer-bot',
        rawText: '大家好',
      }),
    ).toBe(false);
  });

  it('reports fail-closed isRoomReady when any member endpoint has not reported selfUserId', () => {
    const registry = createVenueRegistry([sampleVenue]);
    const partialSelfIds: Record<string, string | undefined> = {
      'qq:lead-bot': '10001',
      'qq:coder-bot': undefined,
      'qq:reviewer-bot': '',
    };
    const unready = findUnreadyVenueEndpoints(
      sampleVenue,
      (_platform, endpointId) => partialSelfIds[endpointId],
    );
    expect(unready).toEqual(['qq:coder-bot', 'qq:reviewer-bot']);

    const port = createVenueMembershipPort({
      registry,
      resolveEndpointSelfId: (_platform, endpointId) => partialSelfIds[endpointId],
    });
    expect(
      port.isRoomReady({ platform: 'qq', sceneType: 'group', sceneId: 'group-100' }),
    ).toEqual({
      ready: false,
      unreadyEndpoints: ['qq:coder-bot', 'qq:reviewer-bot'],
    });

    // Ready when all endpoints report selfUserId
    const readyPort = createVenueMembershipPort({ registry, resolveEndpointSelfId });
    expect(
      readyPort.isRoomReady({ platform: 'qq', sceneType: 'group', sceneId: 'group-100' }),
    ).toEqual({ ready: true });
  });

  it('drops inbound messages fail-closed in InboundRuntime when isRoomReady returns ready: false', async () => {
    const registry = createVenueRegistry([sampleVenue]);
    const port = createVenueMembershipPort({
      registry,
      resolveEndpointSelfId: () => undefined,
    });
    const warnSpy = vi.spyOn(getLogger('im.inbound'), 'warn').mockImplementation(() => undefined);
    const recordIncoming = vi.fn(async () => 1);

    const rootId = 'root-plugin' as never;
    const endpointId = 'qq:lead-bot' as never;
    const adapterIndex = {
      $projection: 'zhin.adapter-index/1' as const,
      owner: () => rootId,
      acquireInbound: () => ({
        endpoint: endpointId,
        signal: new AbortController().signal,
        assertActive: () => undefined,
        release: () => undefined,
      }),
      adapterForEndpoint: () => ({}),
      clientAdapter: () => 'qq',
    };

    const snapshot = {
      generation: 1,
      root: rootId,
      projections: new Map([[adapterFeatureId, adapterIndex]]),
      resources: new Map([[rootId, new Map([[roomMembershipToken.id, port]])]]),
    };

    const runtime = new InboundRuntime({
      interactions: {
        create: () => undefined,
        createForMessage: () => undefined,
        createFromUnknown: () => undefined,
        dispatch: async () => false,
        resolveClaim: () => false,
      },
      captureOperation: () => ({}) as never,
      acquire: () => ({
        value: snapshot as never,
        stopSignal: new AbortController().signal,
        release: () => undefined,
      }),
      release: () => undefined,
      deliver: async () => ({ status: 'sent' }),
      recordIncoming,
      recordNotice: async () => undefined,
      publish: () => undefined,
    });

    try {
      const result = await runtime.receive({
        name: 'message.receive',
        endpoint: { id: 'qq:lead-bot', adapter: 'qq' },
        client: {},
        payload: {
          conversation: {
            endpoint: { id: 'qq:lead-bot', adapter: 'qq' },
            kind: 'group',
            id: 'group-100',
          },
          content: 'hello team',
          sender: { id: 'user-1', name: 'Alice' },
          message: {
            id: 'msg-1',
            conversation: {
              endpoint: { id: 'qq:lead-bot', adapter: 'qq' },
              kind: 'group',
              id: 'group-100',
            },
          },
        },
      } as never);

      expect(result).toEqual({ matched: false });
      expect(recordIncoming).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('routeVenueMessage (priority: pending > mention > reply > endpoint > entry)', () => {
  const selfIds: Record<string, string | undefined> = {
    'qq:lead-bot': '10001',
    'qq:coder-bot': '10002',
    'qq:reviewer-bot': '10003',
  };
  const resolveEndpointSelfId = (_platform: string, endpointId: string) => selfIds[endpointId];

  it('1. routes to pendingAgent over mention, reply, endpoint, and entry', () => {
    const decision = routeVenueMessage({
      venue: sampleVenue,
      text: '@coder please check',
      mentions: ['10002'],
      replyToSenderId: '10003',
      pendingAgent: 'reviewer',
      winningEndpointId: 'qq:coder-bot',
      resolveEndpointSelfId,
    });
    expect(decision).toEqual({
      member: sampleVenue.members[2],
      reason: 'pending',
    });
  });

  it('2. routes to mentioned member (via selfUserId or @agent/@alias in text) over reply, endpoint, and entry', () => {
    const bySelfId = routeVenueMessage({
      venue: sampleVenue,
      text: 'check this',
      mentions: ['10002'],
      replyToSenderId: '10003',
      winningEndpointId: 'qq:reviewer-bot',
      resolveEndpointSelfId,
    });
    expect(bySelfId).toEqual({
      member: sampleVenue.members[1],
      reason: 'mention',
    });

    const byTextAlias = routeVenueMessage({
      venue: sampleVenue,
      text: '请 @审稿 帮我看下',
      replyToSenderId: '10002',
      resolveEndpointSelfId,
    });
    expect(byTextAlias).toEqual({
      member: sampleVenue.members[2],
      reason: 'mention',
    });
  });

  it('3. routes to replied member over endpoint and entry', () => {
    const decision = routeVenueMessage({
      venue: sampleVenue,
      text: 'thanks, one more question',
      replyToSenderId: '10003',
      winningEndpointId: 'qq:coder-bot',
      resolveEndpointSelfId,
    });
    expect(decision).toEqual({
      member: sampleVenue.members[2],
      reason: 'reply',
    });
  });

  it('4. routes to non-entry winningEndpointId over entry', () => {
    const decision = routeVenueMessage({
      venue: sampleVenue,
      text: 'hello',
      winningEndpointId: 'qq:coder-bot',
      resolveEndpointSelfId,
    });
    expect(decision).toEqual({
      member: sampleVenue.members[1],
      reason: 'endpoint',
    });
  });

  it('5. falls back to entry member when no higher priority matches', () => {
    const decision = routeVenueMessage({
      venue: sampleVenue,
      text: 'general question for the room',
      winningEndpointId: 'qq:lead-bot',
      resolveEndpointSelfId,
    });
    expect(decision).toEqual({
      member: sampleVenue.members[0],
      reason: 'entry',
    });
  });
});

describe('createVenueFloorController & createVenueSendLimiter', () => {
  it('allows background thinking in parallel while serializing FIFO speech per Venue', async () => {
    const floor = createVenueFloorController();
    const events: string[] = [];

    const runActor = async (actor: string, thinkMs: number, speakMs: number) => {
      events.push(`think:start:${actor}`);
      await new Promise((r) => setTimeout(r, thinkMs));
      events.push(`think:done:${actor}`);
      return floor.withFloor('dev-room', actor, async () => {
        events.push(`speak:start:${actor}`);
        expect(floor.activeSpeaker('dev-room')).toBe(actor);
        await new Promise((r) => setTimeout(r, speakMs));
        events.push(`speak:end:${actor}`);
        return actor;
      });
    };

    const [a, b, c] = await Promise.all([
      runActor('lead', 5, 20),
      runActor('coder', 10, 15),
      runActor('reviewer', 15, 10),
    ]);

    expect([a, b, c]).toEqual(['lead', 'coder', 'reviewer']);
    const speakEvents = events.filter((e) => e.startsWith('speak:'));
    expect(speakEvents).toEqual([
      'speak:start:lead',
      'speak:end:lead',
      'speak:start:coder',
      'speak:end:coder',
      'speak:start:reviewer',
      'speak:end:reviewer',
    ]);
  });

  it('throttles sends per endpoint via createVenueSendLimiter', async () => {
    let clock = 1000;
    const sleeps: number[] = [];
    const limiter = createVenueSendLimiter({
      minIntervalMs: 500,
      maxBurst: 2,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });

    await limiter.acquire({ venueId: 'dev-room', endpointId: 'qq:lead-bot' });
    await limiter.acquire({ venueId: 'dev-room', endpointId: 'qq:lead-bot' });
    await limiter.acquire({ venueId: 'dev-room', endpointId: 'qq:lead-bot' });

    expect(sleeps).toEqual([500]);
  });
});

describe('createVenueProjector', () => {
  it('projects hops in visible mode with @target prefix and triggers onProjected', async () => {
    const registry = createVenueRegistry([sampleVenue]);
    const sent: VenueProjectionSendInput[] = [];
    const projectedEvents: VenueProjectedEvent[] = [];

    const projector = createVenueProjector({
      registry,
      send: async (input) => {
        sent.push(input);
      },
      onProjected: (event) => {
        projectedEvents.push(event);
      },
    });

    const ok = await projector.projectHop({
      venueId: 'dev-room',
      mailId: 'mail-1',
      kind: 'ask',
      fromAgent: 'lead',
      toAgent: 'reviewer',
      content: '帮我看下这段逻辑',
    });

    expect(ok).toBe(true);
    expect(sent).toEqual([
      {
        venueId: 'dev-room',
        endpointId: 'qq:lead-bot',
        actor: 'lead',
        conversation: sampleVenue.conversation,
        text: '@审稿 帮我看下这段逻辑',
      },
    ]);
    expect(projectedEvents).toEqual([
      {
        venueId: 'dev-room',
        actor: 'lead',
        mailId: 'mail-1',
        mode: 'visible',
      },
    ]);
  });

  it('projects only start and conclusion hops in summary mode', async () => {
    const summaryVenue: VenueDefinition = {
      ...sampleVenue,
      id: 'summary-room',
      conversation: { platform: 'qq', sceneType: 'group', sceneId: 'group-summary' },
      visibility: 'summary',
    };
    const registry = createVenueRegistry([summaryVenue]);
    const sent: VenueProjectionSendInput[] = [];
    const projectedEvents: VenueProjectedEvent[] = [];

    const projector = createVenueProjector({
      registry,
      send: async (input) => {
        sent.push(input);
      },
      onProjected: (event) => {
        projectedEvents.push(event);
      },
    });

    const middle = await projector.projectHop({
      venueId: 'summary-room',
      mailId: 'm-mid',
      kind: 'ask',
      fromAgent: 'lead',
      toAgent: 'coder',
      content: 'middle step',
    });
    expect(middle).toBe(false);

    const start = await projector.projectHop({
      venueId: 'summary-room',
      mailId: 'm-start',
      kind: 'delegate',
      fromAgent: 'lead',
      toAgent: 'coder',
      content: 'starting work',
      isStart: true,
    });
    expect(start).toBe(true);

    const conclusion = await projector.projectHop({
      venueId: 'summary-room',
      mailId: 'm-end',
      kind: 'result',
      fromAgent: 'coder',
      toAgent: 'lead',
      content: 'all done',
      isConclusion: true,
    });
    expect(conclusion).toBe(true);

    expect(sent).toHaveLength(2);
    expect(sent[0]?.text).toBe('@码农 starting work');
    expect(sent[1]?.text).toBe('@队长 all done');
    expect(projectedEvents.map((e) => e.mailId)).toEqual(['m-start', 'm-end']);
    expect(projectedEvents.every((e) => e.mode === 'summary')).toBe(true);
  });

  it('suppresses all projections in backstage mode', async () => {
    const backstageVenue: VenueDefinition = {
      ...sampleVenue,
      id: 'backstage-room',
      conversation: { platform: 'qq', sceneType: 'private', sceneId: 'user-1' },
      visibility: undefined,
    };
    const registry = createVenueRegistry([backstageVenue]);
    const send = vi.fn(async () => undefined);
    const onProjected = vi.fn();

    const projector = createVenueProjector({
      registry,
      send,
      onProjected,
    });

    const projected = await projector.projectHop({
      venueId: 'backstage-room',
      mailId: 'm-1',
      kind: 'result',
      fromAgent: 'lead',
      content: 'done',
      isStart: true,
      isConclusion: true,
    });

    expect(projected).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(onProjected).not.toHaveBeenCalled();
  });
});
