import { describe, it, expect, beforeEach } from 'vitest';
import { MessageCommand, type Message, type Plugin } from '@zhin.js/core';
import {
  SceneIdentityService,
  setSceneIdentityService,
  getSceneIdentityService,
} from '../../src/collaboration/scene-identity-service.js';
import {
  startInitWizard,
  aggregateAndActivate,
  cancelInitWizard,
  advanceWizardStep,
} from '../../src/collaboration/init-wizard-service.js';
import {
  observeAtForInitWizard,
  extractAtTargets,
  buildRegisteredEndpointMap,
  handleInitWizardInboundGate,
} from '../../src/collaboration/init-observe-hook.js';
import { checkCollabAdminGate } from '../../src/collaboration/collab-admin-gate.js';
import {
  MemoryCollaborationSceneRepository,
  setCollaborationSceneRepository,
} from '../../src/collaboration/collaboration-scene-repository.js';
import {
  getCollaborationSceneService,
  resetCollaborationSceneService,
} from '../../src/collaboration/scene-service.js';

function makeMessage(overrides: Partial<Message> & { $content?: Array<{ type: string; data?: Record<string, unknown> }> } = {}): Message {
  return {
    $adapter: 'icqq',
    $endpoint: 'ep1',
    $channel: { type: 'group', id: '373460458' },
    $sender: { id: '1659488338' },
    $content: [],
    ...overrides,
  } as unknown as Message;
}

function makeRoot(endpoints: Record<string, Record<string, { $connected?: boolean; $config?: Record<string, unknown>; $platformUserId?: string }>>) {
  return {
    adapters: Object.keys(endpoints),
    inject: (name: string) => {
      const eps = endpoints[name];
      if (!eps) return undefined;
      return {
        endpoints: new Map(
          Object.entries(eps).map(([id, ep]) => [id, ep]),
        ),
      };
    },
  } as unknown as Plugin;
}

describe('SceneIdentityService', () => {
  let svc: SceneIdentityService;

  beforeEach(() => {
    svc = new SceneIdentityService();
    setSceneIdentityService(svc);

    resetCollaborationSceneService();
    const repo = new MemoryCollaborationSceneRepository();
    setCollaborationSceneRepository(repo);
    getCollaborationSceneService().setRepository(repo);
  });

  it('resolveLogicalScene returns undefined when no aliases', () => {
    expect(svc.resolveLogicalScene('icqq', '373460458')).toBeUndefined();
  });

  it('registerSceneAlias + resolveLogicalScene round-trip', async () => {
    const cellSvc = getCollaborationSceneService();
    await cellSvc.upsertScene({
      id: 'test-cell',
      adapter: 'icqq',
      sceneId: '373460458',
      members: [],
    });

    await svc.registerSceneAlias('test-cell', 'icqq', '373460458');
    await svc.registerSceneAlias('test-cell', 'qq', 'group_openid_abc');

    const fromIcqq = svc.resolveLogicalScene('icqq', '373460458');
    expect(fromIcqq?.id).toBe('test-cell');

    const fromQq = svc.resolveLogicalScene('qq', 'group_openid_abc');
    expect(fromQq?.id).toBe('test-cell');
  });

  it('findActiveInitSessionForInbound falls back to single global wizard session', async () => {
    await svc.createInitSession({
      id: 'init-only',
      logicalSceneId: 'cell-a',
      plannerEndpointId: 'bot-planner',
      plannerAdapter: 'icqq',
      plannerSceneId: '373460458',
    });

    const found = await svc.findActiveInitSessionForInbound('qq', 'group_openid_xyz');
    expect(found?.id).toBe('init-only');
  });

  it('listAliases returns all aliases for a cell', async () => {
    await svc.registerSceneAlias('cell-1', 'icqq', '111');
    await svc.registerSceneAlias('cell-1', 'qq', '222');
    await svc.registerSceneAlias('cell-2', 'icqq', '333');

    const aliases = await svc.listAliases('cell-1');
    expect(aliases).toHaveLength(2);
    expect(aliases.map((a) => a.adapter).sort()).toEqual(['icqq', 'qq']);
  });
});

describe('Init Wizard', () => {
  let sceneSvc: SceneIdentityService;

  beforeEach(() => {
    sceneSvc = new SceneIdentityService();
    setSceneIdentityService(sceneSvc);

    resetCollaborationSceneService();
    const repo = new MemoryCollaborationSceneRepository();
    setCollaborationSceneRepository(repo);
    getCollaborationSceneService().setRepository(repo);
  });

  it('startInitWizard creates session and returns researcher prompt', async () => {
    const result = await startInitWizard({
      plannerEndpointId: '8596238',
      plannerAdapter: 'icqq',
      plannerSceneId: '373460458',
    });
    expect(result.ok).toBe(true);
    expect(result.sessionId).toBeTruthy();
    expect(result.prompt).toContain('调研员');
  });

  it('duplicate startInitWizard returns existing session warning', async () => {
    await startInitWizard({
      plannerEndpointId: '8596238',
      plannerAdapter: 'icqq',
      plannerSceneId: '373460458',
    });
    const dup = await startInitWizard({
      plannerEndpointId: '8596238',
      plannerAdapter: 'icqq',
      plannerSceneId: '373460458',
    });
    expect(dup.ok).toBe(true);
    expect(dup.prompt).toContain('已有进行中');
  });

  it('cancelInitWizard cancels active session', async () => {
    await startInitWizard({
      plannerEndpointId: '8596238',
      plannerAdapter: 'icqq',
      plannerSceneId: '373460458',
    });
    const result = await cancelInitWizard('icqq', '373460458');
    expect(result.ok).toBe(true);

    const after = await startInitWizard({
      plannerEndpointId: '8596238',
      plannerAdapter: 'icqq',
      plannerSceneId: '373460458',
    });
    expect(after.prompt).toContain('调研员');
  });

  it('advanceWizardStep CAS prevents double skip on concurrent @', async () => {
    const { sessionId } = await startInitWizard({
      plannerEndpointId: 'bot-planner',
      plannerAdapter: 'icqq',
      plannerSceneId: '373460458',
    });
    const session = (await sceneSvc.getInitSession(sessionId!))!;

    const [first, second] = await Promise.all([
      advanceWizardStep(session, 'researcher'),
      advanceWizardStep(session, 'researcher'),
    ]);

    const advancedCount = [first, second].filter((r) => r.advanced).length;
    expect(advancedCount).toBe(1);

    const fresh = (await sceneSvc.getInitSession(sessionId!))!;
    expect(fresh.wizardStep).toBe('evaluator');
    expect([first, second].filter((r) => r.advanced)[0]!.nextPrompt).toContain('评估员');
  });
});

describe('5 Bot observation aggregation', () => {
  let sceneSvc: SceneIdentityService;

  beforeEach(() => {
    sceneSvc = new SceneIdentityService();
    setSceneIdentityService(sceneSvc);

    resetCollaborationSceneService();
    const repo = new MemoryCollaborationSceneRepository();
    setCollaborationSceneRepository(repo);
    getCollaborationSceneService().setRepository(repo);
  });

  it('aggregates observations from 5 bots into 1 cell', async () => {
    const { sessionId } = await startInitWizard({
      plannerEndpointId: 'bot-planner',
      plannerAdapter: 'icqq',
      plannerSceneId: '373460458',
    });

    const bots = ['bot-1', 'bot-2', 'bot-3', 'bot-4', 'bot-planner'];
    const roles = ['researcher', 'evaluator', 'executor', 'reviewer'];

    for (let step = 0; step < roles.length; step++) {
      const wizardStep = roles[step]!;
      await sceneSvc.updateInitSessionStep(sessionId!, wizardStep);

      for (const bot of bots) {
        await sceneSvc.addObservation({
          sessionId: sessionId!,
          observerEndpointId: bot,
          observerAdapter: 'icqq',
          observerSceneId: '373460458',
          atTargetPlatformId: `target-${wizardStep}`,
          wizardStep,
        });
      }
    }

    const observations = await sceneSvc.listObservations(sessionId!);
    expect(observations).toHaveLength(20);

    const registeredEndpoints = new Map([
      ['target-researcher', { adapter: 'icqq', endpointId: 'bot-researcher' }],
      ['target-evaluator', { adapter: 'icqq', endpointId: 'bot-evaluator' }],
      ['target-executor', { adapter: 'icqq', endpointId: 'bot-executor' }],
      ['target-reviewer', { adapter: 'icqq', endpointId: 'bot-reviewer' }],
    ]);

    const session = (await sceneSvc.getInitSession(sessionId!))!;
    const result = await aggregateAndActivate(session, registeredEndpoints, 'planner');

    expect(result.ok).toBe(true);
    expect(result.memberCount).toBe(5);
    expect(result.scene).toBeTruthy();
    expect(result.scene!.members.map((m) => m.pipelineRole).sort()).toEqual(
      ['evaluator', 'executor', 'planner', 'researcher', 'reviewer'],
    );
    expect(result.warnings).toHaveLength(0);
  });

  it('warns about missing roles', async () => {
    const { sessionId } = await startInitWizard({
      plannerEndpointId: 'bot-planner',
      plannerAdapter: 'icqq',
      plannerSceneId: '373460458',
    });

    await sceneSvc.addObservation({
      sessionId: sessionId!,
      observerEndpointId: 'bot-1',
      observerAdapter: 'icqq',
      observerSceneId: '373460458',
      atTargetPlatformId: 'target-researcher',
      wizardStep: 'researcher',
    });

    const registeredEndpoints = new Map([
      ['target-researcher', { adapter: 'icqq', endpointId: 'bot-researcher' }],
    ]);

    const session = (await sceneSvc.getInitSession(sessionId!))!;
    const result = await aggregateAndActivate(session, registeredEndpoints, 'planner');

    expect(result.ok).toBe(true);
    expect(result.memberCount).toBe(2);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('evaluator');
  });
});

describe('Cross-adapter scene aliases', () => {
  let sceneSvc: SceneIdentityService;

  beforeEach(() => {
    sceneSvc = new SceneIdentityService();
    setSceneIdentityService(sceneSvc);

    resetCollaborationSceneService();
    const repo = new MemoryCollaborationSceneRepository();
    setCollaborationSceneRepository(repo);
    getCollaborationSceneService().setRepository(repo);
  });

  it('icqq + qq observations create cross-adapter scene aliases', async () => {
    const { sessionId } = await startInitWizard({
      plannerEndpointId: 'bot-planner',
      plannerAdapter: 'icqq',
      plannerSceneId: '373460458',
    });

    await sceneSvc.addObservation({
      sessionId: sessionId!,
      observerEndpointId: 'bot-icqq-1',
      observerAdapter: 'icqq',
      observerSceneId: '373460458',
      atTargetPlatformId: 'target-r',
      wizardStep: 'researcher',
    });
    await sceneSvc.addObservation({
      sessionId: sessionId!,
      observerEndpointId: 'bot-qq-1',
      observerAdapter: 'qq',
      observerSceneId: 'group_openid_xyz',
      atTargetPlatformId: 'target-r',
      wizardStep: 'researcher',
    });

    const registeredEndpoints = new Map([
      ['target-r', { adapter: 'icqq', endpointId: 'bot-researcher' }],
    ]);

    const session = (await sceneSvc.getInitSession(sessionId!))!;
    const result = await aggregateAndActivate(session, registeredEndpoints, 'planner');

    expect(result.ok).toBe(true);
    expect(result.sceneCount).toBeGreaterThanOrEqual(2);

    const cellSvc = getCollaborationSceneService();
    const cell = cellSvc.getScene(result.scene!.id);
    expect(cell).toBeTruthy();

    const fromIcqq = sceneSvc.resolveLogicalScene('icqq', '373460458');
    expect(fromIcqq?.id).toBe(cell!.id);

    const fromQq = sceneSvc.resolveLogicalScene('qq', 'group_openid_xyz');
    expect(fromQq?.id).toBe(cell!.id);
  });
});

describe('handleInitWizardInboundGate', () => {
  let sceneSvc: SceneIdentityService;

  beforeEach(() => {
    sceneSvc = new SceneIdentityService();
    setSceneIdentityService(sceneSvc);
  });

  it('blocks non-planner bot during active wizard', async () => {
    await startInitWizard({
      plannerEndpointId: '8596238',
      plannerAdapter: 'icqq',
      plannerSceneId: '373460458',
    });

    const root = makeRoot({
      icqq: {
        '8596238': { $connected: true, $platformUserId: '8596238' },
        '210723495': { $connected: true, $platformUserId: '210723495' },
      },
    });

    const msg = makeMessage({
      $endpoint: '210723495',
      $content: [{ type: 'at', data: { qq: '210723495' } }],
    });

    const gate = await handleInitWizardInboundGate(msg, '210723495', root);
    expect(gate.action).toBe('block');
  });
});

describe('/collab init <planner:at> command parsing', () => {
  it('parses icqq at segment qq field as planner id', async () => {
    const cmd = new MessageCommand('/collab init <planner:at>', {
      at: ['user_id', 'qq', 'id'],
    }).action(async (_message, matched) => matched.params.planner as string);

    const msg = {
      $content: [
        { type: 'text', data: { text: '/collab init ' } },
        { type: 'at', data: { qq: '8596238' } },
      ],
    } as unknown as Message;

    const result = await cmd.handle(msg, {} as never);
    expect(result).toBe('8596238');
  });
});

describe('extractAtTargets', () => {
  it('extracts at target ids from message $content segments', () => {
    const msg = makeMessage({
      $content: [
        { type: 'at', data: { qq: '8596238' } },
        { type: 'text', data: { text: 'hello' } },
        { type: 'at', data: { user_id: '210723495' } },
      ],
    });
    expect(extractAtTargets(msg)).toEqual(['8596238', '210723495']);
  });

  it('returns empty for no at segments', () => {
    const msg = makeMessage({ $content: [{ type: 'text', data: { text: 'hi' } }] });
    expect(extractAtTargets(msg)).toEqual([]);
  });
});

describe('checkCollabAdminGate', () => {
  const root = makeRoot({
    icqq: {
      ep1: { $connected: true, $platformUserId: '8596238' },
      ep2: { $connected: true, $platformUserId: '210723495' },
    },
  });

  it('allows when message @-mentions this endpoint', () => {
    const msg = makeMessage({
      $endpoint: 'ep1',
      $content: [{ type: 'at', data: { qq: '8596238' } }],
    });
    expect(checkCollabAdminGate(msg, 'ep1', root).allowed).toBe(true);
  });

  it('blocks when message @-mentions another endpoint', () => {
    const msg = makeMessage({
      $endpoint: 'ep1',
      $content: [{ type: 'at', data: { qq: '210723495' } }],
    });
    const result = checkCollabAdminGate(msg, 'ep1', root);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('at_other_endpoint');
  });

  it('blocks when no @ and multiple bots online', () => {
    const msg = makeMessage({ $endpoint: 'ep1', $content: [] });
    const result = checkCollabAdminGate(msg, 'ep1', root);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('multi_bot_no_mention');
  });

  it('allows when no @ and single bot online', () => {
    const singleRoot = makeRoot({
      icqq: {
        ep1: { $connected: true, $platformUserId: '8596238' },
      },
    });
    const msg = makeMessage({ $endpoint: 'ep1', $content: [] });
    expect(checkCollabAdminGate(msg, 'ep1', singleRoot).allowed).toBe(true);
  });
});

describe('buildRegisteredEndpointMap', () => {
  it('maps platform ids to adapter/endpointId refs', () => {
    const root = makeRoot({
      icqq: {
        ep1: { $platformUserId: '8596238', $config: { name: 'planner-bot' } },
        ep2: { $platformUserId: '210723495' },
      },
      qq: {
        ep3: { $platformUserId: 'user_openid_abc', $config: { appid: 'app123' } },
      },
    });
    const map = buildRegisteredEndpointMap(root);

    expect(map.get('8596238')).toEqual({ adapter: 'icqq', endpointId: 'ep1' });
    expect(map.get('planner-bot')).toEqual({ adapter: 'icqq', endpointId: 'ep1' });
    expect(map.get('ep2')).toEqual({ adapter: 'icqq', endpointId: 'ep2' });
    expect(map.get('app123')).toEqual({ adapter: 'qq', endpointId: 'ep3' });
  });
});

describe('Member channels (identity edge table)', () => {
  let sceneSvc: SceneIdentityService;

  beforeEach(() => {
    sceneSvc = new SceneIdentityService();
    setSceneIdentityService(sceneSvc);

    resetCollaborationSceneService();
    const repo = new MemoryCollaborationSceneRepository();
    setCollaborationSceneRepository(repo);
    getCollaborationSceneService().setRepository(repo);
  });

  it('aggregation produces per-member per-adapter channels', async () => {
    const { sessionId } = await startInitWizard({
      plannerEndpointId: 'bot-planner',
      plannerAdapter: 'icqq',
      plannerSceneId: '373460458',
    });

    await sceneSvc.addObservation({
      sessionId: sessionId!,
      observerEndpointId: 'bot-icqq-obs',
      observerAdapter: 'icqq',
      observerSceneId: '373460458',
      atTargetPlatformId: 'imarndde',
      wizardStep: 'researcher',
    });
    await sceneSvc.addObservation({
      sessionId: sessionId!,
      observerEndpointId: 'bot-qq-obs',
      observerAdapter: 'qq',
      observerSceneId: 'mtzpaqker',
      atTargetPlatformId: 'wbuaobfpgug',
      wizardStep: 'researcher',
    });

    const registeredEndpoints = new Map([
      ['imarndde', { adapter: 'icqq', endpointId: 'bot-researcher' }],
      ['wbuaobfpgug', { adapter: 'qq', endpointId: 'bot-researcher' }],
    ]);

    const session = (await sceneSvc.getInitSession(sessionId!))!;
    const result = await aggregateAndActivate(session, registeredEndpoints, 'planner');

    expect(result.ok).toBe(true);
    expect(result.channelCount).toBeGreaterThanOrEqual(2);

    const channels = await sceneSvc.listMemberChannels(result.scene!.id);
    const researcherChannels = channels.filter((c) => c.pipelineRole === 'researcher');
    expect(researcherChannels).toHaveLength(2);

    const adapters = researcherChannels.map((c) => c.adapter).sort();
    expect(adapters).toEqual(['icqq', 'qq']);

    const icqqCh = researcherChannels.find((c) => c.adapter === 'icqq')!;
    expect(icqqCh.sceneId).toBe('373460458');
    expect(icqqCh.botId).toBe('imarndde');

    const qqCh = researcherChannels.find((c) => c.adapter === 'qq')!;
    expect(qqCh.sceneId).toBe('mtzpaqker');
    expect(qqCh.botId).toBe('wbuaobfpgug');
  });

  it('buildGroupView outputs expected { group_id, agents[].channels[] } format', async () => {
    const { sessionId } = await startInitWizard({
      plannerEndpointId: 'bot-planner',
      plannerAdapter: 'icqq',
      plannerSceneId: '373460458',
    });

    const roles = ['researcher', 'evaluator', 'executor', 'reviewer'];
    for (const role of roles) {
      await sceneSvc.updateInitSessionStep(sessionId!, role);

      await sceneSvc.addObservation({
        sessionId: sessionId!,
        observerEndpointId: 'bot-icqq-obs',
        observerAdapter: 'icqq',
        observerSceneId: '373460458',
        atTargetPlatformId: `icqq-${role}-id`,
        wizardStep: role,
      });
      await sceneSvc.addObservation({
        sessionId: sessionId!,
        observerEndpointId: 'bot-qq-obs',
        observerAdapter: 'qq',
        observerSceneId: 'mtzpaqker',
        atTargetPlatformId: `qq-${role}-id`,
        wizardStep: role,
      });
    }

    const registeredEndpoints = new Map<string, { adapter: string; endpointId: string }>();
    for (const role of roles) {
      registeredEndpoints.set(`icqq-${role}-id`, { adapter: 'icqq', endpointId: `bot-${role}` });
      registeredEndpoints.set(`qq-${role}-id`, { adapter: 'qq', endpointId: `bot-${role}` });
    }

    const session = (await sceneSvc.getInitSession(sessionId!))!;
    const result = await aggregateAndActivate(session, registeredEndpoints, 'planner');
    expect(result.ok).toBe(true);

    const view = await sceneSvc.buildGroupView(result.scene!.id, 'zhinTest');

    expect(view.group_id).toBe(result.scene!.id);
    expect(view.group_name).toBe('zhinTest');
    expect(view.agents).toHaveLength(5);

    const plannerAgent = view.agents.find((a) => a.name === 'planner');
    expect(plannerAgent).toBeTruthy();
    expect(plannerAgent!.channels.length).toBeGreaterThanOrEqual(2);

    for (const role of roles) {
      const agent = view.agents.find((a) => a.name === role);
      expect(agent).toBeTruthy();
      expect(agent!.channels).toHaveLength(2);

      const icqqCh = agent!.channels.find((c) => c.adapter === 'icqq');
      expect(icqqCh).toBeTruthy();
      expect(icqqCh!.scene_id).toBe('373460458');
      expect(icqqCh!.bot_id).toBe(`icqq-${role}-id`);

      const qqCh = agent!.channels.find((c) => c.adapter === 'qq');
      expect(qqCh).toBeTruthy();
      expect(qqCh!.scene_id).toBe('mtzpaqker');
      expect(qqCh!.bot_id).toBe(`qq-${role}-id`);
    }
  });

  it('planInitFromObservations ignores wizard_step done', async () => {
    const { sessionId } = await startInitWizard({
      plannerEndpointId: 'bot-planner',
      plannerAdapter: 'icqq',
      plannerSceneId: '373460458',
    });

    await sceneSvc.addObservation({
      sessionId: sessionId!,
      observerEndpointId: 'bot-1',
      observerAdapter: 'icqq',
      observerSceneId: '373460458',
      atTargetPlatformId: 'target-reviewer',
      wizardStep: 'reviewer',
    });
    await sceneSvc.addObservation({
      sessionId: sessionId!,
      observerEndpointId: 'bot-1',
      observerAdapter: 'icqq',
      observerSceneId: '373460458',
      atTargetPlatformId: 'target-planner',
      wizardStep: 'done',
    });

    const registeredEndpoints = new Map([
      ['target-reviewer', { adapter: 'icqq', endpointId: 'bot-reviewer' }],
      ['target-planner', { adapter: 'icqq', endpointId: 'bot-planner' }],
    ]);

    const observations = await sceneSvc.listObservations(sessionId!);
    const plan = sceneSvc.planInitFromObservations('cell-1', observations, registeredEndpoints);
    expect(plan.members.map((m) => m.pipelineRole)).toEqual(['reviewer']);
  });

  it('saveMemberChannels + listMemberChannels round-trip (memory)', async () => {
    const channels = [
      { logicalSceneId: 'cell-1', endpointId: 'ep1', pipelineRole: 'planner', adapter: 'icqq', sceneId: '111', botId: 'bid1' },
      { logicalSceneId: 'cell-1', endpointId: 'ep2', pipelineRole: 'researcher', adapter: 'qq', sceneId: '222', botId: 'bid2' },
    ];
    await sceneSvc.saveMemberChannels('cell-1', channels);

    const loaded = await sceneSvc.listMemberChannels('cell-1');
    expect(loaded).toHaveLength(2);
    expect(loaded[0]!.botId).toBe('bid1');
    expect(loaded[1]!.botId).toBe('bid2');

    const empty = await sceneSvc.listMemberChannels('cell-other');
    expect(empty).toHaveLength(0);
  });
});
