import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoginAssist, PendingLoginTask } from '@zhin.js/core';
import { bindLoginAssistStdin, LOGIN_ASSIST_PROMPT } from '../../../src/instance/console/login-assist-stdin.js';

function fakeAssist() {
  const listeners = new Map<string, (task: PendingLoginTask) => void>();
  const assist = {
    subscribe: (name: string, listener: (task: PendingLoginTask) => void) => { listeners.set(name, listener); return () => listeners.delete(name); },
    submit: () => true,
  } as unknown as LoginAssist;
  return { assist, emit: (name: string, task: PendingLoginTask) => listeners.get(name)?.(task) };
}

describe('login assist on the terminal', () => {
  const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  afterEach(() => {
    vi.restoreAllMocks();
    if (tty) Object.defineProperty(process.stdin, 'isTTY', tty);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
  });

  it('prints whole lines: the gateway forwards instance output line by line', () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    const writes: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string) => { writes.push(String(chunk)); return true; }) as never);
    const { assist, emit } = fakeAssist();
    const dispose = bindLoginAssistStdin(assist);
    try {
      emit('endpoint.login.pending', { id: 'l1', adapter: 'icqq', endpointKey: 'bot', type: 'sms', payload: { message: '请输入短信验证码', url: 'https://x' }, createdAt: 0 } as PendingLoginTask);
      const printed = writes.join('');
      expect(printed).toBe(`请输入短信验证码\nhttps://x\n${LOGIN_ASSIST_PROMPT}\n`);
      expect(printed.endsWith('\n')).toBe(true);
    } finally {
      dispose();
    }
  });
});
