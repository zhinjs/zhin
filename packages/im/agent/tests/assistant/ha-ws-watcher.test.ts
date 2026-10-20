import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HaWsTransport, buildWsUrl } from '../../src/assistant/domains/ha-ws-transport.js';
import {
  HomeStateWatch,
  buildWatchEntityMap,
  formatStateMessage,
} from '../../src/assistant/domains/home-state-watch.js';
import type { NotificationRouter } from '../../src/assistant/notification-router.js';
import type { JobNotify } from '../../src/assistant/types.js';

describe('buildWsUrl', () => {
  it('converts http to ws', () => {
    expect(buildWsUrl('http://ha.local:8123')).toBe('ws://ha.local:8123/api/websocket');
  });
  it('converts https to wss', () => {
    expect(buildWsUrl('https://ha.example.com')).toBe('wss://ha.example.com/api/websocket');
  });
});

describe('HaWsTransport', () => {
  it('auths and subscribes then emits state_changed', () => {
    const sent: string[] = [];
    const listeners = new Map<string, Array<(ev: { data?: unknown }) => void>>();
    const fakeSocket = {
      readyState: 1,
      send: (data: string) => { sent.push(data); },
      close: vi.fn(),
      addEventListener(type: string, listener: (ev: { data?: unknown }) => void) {
        const list = listeners.get(type) ?? [];
        list.push(listener);
        listeners.set(type, list);
      },
    };
    const onStateChanged = vi.fn();
    const transport = new HaWsTransport({
      wsUrl: 'ws://ha.local/api/websocket',
      token: 'tok',
      createSocket: () => fakeSocket,
      onStateChanged,
      reconnectDelayMs: 60_000,
    });
    transport.start();
    // simulate open then auth_required
    for (const l of listeners.get('open') ?? []) l({});
    transport.handleMessage({ type: 'auth_required' });
    expect(sent.some(s => s.includes('"type":"auth"'))).toBe(true);
    transport.handleMessage({ type: 'auth_ok' });
    expect(sent.some(s => s.includes('subscribe_events'))).toBe(true);
    transport.handleMessage({
      type: 'event',
      event: {
        data: {
          entity_id: 'light.living_room',
          old_state: { state: 'off' },
          new_state: { state: 'on', attributes: { brightness: 10 } },
        },
      },
    });
    expect(onStateChanged).toHaveBeenCalledWith(expect.objectContaining({
      entityId: 'light.living_room',
      newState: 'on',
    }));
    transport.dispose();
  });
});

describe('HomeStateWatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('buildWatchEntityMap skips unknown', () => {
    const map = buildWatchEntityMap({ 灯: 'light.x' }, ['灯', '无']);
    expect(map.get('light.x')).toBe('灯');
    expect(map.size).toBe(1);
  });

  it('debounces and delivers via router', async () => {
    const deliver = vi.fn().mockResolvedValue({ delivered: true, channel: 'im' });
    const router = { deliver } as unknown as NotificationRouter;
    const notify: JobNotify = { channel: 'silent' };
    const entityToAlias = new Map([['light.x', '客厅灯']]);
    const watch = new HomeStateWatch({
      wsUrl: 'ws://x',
      token: 't',
      entityToAlias,
      debounceMs: 100,
      notify,
      router,
      createTransport: () => ({ start: vi.fn(), dispose: vi.fn() }),
    });
    watch.start();
    watch.handleStateChanged({
      entityId: 'light.x',
      newState: 'on',
      oldState: 'off',
      attributes: { brightness: 50 },
    });
    watch.handleStateChanged({
      entityId: 'light.x',
      newState: 'on',
      oldState: 'off',
      attributes: { brightness: 80 },
    });
    expect(deliver).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0][0].content).toContain('客厅灯');
    expect(deliver.mock.calls[0][0].content).toContain('亮度: 80');
    watch.dispose();
  });

  it('formatStateMessage', () => {
    expect(formatStateMessage('灯', 'on', {})).toContain('灯');
  });
});
