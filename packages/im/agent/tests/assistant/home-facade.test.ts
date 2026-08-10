import { describe, it, expect, vi } from 'vitest';
import { HomeFacade } from '../../src/assistant/home-facade.js';
import { HaHomeBackend } from '../../src/assistant/domains/ha-home-backend.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';

const policy = {
  requireMaster: true,
  confirmServices: ['lock', 'alarm_control_panel'],
  allowedServiceDomains: ['light', 'climate', 'scene', 'cover', 'script'],
};

const masterCtx = mockCommMessage({
  adapter: 'process',
  endpoint: '1',
  senderId: '100',
  scope: 'private',
  sceneId: '100',
});

const otherCtx = mockCommMessage({
  adapter: 'icqq',
  endpoint: '1',
  senderId: '999',
  scope: 'private',
  sceneId: '999',
});

function makeFacade(aliases: Record<string, string>, fetchMock = vi.fn()) {
  fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '[]' });
  const backend = new HaHomeBackend({
    enabled: true,
    restUrl: 'http://ha.local:8123',
    restToken: 't',
    aliases,
  }, fetchMock);
  return { facade: new HomeFacade({ backend, policy }), fetchMock, backend };
}

describe('HomeFacade policy', () => {
  it('non-master 读被拒绝', async () => {
    const { facade } = makeFacade({ 灯: 'light.x' });
    const r = await facade.getState('灯', otherCtx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('deny');
      expect(r.message).toContain('master');
    }
  });

  it('master 写 light 允许', async () => {
    const { facade } = makeFacade({ 灯: 'light.x' });
    const r = await facade.turnOn('灯', masterCtx);
    expect(r.ok).toBe(true);
  });

  it('master 写 lock 需审批', async () => {
    const { facade } = makeFacade({ 锁: 'lock.front' });
    const r = await facade.turnOff('锁', masterCtx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('needs_owner');
      expect(r.message).toContain('ZHIN_NEEDS_OWNER');
    }
  });

  it('listAliases 对 non-master 拒绝', async () => {
    const { facade } = makeFacade({ 灯: 'light.x' });
    const r = await facade.listAliases(otherCtx);
    expect(r.ok).toBe(false);
  });

  it('callService 拒绝非白名单 domain', async () => {
    const { facade } = makeFacade({ 锁: 'lock.front' });
    const r = await facade.callService('锁', 'unlock', undefined, masterCtx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('白名单');
  });
});
