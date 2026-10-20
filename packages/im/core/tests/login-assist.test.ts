import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  DEFAULT_LOGIN_ASSIST_TIMEOUT_MS,
  LoginAssist,
} from '../src/built/login-assist.js';

function makePlugin() {
  const emitter = new EventEmitter();
  return {
    emit: emitter.emit.bind(emitter) as (event: string, ...args: unknown[]) => boolean,
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
  } as unknown as ConstructorParameters<typeof LoginAssist>[0];
}

describe('LoginAssist', () => {
  let owner: object;
  beforeEach(() => {
    vi.useFakeTimers();
    owner = {};
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves on submit and clears the pending entry', async () => {
    const plugin = makePlugin();
    const assist = new LoginAssist(plugin, { defaultTimeoutMs: 60_000 });
    const pending: unknown[] = [];
    const resolved: unknown[] = [];
    plugin.on('endpoint.login.pending', (task) => pending.push(task));
    plugin.on('endpoint.login.resolved', (task) => resolved.push(task));

    const promise = assist.waitForInput('icqq', 'bot-1', 'qrcode', { message: 'scan' }, { owner });
    expect(assist.listPending()).toHaveLength(1);
    expect(pending).toHaveLength(1);

    const ok = assist.submit(assist.listPending()[0]!.id, 'scanned-ticket');
    expect(ok).toBe(true);
    await expect(promise).resolves.toBe('scanned-ticket');
    expect(assist.listPending()).toHaveLength(0);
    expect(resolved).toHaveLength(1);
  });

  it('rejects on timeout and emits endpoint.login.expired', async () => {
    const plugin = makePlugin();
    const assist = new LoginAssist(plugin, { defaultTimeoutMs: 1_000 });
    const expired: unknown[] = [];
    plugin.on('endpoint.login.expired', (task) => expired.push(task));

    const promise = assist.waitForInput('icqq', 'bot-1', 'qrcode', {}, { owner });
    const expectation = expect(promise).rejects.toThrow(/timed out/i);

    await vi.advanceTimersByTimeAsync(1_000);
    await expectation;
    expect(assist.listPending()).toHaveLength(0);
    expect(expired).toHaveLength(1);
  });

  it('timeoutMs: 0 disables timeout', async () => {
    const plugin = makePlugin();
    const assist = new LoginAssist(plugin, { defaultTimeoutMs: 100 });
    const promise = assist.waitForInput('icqq', 'bot', 'sms', {}, { owner, timeoutMs: 0 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(assist.listPending()).toHaveLength(1);
    assist.cancel(assist.listPending()[0]!.id);
    await expect(promise).rejects.toThrow('cancelled');
  });

  it('cancel rejects the producer promise', async () => {
    const assist = new LoginAssist(makePlugin(), { defaultTimeoutMs: 60_000 });
    const promise = assist.waitForInput('icqq', 'bot', 'device', {}, { owner });
    const id = assist.listPending()[0]!.id;
    expect(assist.cancel(id, 'user aborted')).toBe(true);
    await expect(promise).rejects.toThrow('user aborted');
  });

  it('dispose rejects all pending tasks', async () => {
    const assist = new LoginAssist(makePlugin(), { defaultTimeoutMs: 60_000 });
    const a = assist.waitForInput('icqq', 'a', 'qrcode', {}, { owner });
    const b = assist.waitForInput('icqq', 'b', 'sms', {}, { owner });
    assist.dispose();
    await expect(a).rejects.toThrow(/disposed/i);
    await expect(b).rejects.toThrow(/disposed/i);
    expect(assist.listPending()).toHaveLength(0);
  });

  it('default timeout constant is 5 minutes', () => {
    expect(DEFAULT_LOGIN_ASSIST_TIMEOUT_MS).toBe(5 * 60 * 1000);
  });

  it('cancelOwned clears only tasks created by the exact endpoint instance', async () => {
    const assist = new LoginAssist(makePlugin(), { defaultTimeoutMs: 60_000 });
    const otherOwner = {};
    const a = assist.waitForInput('icqq', 'same', 'qrcode', {}, { owner });
    const b = assist.waitForInput('icqq', 'same', 'sms', {}, { owner: otherOwner });
    expect(assist.cancelOwned(owner)).toBe(1);
    await expect(a).rejects.toThrow(/superseded/i);
    expect(assist.listPending()).toHaveLength(1);
    assist.submit(assist.listPending()[0]!.id, '1');
    await expect(b).resolves.toBe('1');
  });
});
