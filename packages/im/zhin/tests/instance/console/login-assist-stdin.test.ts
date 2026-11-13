import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginAssist } from '@zhin.js/core';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bindLoginAssistStdin,
  bindLoginAssistTerminal,
  LOGIN_ASSIST_PROMPT,
  openPrivateTerminal,
} from '../../../src/instance/console/login-assist-stdin.js';

/** `privateTerminal: false` models `zhin start --foreground` without a controlling terminal. */
function terminal(assist: LoginAssist, options: { privateTerminal?: boolean } = {}) {
  const writes: string[] = [];
  const privateWrites: string[] = [];
  let listener: ((line: string) => void) | undefined;
  const dispose = bindLoginAssistTerminal(assist, {
    write: (text) => { writes.push(text); },
    ...(options.privateTerminal === false ? {} : { writePrivate: (text: string) => { privateWrites.push(text); } }),
    onLine: (next) => { listener = next; return () => { listener = undefined; }; },
  });
  return {
    writes,
    /** Captured output (piped to the gateway log buffer and log files). */
    output: () => writes.join(''),
    /** The uncaptured terminal only. */
    privateOutput: () => privateWrites.join(''),
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
    // Revealed on the uncaptured terminal only, never in captured output.
    expect(t.privateOutput()).toContain('SECRET-GUID');
    expect(t.output()).not.toContain('SECRET-GUID');
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

  it('never prints sensitive blocks or verification links to captured output (B-3)', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 0, verifyTimeoutMs: 0 });
    const t = terminal(assist, { privateTerminal: false });
    const flow = assist.beginFlow({ adapter: 'icqq', endpointKey: 'bot1', owner: {} });
    const answer = flow.challenge({
      kind: 'device', title: '设备锁验证',
      media: { link: { url: 'https://ti.qq.com/safe/verify?sid=SECRET-SID', label: '验证链接' } },
      blocks: [
        { kind: 'link', id: 'open', label: '打开', url: 'https://ti.qq.com/x?sid=SECRET-SID-2' },
        { kind: 'copy', id: 'device', label: '设备信息', content: '{"guid":"SECRET-GUID"}', format: 'json', sensitive: true },
      ],
      actions: [{ id: 'confirm', label: '已完成，继续登录', variant: 'primary' }],
    });
    expect(t.output()).not.toContain('显示设备信息');
    expect(t.output()).toContain('设备信息：已隐藏（终端输出会写入日志，请在 Console 中查看）');
    expect(t.output()).toContain('验证链接：请在 Console 中打开');
    // `2` is no menu entry without a private terminal; nothing sensitive is printed anywhere.
    t.type('2');
    expect(t.output()).toContain('无此操作');
    expect(t.output()).not.toContain('SECRET');
    expect(t.privateOutput()).toBe('');
    t.type('');
    await expect(answer).resolves.toEqual({ actionId: 'confirm', values: {} });
    t.dispose();
  });

  it('prints verification links to the uncaptured terminal when there is one', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 0, verifyTimeoutMs: 0 });
    const t = terminal(assist);
    const flow = assist.beginFlow({ adapter: 'icqq', endpointKey: 'bot1', owner: {} });
    const answer = flow.challenge({
      kind: 'slider', title: '滑块验证',
      media: { link: { url: 'https://ti.qq.com/captcha?sid=SECRET-SID', label: '验证链接' } },
      input: { kind: 'ticket', label: 'ticket' },
    });
    answer.catch(() => undefined);
    expect(t.privateOutput()).toContain('验证链接：https://ti.qq.com/captcha?sid=SECRET-SID');
    expect(t.output()).not.toContain('SECRET-SID');
    // The rest of the challenge stays on the normal output, in order around the private line.
    expect(t.output()).toContain('[icqq/bot1] 滑块验证');
    expect(t.output()).toContain(LOGIN_ASSIST_PROMPT);
    t.dispose();
    assist.dispose();
  });

  it('opens a private terminal only for a TTY stderr or a controlling terminal', async () => {
    const stream = { isTTY: true, chunks: [] as string[], write(text: string) { this.chunks.push(text); return true; } };
    const tty = openPrivateTerminal(stream);
    tty!.write('a\n');
    expect(stream.chunks).toEqual(['a\n']);

    const piped = { isTTY: false, chunks: [] as string[], write(text: string) { this.chunks.push(text); return true; } };
    expect(openPrivateTerminal(piped, join(tmpdir(), 'zhin-no-such-dir', 'tty'))).toBeUndefined();
    if (process.platform !== 'win32') {
      const dir = await mkdtemp(join(tmpdir(), 'zhin-tty-'));
      const file = join(dir, 'tty');
      await writeFile(file, '');
      const device = openPrivateTerminal(piped, file)!;
      device.write('secret\n');
      device.close();
      device.write('after close\n');
      expect(await readFile(file, 'utf8')).toBe('secret\n');
      expect(piped.chunks).toEqual([]);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
