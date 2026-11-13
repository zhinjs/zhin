import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LoginAssist,
  LoginSubmissionError,
  parseLoginTicket,
  withoutLoginMedia,
  type LoginFlowSnapshot,
} from '../src/built/login-assist.js';

const DEVICE_JSON = '{"guid":"device-guid-secret","qimei":"q-secret"}';

function collectFlows(assist: LoginAssist): LoginFlowSnapshot[] {
  const flows: LoginFlowSnapshot[] = [];
  assist.subscribe('endpoint.login.flow', (flow) => flows.push(flow));
  return flows;
}

describe('LoginFlow', () => {
  let owner: object;
  beforeEach(() => {
    vi.useFakeTimers();
    owner = {};
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('progresses steps: connect → challenge → verifying → online', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const flows = collectFlows(assist);
    const flow = assist.beginFlow({ adapter: 'demo', endpointKey: 'bot1', owner });
    flow.step('connect', '连接服务器');
    const answer = flow.challenge({
      kind: 'sms', title: '短信验证', input: { kind: 'code', label: '验证码', pattern: '^\\d{6}$', patternHint: '6 位数字' },
    });
    const taskId = assist.flowOfTask(assist.listPending()[0]!.id)!.activeTaskId!;
    expect(assist.hasActiveChallenge('bot1')).toBe(true);
    expect(assist.submit(taskId, '123456')).toBe(true);
    await expect(answer).resolves.toEqual({ actionId: 'submit', values: { input: '123456' } });
    expect(assist.hasActiveChallenge('bot1')).toBe(false);
    let snapshot = assist.getFlow('demo', 'bot1')!;
    expect(snapshot.steps.map((step) => [step.kind, step.status])).toEqual([
      ['connect', 'done'], ['challenge', 'done'], ['verifying', 'active'],
    ]);
    flow.verifying('正在校验短信验证码');
    flow.online();
    snapshot = assist.getFlow('demo', 'bot1')!;
    expect(snapshot.state).toBe('online');
    expect(snapshot.lastOutcome).toEqual({ result: 'online' });
    expect(snapshot.steps.at(-1)).toMatchObject({ kind: 'verifying', status: 'done', title: '正在校验短信验证码' });
    // Revisions only grow; the latest event is the current snapshot.
    const revisions = flows.map((item) => item.revision);
    expect([...revisions].sort((a, b) => a - b)).toEqual(revisions);
    expect(flows.at(-1)).toEqual(snapshot);
  });

  it('a new challenge replaces the previous one as skipped and rejects its promise', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const flow = assist.beginFlow({ adapter: 'demo', endpointKey: 'bot1', owner });
    const first = flow.challenge({ kind: 'qrcode', title: '扫码', media: { qrImage: 'data:image/png;base64,AAA' } });
    const caught = first.catch((error: Error) => error);
    const second = flow.challenge({ kind: 'qrcode', title: '扫码（新）', media: { qrImage: 'data:image/png;base64,BBB' } });
    expect((await caught).name).toBe('LoginChallengeReplacedError');
    const snapshot = assist.getFlow('demo', 'bot1')!;
    expect(snapshot.steps.map((step) => step.status)).toEqual(['skipped', 'active']);
    // QR image only on the active challenge.
    expect(snapshot.steps[0]!.challenge!.media?.qrImage).toBeUndefined();
    expect(snapshot.steps[1]!.challenge!.media?.qrImage).toBe('data:image/png;base64,BBB');
    expect(assist.listPending()).toHaveLength(1);
    flow.end();
    await expect(second).rejects.toThrow('cancelled');
  });

  it('marks "result pending confirmation" (not failure) when no result follows a submit', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000, verifyTimeoutMs: 20_000 });
    const flow = assist.beginFlow({ adapter: 'demo', endpointKey: 'bot1', owner });
    const answer = flow.challenge({ kind: 'confirm', title: '在手机上确认' });
    assist.submit(assist.listPending()[0]!.id, { action: 'confirm' });
    await answer;
    await vi.advanceTimersByTimeAsync(19_999);
    expect(assist.getFlow('demo', 'bot1')!.pendingConfirmation).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    const snapshot = assist.getFlow('demo', 'bot1')!;
    expect(snapshot.pendingConfirmation).toBe(true);
    expect(snapshot.state).toBe('active');
    flow.outcome({ result: 'rejected', code: 'code_invalid', message: '验证码错误', next: 'retry_input' });
    expect(assist.getFlow('demo', 'bot1')!.pendingConfirmation).toBeUndefined();
  });

  it('never puts submitted values into snapshots, events or outcome text', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const flows = collectFlows(assist);
    const tasks: unknown[] = [];
    assist.subscribe('endpoint.login.resolved', (task) => tasks.push(task));
    const flow = assist.beginFlow({ adapter: 'demo', endpointKey: 'bot1', owner });
    const answer = flow.challenge({ kind: 'slider', title: '滑块', input: { kind: 'ticket', label: 'ticket', extract: 'ticket-json-or-url' } });
    assist.submit(assist.listPending()[0]!.id, '{"ticket":"t03-SECRET-TICKET","randstr":"@rnd"}');
    await expect(answer).resolves.toEqual({ actionId: 'submit', values: { input: 't03-SECRET-TICKET', randstr: '@rnd' } });
    // An adapter echoing the value back in an error is redacted.
    flow.outcome({ result: 'rejected', code: 'code_invalid', message: 'bad ticket t03-SECRET-TICKET\nretry' });
    const serialized = JSON.stringify([flows, tasks, assist.listFlows()]);
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain('@rnd');
    expect(assist.getFlow('demo', 'bot1')!.lastOutcome).toEqual({
      result: 'rejected', code: 'code_invalid', message: 'bad ticket *** retry',
    });
  });

  it('keeps legacy waitForInput working and maps the payload to a descriptor', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const waiting = assist.waitForInput('icqq', 'bot1', 'slider', { message: '请完成滑块', url: 'https://captcha.example/x' }, { owner });
    const task = assist.listPending()[0]!;
    expect(task).toMatchObject({ type: 'slider', payload: { message: '请完成滑块', url: 'https://captcha.example/x' } });
    const flow = assist.getFlow('icqq', 'bot1')!;
    expect(task.flowId).toBe(flow.id);
    expect(flow.steps[0]!.challenge).toMatchObject({
      kind: 'slider', title: '请完成滑块',
      media: { link: { url: 'https://captcha.example/x' } },
      input: { kind: 'ticket', extract: 'ticket-json-or-url' },
      actions: [{ id: 'submit', variant: 'primary', requiresInput: true }],
    });
    // A legacy string still resolves the legacy promise unchanged.
    assist.submit(task.id, ' raw-ticket ');
    await expect(waiting).resolves.toBe(' raw-ticket ');

    // A structured answer to a legacy qrcode task resolves with "ok".
    const qr = assist.waitForInput('icqq', 'bot1', 'qrcode', { message: '扫码', image: 'data:image/png;base64,AAA' }, { owner });
    expect(assist.getFlow('icqq', 'bot1')!.steps.at(-1)!.challenge).toMatchObject({ kind: 'qrcode', actions: [{ id: 'confirm' }] });
    assist.submit(assist.listPending()[0]!.id, { action: 'confirm', values: {} });
    await expect(qr).resolves.toBe('ok');
    // The legacy owner reports online through cancelOwned.
    assist.cancelOwned(owner, 'online');
    expect(assist.getFlow('icqq', 'bot1')!.state).toBe('online');
  });

  it('tells a cancel apart from a resolved answer', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const flow = assist.beginFlow({ adapter: 'demo', endpointKey: 'bot1', owner });
    const answer = flow.challenge({ kind: 'confirm', title: '确认' }).catch((error: Error) => error.message);
    assist.cancel(assist.listPending()[0]!.id, 'user_cancelled');
    await expect(answer).resolves.toBe('user_cancelled');
    const snapshot = assist.getFlow('demo', 'bot1')!;
    expect(snapshot.state).toBe('cancelled');
    expect(snapshot.steps[0]!.status).toBe('skipped');

    const other = assist.beginFlow({ adapter: 'demo', endpointKey: 'bot2', owner });
    const done = other.challenge({ kind: 'confirm', title: '确认' });
    assist.submit(assist.listPending()[0]!.id, 'ok');
    await done;
    expect(assist.getFlow('demo', 'bot2')!).toMatchObject({ state: 'active' });
    expect(assist.getFlow('demo', 'bot2')!.steps[0]!.status).toBe('done');
  });

  it('validates structured answers without consuming the challenge', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const flow = assist.beginFlow({ adapter: 'demo', endpointKey: 'bot1', owner });
    const answer = flow.challenge({
      kind: 'device', title: '设备锁', input: { kind: 'code', label: '验证码', pattern: '^\\d{6}$', patternHint: '请输入 6 位数字' },
      actions: [
        { id: 'submit', label: '提交', variant: 'primary', requiresInput: true },
        { id: 'resend', label: '重新发送', variant: 'secondary', cooldownMs: 60_000 },
      ],
    });
    const id = assist.listPending()[0]!.id;
    expect(() => assist.submit(id, { action: 'nope' })).toThrow(LoginSubmissionError);
    expect(() => assist.submit(id, { action: 'submit', values: { input: '12' } })).toThrow('请输入 6 位数字');
    expect(() => assist.submit(id, { action: 'submit', values: {} })).toThrow(/required/);
    expect(assist.listPending()).toHaveLength(1);
    expect(assist.submit(id, { action: 'resend' })).toBe(true);
    await expect(answer).resolves.toEqual({ actionId: 'resend', values: {} });
  });

  it('expires a challenge into a refreshable expired flow', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 1_000 });
    const flow = assist.beginFlow({ adapter: 'demo', endpointKey: 'bot1', owner });
    const answer = flow.challenge({ kind: 'qrcode', title: '扫码', media: { qrImage: 'data:x', refreshable: true } }).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await answer).toBeInstanceOf(Error);
    const snapshot = assist.getFlow('demo', 'bot1')!;
    expect(snapshot.state).toBe('expired');
    expect(snapshot.lastOutcome).toEqual({ result: 'expired', code: 'challenge_expired', next: 'refresh_challenge' });
    expect(snapshot.steps[0]!.challenge!.media?.qrImage).toBeUndefined();
    // A refreshed challenge reactivates the same flow.
    void flow.challenge({ kind: 'qrcode', title: '扫码', media: { qrImage: 'data:y' } }).catch(() => undefined);
    expect(assist.getFlow('demo', 'bot1')!.state).toBe('active');
    assist.dispose();
  });

  it('fail() ends the flow with a default next action and the attempt counter grows', () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const flow = assist.beginFlow({ adapter: 'demo', endpointKey: 'bot1', owner });
    flow.fail('credential_invalid', '密码错误');
    expect(assist.getFlow('demo', 'bot1')).toMatchObject({
      state: 'failed', attempt: 1, lastOutcome: { result: 'failed', code: 'credential_invalid', message: '密码错误', next: 'relogin' },
    });
    flow.step('info', 'ignored after end');
    expect(assist.getFlow('demo', 'bot1')!.steps).toHaveLength(0);
    assist.beginFlow({ adapter: 'demo', endpointKey: 'bot1', owner });
    expect(assist.getFlow('demo', 'bot1')).toMatchObject({ state: 'active', attempt: 2 });
    expect(assist.listFlows()).toHaveLength(1);
  });

  it('caps the timeline at 20 steps', () => {
    const assist = new LoginAssist(null);
    const flow = assist.beginFlow({ adapter: 'demo', endpointKey: 'bot1', owner });
    for (let index = 0; index < 30; index += 1) flow.step('info', `step ${index}`);
    const steps = assist.getFlow('demo', 'bot1')!.steps;
    expect(steps).toHaveLength(20);
    expect(steps[0]!.title).toBe('step 10');
  });

  it('submitAndWait returns the outcome, or pending when none arrives', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const flow = assist.beginFlow({ adapter: 'demo', endpointKey: 'bot1', owner });
    void flow.challenge({ kind: 'sms', title: '短信', input: { kind: 'code', label: '验证码' } }).then(() => {
      flow.outcome({ result: 'rejected', code: 'code_invalid', next: 'retry_input' });
    });
    const result = await assist.submitAndWait(assist.listPending()[0]!.id, '000000');
    expect(result).toMatchObject({ accepted: true, outcome: { result: 'rejected', code: 'code_invalid' }, flow: { id: flow.id } });

    void flow.challenge({ kind: 'sms', title: '短信', input: { kind: 'code', label: '验证码' } });
    const waiting = assist.submitAndWait(assist.listPending()[0]!.id, '111111', { timeoutMs: 15_000 });
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(waiting).resolves.toMatchObject({ accepted: true, pending: true });
    await expect(assist.submitAndWait('missing', 'x')).resolves.toEqual({ accepted: false });
  });
});

describe('guidance blocks', () => {
  it('keeps http(s) links, drops other schemes and dangling thenOpen, and redacts sensitive material', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 60_000 });
    const flows = collectFlows(assist);
    const flow = assist.beginFlow({ adapter: 'demo', endpointKey: 'bot1', owner: {} });
    const answer = flow.challenge({
      kind: 'auth', title: '身份验证',
      help: {
        short: '按步骤完成身份验证',
        steps: ['复制设备信息', { text: '打开验证页', blockId: 'verify', doneWhen: 'opened' }, { text: 'x', blockId: 'missing' }],
        warning: '请勿把设备 JSON 发给他人',
      },
      blocks: [
        { kind: 'copy', id: 'device', label: '设备信息', content: DEVICE_JSON, format: 'json', sensitive: true, thenOpen: 'verify' },
        { kind: 'copy', id: 'script', label: '辅助脚本', content: 'void 0', format: 'script', collapsed: true, bookmarklet: true, thenOpen: 'nowhere' },
        { kind: 'copy', id: 'plain', label: '纯文本', content: 'abc', format: 'text', bookmarklet: true },
        { kind: 'link', id: 'verify', label: '验证页', url: 'https://accounts.example/verify', showQr: true },
        { kind: 'link', label: 'bad', url: 'javascript:alert(1)' },
        { kind: 'link', label: 'bad2', url: 'file:///etc/passwd' },
        { kind: 'note', text: '验证完成后点击继续', tone: 'warning' },
      ],
      actions: [{ id: 'confirm', label: '已完成，继续登录', variant: 'primary' }],
    });
    const live = assist.getFlow('demo', 'bot1')!.steps[0]!.challenge!;
    expect(live.help).toEqual({
      short: '按步骤完成身份验证',
      steps: ['复制设备信息', { text: '打开验证页', blockId: 'verify', doneWhen: 'opened' }, { text: 'x' }],
      warning: '请勿把设备 JSON 发给他人',
    });
    expect(live.blocks!.map((block) => block.kind)).toEqual(['copy', 'copy', 'copy', 'link', 'note']);
    expect(live.blocks![0]).toMatchObject({ content: DEVICE_JSON, sensitive: true, thenOpen: 'verify' });
    expect(live.blocks![1]).toMatchObject({ bookmarklet: true, collapsed: true });
    expect(live.blocks![1]).not.toHaveProperty('thenOpen');
    expect(live.blocks![2]).not.toHaveProperty('bookmarklet');
    expect(live.blocks![3]).toEqual({ kind: 'link', id: 'verify', label: '验证页', url: 'https://accounts.example/verify', showQr: true });

    // Event / history copies never carry the sensitive JSON, even while it is active.
    expect(JSON.stringify(flows.map(withoutLoginMedia))).not.toContain('device-guid-secret');

    assist.submit(assist.listPending()[0]!.id, { action: 'confirm' });
    await answer;
    // After the challenge, the timeline keeps no sensitive material.
    const after = JSON.stringify(assist.listFlows());
    expect(after).not.toContain('device-guid-secret');
    expect(assist.getFlow('demo', 'bot1')!.steps[0]!.challenge!.blocks![0]).toMatchObject({ redacted: true, content: '' });
  });
});

describe('parseLoginTicket', () => {
  it.each([
    ['t03abc', { ok: true, ticket: 't03abc' }],
    ['  t03abc  ', { ok: true, ticket: 't03abc' }],
    ['t03abc,@rand', { ok: true, ticket: 't03abc', randstr: '@rand' }],
    ['{"ret":0,"ticket":"t03abc","randstr":"@r"}', { ok: true, ticket: 't03abc', randstr: '@r' }],
    ['{"data":{"ticket":"t03abc"}}', { ok: true, ticket: 't03abc' }],
    ['https://ssl.captcha.qq.com/x?ticket=t03abc&randstr=%40r', { ok: true, ticket: 't03abc', randstr: '@r' }],
    ['https://example.com/cb#ticket=t03abc', { ok: true, ticket: 't03abc' }],
  ])('accepts %s', (input, expected) => {
    expect(parseLoginTicket(input)).toEqual(expected);
  });

  it.each([
    ['', '请粘贴'],
    ['{"ret":0', 'JSON 格式不完整'],
    ['{"ret":0}', 'JSON 中没有 ticket 字段'],
    ['https://example.com/?a=1', '链接中没有 ticket 参数'],
    ['a,b,c', 'ticket,randstr'],
    ['t03 abc', '空白字符'],
  ])('rejects %s with a precise message', (input, message) => {
    const result = parseLoginTicket(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });

  it('rejects non-strings', () => {
    expect(parseLoginTicket(undefined).ok).toBe(false);
  });
});
