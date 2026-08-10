import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Adapter, type Message, type Plugin } from '@zhin.js/core';
import * as core from '@zhin.js/core';
import {
  defaultCellId,
  handleCollabBind,
  handleCollabBindPrompt,
  handleCollabStatus,
  handleCollabUnbind,
} from '../../src/collaboration/collaboration-commands.js';
import {
  getCollaborationSceneService,
  resetCollaborationSceneService,
} from '../../src/collaboration/scene-service.js';
import { MemoryCollaborationSceneRepository } from '../../src/collaboration/collaboration-scene-repository.js';

vi.mock('../../src/collaboration/bootstrap-agent-runtimes.js', () => ({
  rebootstrapEndpointRuntimes: vi.fn(async () => {}),
}));

function groupMessage(
  sceneId = '373460458',
  endpoint = '8596238',
  content: Message['$content'] = [],
): Message {
  return {
    $adapter: 'icqq',
    $endpoint: endpoint,
    $channel: { type: 'group', id: sceneId },
    $sender: { id: '1659488338', isMaster: true },
    $content: content,
  } as Message;
}

type EndpointStub = { $connected: boolean; $platformUserId: string };

let getHostRootPluginSpy: ReturnType<typeof vi.spyOn> | undefined;

function installHostRoot(endpoints: Array<[string, EndpointStub]>) {
  const adapter = Object.create(Adapter.prototype) as Adapter & {
    endpoints: Map<string, EndpointStub>;
  };
  adapter.endpoints = new Map(endpoints);
  const host = {
    adapters: ['icqq'],
    inject: (name: string) => (name === 'icqq' ? adapter : undefined),
    root: null as unknown as Plugin,
  };
  host.root = host as unknown as Plugin;
  getHostRootPluginSpy?.mockRestore();
  getHostRootPluginSpy = vi.spyOn(core, 'getHostRootPlugin').mockReturnValue(host as Plugin);
}

async function seedEmptyCell(sceneId = '373460458') {
  await getCollaborationSceneService().upsertScene({
    id: defaultCellId('icqq', sceneId),
    adapter: 'icqq',
    sceneId,
    goal: '测试',
    members: [],
  });
}

describe('collaboration /collab commands', () => {
  beforeEach(async () => {
    resetCollaborationSceneService();
    const repo = new MemoryCollaborationSceneRepository();
    getCollaborationSceneService().setRepository(repo);
    await getCollaborationSceneService().reloadFromRepository();
    installHostRoot([
      ['8596238', { $connected: true, $platformUserId: '8596238' }],
      ['210723495', { $connected: true, $platformUserId: '210723495' }],
    ]);
  });

  afterEach(() => {
    getHostRootPluginSpy?.mockRestore();
    getHostRootPluginSpy = undefined;
    resetCollaborationSceneService();
    vi.clearAllMocks();
  });

  it('status is silent on non-mentioned bot in multi-bot group', async () => {
    const out = await handleCollabStatus(groupMessage());
    expect(out).toBe('');
  });

  it('binds and unbinds members in a single-bot group', async () => {
    installHostRoot([
      ['8596238', { $connected: true, $platformUserId: '8596238' }],
    ]);
    await seedEmptyCell();
    const bindOut = await handleCollabBind(groupMessage('373460458', '8596238'), '1689919782', 'evaluator');
    expect(bindOut).toContain('✅ 已绑定');
    const unbindOut = await handleCollabUnbind(groupMessage('373460458', '8596238'), 'evaluator');
    expect(unbindOut).toContain('✅ 已移除');
  });

  it('bind prompt is silent on non-mentioned bot in multi-bot group', async () => {
    await seedEmptyCell();
    const out = await handleCollabBindPrompt(groupMessage('373460458', '210723495'));
    expect(out).toBe('');
  });
});
