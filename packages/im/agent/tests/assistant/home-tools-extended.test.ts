import { describe, it, expect, vi } from 'vitest';
import { createHomeTools } from '../../src/assistant/home-tools.js';
import { HomeFacade } from '../../src/assistant/home-facade.js';
import { HaHomeBackend } from '../../src/assistant/domains/ha-home-backend.js';
import type { ToolExecutionContext } from '@zhin.js/tool';
import { bootstrapAssistantHome } from '../../src/assistant/bootstrap-assistant-home.js';

const policy = {
  requireMaster: true,
  confirmServices: ['lock', 'alarm_control_panel'],
  allowedServiceDomains: ['light', 'climate', 'scene', 'cover', 'script'],
};

const masterCtx = {
  signal: new AbortController().signal,
  traceId: 'trace-home',
  turnId: 'turn-home',
  sessionKey: 'im:process:1:private:100',
  origin: { kind: 'im', platform: 'process', endpoint: '1', scope: 'private', sceneId: '100' },
  principal: { subjectId: '100', roles: ['master'] },
} as ToolExecutionContext;

function makeTools(aliases: Record<string, string>) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '[]' });
  const backend = new HaHomeBackend({
    enabled: true,
    restUrl: 'http://ha.local:8123',
    restToken: 't',
    aliases,
  }, fetchMock);
  const facade = new HomeFacade({ backend, policy });
  const tools = createHomeTools({ facade });
  return {
    fetchMock,
    find(name: string) {
      return tools.find(t => t.name === name)!;
    },
  };
}

describe('home tools via facade', () => {
  it('fails closed when enabled Home has no REST authority', async () => {
    await expect(bootstrapAssistantHome({
      homeRaw: { enabled: true },
      projectRoot: '/unused',
      notificationRouter: {} as never,
    })).rejects.toThrow('restUrl is required');
  });

  it('home_set_brightness', async () => {
    const { find, fetchMock } = makeTools({ 客厅灯: 'light.living_room' });
    const result = await find('home_set_brightness').definition.execute({ alias: '客厅灯', brightness: 128 }, masterCtx) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(result.brightness).toBe(128);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('rejects invalid brightness', async () => {
    const { find } = makeTools({ 灯: 'light.x' });
    const result = await find('home_set_brightness').definition.execute({ alias: '灯', brightness: 300 }, masterCtx) as Record<string, unknown>;
    expect(result.error).toContain('0–255');
  });

  it('home_set_temperature', async () => {
    const { find } = makeTools({ 空调: 'climate.living_room' });
    const result = await find('home_set_temperature').definition.execute({ alias: '空调', temperature: 24 }, masterCtx) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(result.temperature).toBe(24);
  });

  it('home_activate_scene', async () => {
    const { find } = makeTools({ 回家模式: 'scene.arrive_home' });
    const result = await find('home_activate_scene').definition.execute({ alias: '回家模式' }, masterCtx) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(result.domain).toBe('scene');
  });

  it('rejects non-scene for activate', async () => {
    const { find } = makeTools({ 灯: 'light.x' });
    const result = await find('home_activate_scene').definition.execute({ alias: '灯' }, masterCtx) as Record<string, unknown>;
    expect(result.error).toContain('不是 scene 或 script');
  });

  it('home_set_cover_position', async () => {
    const { find } = makeTools({ 窗帘: 'cover.living_room' });
    const result = await find('home_set_cover_position').definition.execute({ alias: '窗帘', position: 50 }, masterCtx) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(result.position).toBe(50);
  });

  it('home_call_service whitelist deny', async () => {
    const { find } = makeTools({ 锁: 'lock.front' });
    const result = await find('home_call_service').definition.execute({ alias: '锁', service: 'unlock' }, masterCtx) as Record<string, unknown>;
    expect(result.error).toContain('白名单');
  });
});
