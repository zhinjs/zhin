import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  INSTANCE_BRIDGE_PROTOCOL_VERSION,
  INSTANCE_CHILD_ENV,
  openInstanceControlChannel,
  parseGatewayMessage,
  parseInstanceMessage,
  type InstanceIpcPort,
} from '../src/bridge/index.js';

class FakePort extends EventEmitter {
  readonly sent: unknown[] = [];
  connected = true;
  unrefCalls = 0;
  readonly channel = { unref: () => { this.unrefCalls += 1; } };
  send(message: unknown, callback?: (error: Error | null) => void): boolean {
    this.sent.push(message);
    callback?.(null);
    return true;
  }
}

describe('bridge protocol', () => {
  it('accepts well-formed instance messages and rejects malformed ones', () => {
    expect(parseInstanceMessage({ type: 'ready', payload: { version: 1, pid: 3, generation: 2 } })).toBeDefined();
    expect(parseInstanceMessage({ type: 'restart-request', payload: { reason: 'console' } })).toBeDefined();
    for (const bad of [
      null, 'ready', [], { type: 'ready' }, { type: 'ready', payload: { version: '1', pid: 3 } },
      { type: 'ready', payload: { version: 1 } }, { type: 'ready', payload: { version: 1, pid: 3, generation: -1 } },
      { type: 'restart-request', payload: {} }, { type: 'unknown', payload: {} },
      { type: 'restart-request', id: 4, payload: { reason: 'x' } },
    ]) expect(parseInstanceMessage(bad), JSON.stringify(bad)).toBeUndefined();
  });

  it('accepts well-formed gateway messages and rejects malformed ones', () => {
    expect(parseGatewayMessage({ type: 'shutdown', payload: { reason: 'stop', budgetMs: 5000 } })).toBeDefined();
    for (const bad of [
      { type: 'shutdown', payload: { reason: 'stop' } },
      { type: 'shutdown', payload: { reason: 'stop', budgetMs: -1 } },
      { type: 'shutdown', payload: { reason: 'stop', budgetMs: Number.NaN } },
      { type: 'ready', payload: { version: 1, pid: 1 } },
    ]) expect(parseGatewayMessage(bad), JSON.stringify(bad)).toBeUndefined();
  });
});

/** Environment the gateway gives its instance child. */
const CHILD_ENV = { [INSTANCE_CHILD_ENV]: '1' };

describe('openInstanceControlChannel', () => {
  it('is absent without an IPC channel', () => {
    const port = new FakePort() as unknown as InstanceIpcPort & { send?: unknown };
    (port as { send?: unknown }).send = undefined;
    expect(openInstanceControlChannel(port, 1, CHILD_ENV)).toBeUndefined();
  });

  it('is absent when another parent opened the IPC channel (no gateway marker)', () => {
    // Regression: inside a test runner's fork worker the instance mistook the runner's IPC
    // channel for the gateway, unref'd it, sent control messages to it and exited the worker.
    const port = new FakePort();
    expect(openInstanceControlChannel(port, 1, {})).toBeUndefined();
    expect(port.unrefCalls).toBe(0);
    expect(port.listenerCount('message')).toBe(0);
  });

  it('sends ready with the protocol version and restart-request, and unrefs the channel', () => {
    const port = new FakePort();
    const channel = openInstanceControlChannel(port, 42, CHILD_ENV)!;
    expect(port.unrefCalls).toBe(1);
    channel.ready({ generation: 7 });
    channel.requestRestart('console');
    expect(port.sent).toEqual([
      { type: 'ready', payload: { version: INSTANCE_BRIDGE_PROTOCOL_VERSION, pid: 42, generation: 7 } },
      { type: 'restart-request', payload: { reason: 'console' } },
    ]);
  });

  it('delivers valid shutdown messages and ignores garbage', () => {
    const port = new FakePort();
    const channel = openInstanceControlChannel(port, 1, CHILD_ENV)!;
    const received: unknown[] = [];
    channel.onShutdown((payload) => { received.push(payload); });
    port.emit('message', { type: 'shutdown', payload: { reason: 'stop', budgetMs: 10 } });
    port.emit('message', { type: 'shutdown', payload: {} });
    port.emit('message', 'noise');
    expect(received).toEqual([{ reason: 'stop', budgetMs: 10 }]);
  });

  it('reports disconnect and stops sending afterwards; close detaches listeners', () => {
    const port = new FakePort();
    const channel = openInstanceControlChannel(port, 1, CHILD_ENV)!;
    let disconnected = 0;
    channel.onDisconnect(() => { disconnected += 1; });
    port.emit('disconnect');
    expect(disconnected).toBe(1);
    expect(channel.connected).toBe(false);
    channel.requestRestart('x');
    expect(port.sent).toEqual([]);
    channel.close();
    expect(port.listenerCount('message')).toBe(0);
    expect(port.listenerCount('disconnect')).toBe(0);
  });
});
