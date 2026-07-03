import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Message } from '@zhin.js/core';
import * as core from '@zhin.js/core';
import {
  defaultCellId,
  handleCollabBind,
  handleCollabBindPrompt,
  handleCollabStatus,
  handleCollabUnbind,
} from '../../src/collaboration/collaboration-commands.js';
import {
  getCollaborationCellService,
  resetCollaborationCellService,
} from '../../src/collaboration/cell-service.js';
import { MemoryCollaborationCellRepository } from '../../src/collaboration/collaboration-cell-repository.js';

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

function mockMultiBotRoot() {
  vi.spyOn(core, 'getHostRootPlugin').mockReturnValue({
    adapters: ['icqq'],
    inject: () => ({
      endpoints: new Map([
        ['8596238', { $connected: true, $platformUserId: '8596238' }],
        ['210723495', { $connected: true, $platformUserId: '210723495' }],
      ]),
    }),
  } as never);
}

function mockSingleBotRoot() {
  vi.spyOn(core, 'getHostRootPlugin').mockReturnValue({
    adapters: ['icqq'],
    inject: () => ({
      endpoints: new Map([
        ['8596238', { $connected: true, $platformUserId: '8596238' }],
      ]),
    }),
  } as never);
}

async function seedEmptyCell(sceneId = '373460458') {
  await getCollaborationCellService().upsertCell({
    id: defaultCellId('icqq', sceneId),
    adapter: 'icqq',
    sceneId,
    goal: '测试',
    members: [],
  });
}

describe('collaboration /collab commands', () => {
  beforeEach(async () => {
    resetCollaborationCellService();
    const repo = new MemoryCollaborationCellRepository();
    getCollaborationCellService().setRepository(repo);
    await getCollaborationCellService().reloadFromRepository();
    mockMultiBotRoot();
  });

  afterEach(() => {
    resetCollaborationCellService();
    vi.clearAllMocks();
  });

  it('status is silent on non-mentioned bot in multi-bot group', async () => {
    const out = await handleCollabStatus(groupMessage());
    expect(out).toBe('');
  });

  it('binds and unbinds members in a single-bot group', async () => {
    mockSingleBotRoot();
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
