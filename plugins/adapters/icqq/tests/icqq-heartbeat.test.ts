import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Client } from '@icqqjs/icqq';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { icqqFixture } from './fixture.js';
import { LoginAssist } from '@zhin.js/core';
import { ManagedIcqqClient } from '../src/managed-client.js';
import { IcqqEndpoint } from '../src/endpoint.js';
import { resolveIcqqConfig } from '../src/protocol.js';

let directory: string;
beforeEach(() => {
  vi.useFakeTimers();
  directory = mkdtempSync(join(tmpdir(), 'zhin-icqq-heartbeat-'));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

class HeartbeatTestClient extends ManagedIcqqClient {
  scheduleHeartbeat(): void {
    this.ssoInterval = 1;
    this.startSsoHeartBeat();
  }
}

describe('ICQQ background heartbeat ownership with the real SDK', () => {
  it('survives an ignored real SDK timer rejection under Node strict rejection policy', async () => {
    const modulePath = fileURLToPath(new URL('../src/managed-client.ts', import.meta.url));
    const script = `
      import { pathToFileURL } from 'node:url';
      const modulePath = process.argv[1];
      const { ManagedIcqqClient } = await import(pathToFileURL(modulePath).href);
      const Client = Object.getPrototypeOf(ManagedIcqqClient.prototype).constructor;
      const failure = { code: -2, message: 'packet timeout (seq: 123)' };
      Client.prototype.sendUni = () => Promise.reject(failure);
      let observed = 0;
      const client = new ManagedIcqqClient(10001, { data_dir: process.argv[2], QQNT: true, log_level: 'off' }, (operation, error) => {
        if (operation !== 'sso-heartbeat' || error !== failure) process.exit(2);
        observed++;
      });
      client.ssoInterval = 0.001;
      client.startSsoHeartBeat();
      setTimeout(() => { client.terminate(); process.exit(observed === 1 ? 0 : 3); }, 50);
    `;
    const run = promisify(execFile);
    await expect(run(process.execPath, ['--unhandled-rejections=strict', '--experimental-strip-types', '--input-type=module', '-e', script, modulePath, directory], { timeout: 5000 })).resolves.toHaveProperty('stdout');
  });

  it('observes the SDK timer rejection while explicit callers still receive the error', async () => {
    const failure = { code: -2, message: 'packet timeout (seq: 123)' };
    vi.spyOn(Client.prototype, 'sendUni').mockRejectedValue(failure);
    const onFailure = vi.fn();
    const client = new HeartbeatTestClient(10001, { data_dir: directory, QQNT: true, log_level: 'off' }, onFailure);
    client.scheduleHeartbeat();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onFailure).toHaveBeenCalledWith('sso-heartbeat', failure);
    await expect(client.sendSsoHeartBeat()).rejects.toBe(failure);
    expect(onFailure).toHaveBeenCalledTimes(2);
    client.terminate();
  });

  it('retains the SDK non-QQNT heartbeat false result', () => {
    const onFailure = vi.fn();
    const client = new HeartbeatTestClient(10001, { data_dir: directory, QQNT: false, log_level: 'off' }, onFailure);
    expect(client.sendSsoHeartBeat()).toBe(false);
    expect(onFailure).not.toHaveBeenCalled();
    client.terminate();
  });

  it.each([false, true])('contains failed failure reporters even when the logger throws=%s', async (loggerThrows) => {
    const failure = { code: -2, message: 'packet timeout', secret: 'private-token' };
    vi.spyOn(Client.prototype, 'sendUni').mockRejectedValue(failure);
    const client = new HeartbeatTestClient(10001, { data_dir: directory, QQNT: true, log_level: 'off' }, () => { throw failure; });
    const log = vi.spyOn(client.logger, 'error').mockImplementation(() => { if (loggerThrows) throw new Error('log sink broken'); });
    client.scheduleHeartbeat();
    await vi.advanceTimersByTimeAsync(1000);
    expect(log).toHaveBeenCalledExactlyOnceWith('ICQQ background failure handler failed');
    await expect(client.sendSsoHeartBeat()).rejects.toBe(failure);
    client.terminate();
  });

  it('observes SDK reconnect timer login failures without changing direct login results', async () => {
    const failure = new Error('sign server unavailable');
    vi.spyOn(Client.prototype, 'login').mockRejectedValue(failure);
    const onFailure = vi.fn();
    const client = new HeartbeatTestClient(10001, { data_dir: directory, log_level: 'off', reconn_interval: 1 }, onFailure);
    client.emit('internal.error.network', -2, 'network lost');
    await vi.advanceTimersByTimeAsync(1000);
    expect(onFailure).toHaveBeenCalledWith('login', failure);
    await expect(client.login()).rejects.toBe(failure);
    client.cancelReconnect();
    client.terminate();
  });

  it('forwards both password-only and optional-account login overloads', async () => {
    const login = vi.spyOn(Client.prototype, 'login').mockResolvedValue();
    const client = new HeartbeatTestClient(10001, { data_dir: directory, log_level: 'off' }, vi.fn());
    await client.login('password');
    await client.login(undefined, 'password');
    await client.login(10002, 'password');
    expect(login.mock.calls).toEqual([['password'], [undefined, 'password'], [10002, 'password']]);
    client.terminate();
  });

  it.each([true, false])('routes SSO failure through SDK offline/reconnect policy (autoReconnect=%s)', async (autoReconnect) => {
    const failure = { code: -2, message: 'packet timeout (seq: 123)' };
    vi.spyOn(Client.prototype, 'sendUni').mockRejectedValue(failure);
    let online = true;
    const login = vi.spyOn(Client.prototype, 'login').mockImplementation(async function (this: Client) {
      online = true;
      this.emit('system.online');
    });
    const endpoint = await icqqFixture({
      id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'icqq'),
      config: resolveIcqqConfig({ id: '10001', dataDir: directory, autoReconnect, qqnt: true }),
      loginAssist: new LoginAssist(null),
    }, { receive: vi.fn(), send: vi.fn(async () => 'sent') }, undefined);
    vi.spyOn(endpoint.endpoint, 'isOnline').mockImplementation(() => online);
    const terminate = vi.spyOn(endpoint.endpoint, 'terminate').mockImplementation(() => { online = false; });
    vi.spyOn(endpoint.endpoint, 'getSystemMsg').mockResolvedValue([]);
    try {
      await endpoint.start(new AbortController().signal);
      endpoint.open();
      await expect(endpoint.endpoint.sendSsoHeartBeat()).rejects.toBe(failure);
      expect(terminate).toHaveBeenCalledOnce();
      expect(endpoint.transportState).toBe(autoReconnect ? 'reconnecting' : 'closed');
      await vi.advanceTimersByTimeAsync(5000);
      expect(login).toHaveBeenCalledTimes(autoReconnect ? 2 : 1);
      expect(endpoint.transportState).toBe(autoReconnect ? 'open' : 'closed');
    } finally { await endpoint.stop(); }
  });

  it('does not rearm reconnect when an in-flight heartbeat fails after retirement', async () => {
    let reject!: (error: unknown) => void;
    vi.spyOn(Client.prototype, 'sendUni').mockImplementation(() => new Promise((_, rejectTask) => { reject = rejectTask; }));
    const login = vi.spyOn(Client.prototype, 'login').mockImplementation(async function (this: Client) { this.emit('system.online'); });
    const endpoint = await icqqFixture({
      id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'icqq'),
      config: resolveIcqqConfig({ id: '10001', dataDir: directory, autoReconnect: true, qqnt: true }),
      loginAssist: new LoginAssist(null),
    }, { receive: vi.fn(), send: vi.fn(async () => 'sent') }, undefined);
    vi.spyOn(endpoint.endpoint, 'isOnline').mockReturnValue(true);
    vi.spyOn(endpoint.endpoint, 'getSystemMsg').mockResolvedValue([]);
    await endpoint.start(new AbortController().signal);
    endpoint.open();
    const task = endpoint.endpoint.sendSsoHeartBeat();
    await endpoint.stop();
    const failure = { code: -2, message: 'packet timeout (seq: 123)' };
    reject(failure);
    await expect(task).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(5000);
    expect(login).toHaveBeenCalledOnce();
    expect(endpoint.transportState).toBe('stopped');
  });

  it('does not restart a retired endpoint when an SDK reconnect login rejects late', async () => {
    let reject!: (error: unknown) => void;
    const login = vi.spyOn(Client.prototype, 'login')
      .mockImplementationOnce(async function (this: Client) { this.emit('system.online'); })
      .mockImplementationOnce(() => new Promise((_, rejectTask) => { reject = rejectTask; }));
    const endpoint = await icqqFixture({
      id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'icqq'),
      config: resolveIcqqConfig({ id: '10001', dataDir: directory, autoReconnect: true, qqnt: true }),
      loginAssist: new LoginAssist(null),
    }, { receive: vi.fn(), send: vi.fn(async () => 'sent') }, undefined);
    vi.spyOn(endpoint.endpoint, 'getSystemMsg').mockResolvedValue([]);
    const networkErrors = vi.fn();
    endpoint.endpoint.on('internal.error.network', networkErrors);
    await endpoint.start(new AbortController().signal);
    endpoint.open();
    endpoint.endpoint.emit('internal.error.network', -2, 'connection lost');
    await vi.advanceTimersByTimeAsync(5000);
    expect(login).toHaveBeenCalledTimes(2);
    await endpoint.stop();
    reject(new Error('sign server unavailable'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(login).toHaveBeenCalledTimes(2);
    expect(networkErrors).toHaveBeenCalledOnce();
    expect(endpoint.transportState).toBe('stopped');
  });
});
