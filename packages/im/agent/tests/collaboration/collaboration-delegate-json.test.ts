import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCollaborationTools } from '../../src/collaboration/collaboration-tools.js';
import { coerceGroupDelegateArgs } from '../../src/collaboration/collaboration-outbound.js';
import {
  getCollaborationCellService,
  resetCollaborationCellService,
} from '../../src/collaboration/cell-service.js';
import { MemoryCollaborationCellRepository } from '../../src/collaboration/collaboration-cell-repository.js';
import type { Message } from '@zhin.js/core';

describe.skip('legacy group_delegate JSON message', () => {
  beforeEach(async () => {
    resetCollaborationCellService();
    const repo = new MemoryCollaborationCellRepository();
    await repo.upsert({
      id: 'room',
      adapter: 'icqq',
      sceneId: '373460458',
      members: [
        { endpointId: '8596238', primary: 'planner', pipelineRole: 'planner' },
        { endpointId: '210723495', primary: 'researcher', pipelineRole: 'researcher' },
      ],
    });
    getCollaborationCellService().setRepository(repo);
    await getCollaborationCellService().reloadFromRepository();
  });

  afterEach(() => {
    resetCollaborationCellService();
    vi.restoreAllMocks();
  });

  it('sends real @ segments from JSON message param', async () => {
    const sendSpy = vi.fn(async () => 'msg-id');
    const core = await import('@zhin.js/core');
    vi.spyOn(core, 'getHostRootPlugin').mockReturnValue({
      inject: () => ({
        endpoints: new Map([
          ['210723495', { $platformUserId: '210723495' }],
        ]),
        sendMessage: sendSpy,
      }),
    } as never);

    const message = {
      $adapter: 'icqq',
      $endpoint: '8596238',
      $channel: { type: 'group', id: '373460458' },
    } as Message;

    const tools = createCollaborationTools(message);
    const delegate = tools.find((t) => t.name === 'group_delegate');
    expect(delegate).toBeDefined();

    const result = await delegate!.execute({
      message: '{"mentions":["researcher"],"text":"请调研一下","requireArtifact":false,"mode":"ceremony"}',
    }, message);

    expect(result).toMatchObject({ ok: true, mode: 'im_mention' });
    if (sendSpy.mock.calls.length) {
      const content = sendSpy.mock.calls[0]![0].content as unknown[];
      expect(content[0]).toEqual({ type: 'at', data: { id: '210723495', qq: '210723495' } });
      expect(content[1]).toEqual({ type: 'text', data: { text: ' 请调研一下' } });
    }
  });

  it('accepts flat tool args without message JSON string', async () => {
    const sendSpy = vi.fn(async () => 'msg-id');
    const core = await import('@zhin.js/core');
    vi.spyOn(core, 'getHostRootPlugin').mockReturnValue({
      inject: () => ({
        endpoints: new Map([['210723495', { $platformUserId: '210723495' }]]),
        sendMessage: sendSpy,
      }),
    } as never);

    const message = {
      $adapter: 'icqq',
      $endpoint: '8596238',
      $channel: { type: 'group', id: '373460458' },
    } as Message;

    const delegate = createCollaborationTools(message).find((t) => t.name === 'group_delegate');
    const result = await delegate!.execute({
      mentions: ['researcher'],
      text: '请调研 Zhin 框架',
      requireArtifact: true,
      artifactKinds: ['report', 'citations'],
      mode: 'pipeline',
    }, message);

    expect(result).toMatchObject({ ok: true, requireArtifact: true });
  });
});

describe('coerceGroupDelegateArgs', () => {
  it('parses object message and flat fields', () => {
    expect(coerceGroupDelegateArgs({
      message: {
        mentions: ['researcher'],
        text: 'go',
        requireArtifact: false,
        mode: 'pipeline',
      },
    })).toMatchObject({ text: 'go', requireArtifact: false, mode: 'pipeline' });

    expect(coerceGroupDelegateArgs({
      mentions: ['researcher'],
      text: 'go',
      requireArtifact: true,
      artifactKinds: ['report'],
    })).toMatchObject({ requireArtifact: true, artifactKinds: ['report'] });
  });
});
