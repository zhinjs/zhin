import { beforeEach, describe, expect, it } from 'vitest';
import { handleChoice, startAdventure } from '../src/game-flow.js';
import { createMemoryGameServices } from '@zhin.js/game-kit';
import { createServices, type GameServices } from '../src/session-service.js';

let services: GameServices;

function makeMessage(senderId = 'u1') {
  return {
    $adapter: 'test',
    $endpoint: 'default',
    $channel: { type: 'group', id: 'g1' },
    $sender: { id: senderId, name: senderId },
    content: '',
    $reply: async () => 'mid-1',
  } as never;
}

async function startAndGetSession(senderId = 'u1') {
  const message = makeMessage(senderId);
  await startAdventure(services, message);
  const session = await services.sessions.getActiveForUser(
    'test-default-group:g1',
    senderId,
  );
  return { message, session: session! };
}

describe('text-adventure handleChoice', () => {
  beforeEach(() => {
    services = createMemoryGameServices(['adv_sessions', 'adv_profiles'], createServices);
  });

  it('requires 未满足时选项不可用（无 key 进不了 library）', async () => {
    const { message, session } = await startAndGetSession();
    await services.sessions.updateSession(session.id, { scene_id: 'garden' });

    const reply = await handleChoice(services, message, session.id, 'open_iron_door');
    expect(reply).toBe('该选项不可用。');
    const after = (await services.sessions.getById(session.id))!;
    expect(after.scene_id).toBe('garden');
  });

  it('requires 满足后同一选项可用（有 key 可进 library）', async () => {
    const { message, session } = await startAndGetSession();
    await services.sessions.updateSession(session.id, {
      scene_id: 'garden',
      inventory: JSON.stringify(['key']),
    });

    const reply = await handleChoice(services, message, session.id, 'open_iron_door');
    expect(reply).not.toBe('该选项不可用。');
    const after = (await services.sessions.getById(session.id))!;
    expect(after.scene_id).toBe('library');
  });

  it('终局（completed）可 restart 重开', async () => {
    const { message, session } = await startAndGetSession();
    await services.sessions.updateSession(session.id, {
      scene_id: 'treasure',
      status: 'completed',
      ending_id: 'treasure',
    });

    const reply = await handleChoice(services, message, session.id, 'restart');
    expect(reply).not.toBe('冒险不存在或已结束。');
    const after = (await services.sessions.getById(session.id))!;
    expect(after.status).toBe('active');
    expect(after.scene_id).toBe('start');
    expect(after.hp).toBe(100);
    expect(after.ending_id).toBe('');
  });

  it('终局非 restart 选项仍被拒绝', async () => {
    const { message, session } = await startAndGetSession();
    await services.sessions.updateSession(session.id, {
      scene_id: 'treasure',
      status: 'completed',
      ending_id: 'treasure',
    });

    const reply = await handleChoice(services, message, session.id, 'push_door');
    expect(reply).toBe('冒险不存在或已结束。');
  });
});
