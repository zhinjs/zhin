import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginAssist } from '@zhin.js/core';
import {
  bindLoginAssistStdin,
  bindLoginAssistTerminal,
  LOGIN_ASSIST_PROMPT,
} from '../../../src/instance/console/login-assist-stdin.js';

function terminal(assist: LoginAssist) {
  const writes: string[] = [];
  let listener: ((line: string) => void) | undefined;
  const dispose = bindLoginAssistTerminal(assist, {
    write: (text) => { writes.push(text); },
    onLine: (next) => { listener = next; return () => { listener = undefined; }; },
  });
  return {
    writes,
    output: () => writes.join(''),
    type: (line: string) => listener?.(line),
    dispose,
  };
}

describe('login assist on the terminal', () => {
  const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  afterEach(() => {
    vi.restoreAllMocks();
    if (tty) Object.defineProperty(process.stdin, 'isTTY', tty);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
  });

  it('prints whole lines: the gateway forwards instance output line by line', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    const writes: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string) => { writes.push(String(chunk)); return true; }) as never);
    const assist = new LoginAssist(null, { defaultTimeoutMs: 0 });
    const dispose = bindLoginAssistStdin(assist);
    try {
      const waiting = assist.waitForInput('icqq', 'bot', 'sms', { message: '请输入短信验证码', url: 'https://x.example/' }, { owner: {} }).catch(() => undefined);
      expect(writes.length).toBeGreaterThan(0);
      for (const chunk of writes) expect(chunk.endsWith('\n')).toBe(true);
      const printed = writes.join('');
      expect(printed).toContain('[icqq/bot] 请输入短信验证码');
      expect(printed).toContain('https://x.example/');
      expect(printed).toContain(`${LOGIN_ASSIST_PROMPT}\n`);
      assist.dispose();
      await waiting;
    } finally {
      dispose();
    }
  });

  it('prints one timeline line per change, numbered help steps and actions', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 0, verifyTimeoutMs: 0 });
    const t = terminal(assist);
    const flow = assist.beginFlow({ adapter: 'icqq', endpointKey: 'bot1', owner: {} });
    flow.step('connect', '连接服务器');
    const answer = flow.challenge({
      kind: 'device', title: '设备锁验证',
      help: { short: '短信已发送', steps: ['查看手机短信', { text: '输入 6 位验证码', doneWhen: 'manual' }] },
      input: { kind: 'code', label: '验证码', pattern: '^\\d{6}$', patternHint: '6 位数字', secret: true },
      actions: [
        { id: 'submit', label: '提交', variant: 'primary', requiresInput: true },
        { id: 'resend', label: '重新发送', variant: 'secondary' },
      ],
    });
    const out = t.output();
    expect(out).toContain('[icqq/bot1] 1/1 连接服务器 …');
    expect(out).toContain('  1. 查看手机短信\n  2. 输入 6 位验证码');
    expect(out).toContain('操作：1) 提交  2) 重新发送');
    t.writes.length = 0;
    t.type('123456');
    await expect(answer).resolves.toEqual({ actionId: 'submit', values: { input: '123456' } });
    expect(t.output()).toContain('[icqq/bot1] 2/3 设备锁验证 ✓ 已提交 → 验证中…');
    // The submitted code never appears in the terminal timeline.
    expect(t.output()).not.toContain('123456');

    t.writes.length = 0;
    flow.outcome({ result: 'rejected', code: 'code_invalid', next: 'retry_input' });
    expect(t.output()).toContain('✗ 验证码错误，请重新输入');
    t.dispose();
  });

  it('chooses actions by number or id and routes input only to the current flow', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 0, verifyTimeoutMs: 0 });
    const t = terminal(assist);
    const older = assist.beginFlow({ adapter: 'demo', endpointKey: 'a', owner: {} });
    const olderAnswer = older.challenge({ kind: 'sms', title: 'A 的短信', input: { kind: 'code', label: '验证码' } });
    const newer = assist.beginFlow({ adapter: 'demo', endpointKey: 'b', owner: {} });
    const newerAnswer = newer.challenge({
      kind: 'confirm', title: 'B 在手机上确认',
      actions: [
        { id: 'confirm', label: '已确认', variant: 'primary' },
        { id: 'refresh', label: '换一个', variant: 'secondary' },
      ],
    });
    t.type('2');
    await expect(newerAnswer).resolves.toEqual({ actionId: 'refresh', values: {} });
    expect(assist.getFlow('demo', 'a')!.activeTaskId).toBeDefined();

    // Focus falls back to the flow that still waits; `#1 <input>` names the action explicitly.
    t.type('#1 654321');
    await expect(olderAnswer).resolves.toEqual({ actionId: 'submit', values: { input: '654321' } });
    t.dispose();
  });

  it('keeps sensitive blocks behind an explicit action and reports invalid input', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 0, verifyTimeoutMs: 0 });
    const t = terminal(assist);
    const flow = assist.beginFlow({ adapter: 'icqq', endpointKey: 'bot1', owner: {} });
    const answer = flow.challenge({
      kind: 'auth', title: '身份验证',
      blocks: [
        { kind: 'copy', id: 'device', label: '设备信息', content: '{"guid":"SECRET-GUID"}', format: 'json', sensitive: true },
        { kind: 'copy', id: 'note', label: '说明', content: 'plain text', format: 'text' },
      ],
      actions: [{ id: 'confirm', label: '已完成，继续登录', variant: 'primary' }],
    });
    expect(t.output()).not.toContain('SECRET-GUID');
    expect(t.output()).toContain('说明：\nplain text');
    expect(t.output()).toContain('2) 显示设备信息');
    t.type('2');
    expect(t.output()).toContain('SECRET-GUID');
    expect(assist.getFlow('icqq', 'bot1')!.activeTaskId).toBeDefined();
    t.type('9');
    expect(t.output()).toContain('无此操作');
    t.type('');
    await expect(answer).resolves.toEqual({ actionId: 'confirm', values: {} });

    const code = flow.challenge({ kind: 'sms', title: '短信', input: { kind: 'code', label: '验证码', pattern: '^\\d{6}$', patternHint: '请输入 6 位数字' } });
    t.type('12');
    expect(t.output()).toContain('✗ 请输入 6 位数字');
    t.type('123456');
    await expect(code).resolves.toMatchObject({ values: { input: '123456' } });
    t.dispose();
  });
});
