import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HomeAssistantService,
  parseEntityDomain,
} from '../../src/assistant/domains/home-assistant.js';

describe('HomeAssistantService', () => {
  const homeConfig = {
    enabled: true,
    restUrl: 'http://ha.local:8123',
    restToken: 'test-token',
    aliases: {
      客厅灯: 'light.living_room',
      大门锁: 'lock.front_door',
    },
  };

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  it('解析 entity domain', () => {
    expect(parseEntityDomain('light.living_room')).toBe('light');
    expect(parseEntityDomain('lock.front')).toBe('lock');
  });

  it('resolveAlias 未知别名抛错', () => {
    const svc = new HomeAssistantService(homeConfig, fetchMock);
    expect(() => svc.resolveAlias('卧室灯')).toThrow(/未知设备别名/);
  });

  it('getState 调用 HA REST', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        state: 'on',
        attributes: { brightness: 128 },
        last_updated: '2026-06-05T10:00:00Z',
      }),
    });
    const svc = new HomeAssistantService(homeConfig, fetchMock);
    const state = await svc.getState('客厅灯');
    expect(state.entityId).toBe('light.living_room');
    expect(state.state).toBe('on');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ha.local:8123/api/states/light.living_room',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    );
  });

  it('turnOn 映射 light.turn_on', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '[]' });
    const svc = new HomeAssistantService(homeConfig, fetchMock);
    const result = await svc.turnOn('客厅灯');
    expect(result.service).toBe('light.turn_on');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ha.local:8123/api/services/light/turn_on',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ entity_id: 'light.living_room' }),
      }),
    );
  });

  it('turnOff lock 映射 lock.lock', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '[]' });
    const svc = new HomeAssistantService(homeConfig, fetchMock);
    const result = await svc.turnOff('大门锁');
    expect(result.service).toBe('lock.lock');
  });
});
