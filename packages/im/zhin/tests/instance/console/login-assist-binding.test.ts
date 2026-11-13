import { LoginAssist } from '@zhin.js/core';
import { createConsoleEventHub } from '@zhin.js/host-http';
import { ConsoleLoginAssistBindings } from '../../../src/instance/console/login-assist-binding.js';

describe('ConsoleLoginAssistBindings', () => {
  it('shares one subscription until the final generation releases it', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 0 });
    const hub = createConsoleEventHub({ runtimeId: 'login-assist-test' });
    const unbindStdin = vi.fn();
    const bindStdin = vi.fn(() => unbindStdin);
    const bindings = new ConsoleLoginAssistBindings(bindStdin);
    const firstRelease = bindings.acquire(assist, hub);
    const secondRelease = bindings.acquire(assist, hub);
    const owner = {};

    await emitPendingTask(assist, owner);
    expect(pendingEvents(hub)).toHaveLength(1);
    expect(bindStdin).toHaveBeenCalledTimes(1);

    firstRelease();
    await emitPendingTask(assist, owner);
    expect(pendingEvents(hub)).toHaveLength(2);

    secondRelease();
    const before = hub.history().items.length;
    await emitPendingTask(assist, owner);
    expect(pendingEvents(hub)).toHaveLength(2);
    expect(hub.history().items).toHaveLength(before);
    expect(unbindStdin).toHaveBeenCalledTimes(1);
  });

  it('rejects binding one LoginAssist to two active hubs', () => {
    const assist = new LoginAssist();
    const bindings = new ConsoleLoginAssistBindings(() => () => {});
    const release = bindings.acquire(assist, createConsoleEventHub());

    expect(() => bindings.acquire(assist, createConsoleEventHub()))
      .toThrow('LoginAssist cannot publish to multiple process Console hubs');
    release();
  });
});

function pendingEvents(hub: ReturnType<typeof createConsoleEventHub>) {
  return hub.history().items.filter(item => item.type === 'endpoint.login.pending');
}

it('forwards login flow snapshots without QR images or sensitive material', async () => {
  const assist = new LoginAssist(null, { defaultTimeoutMs: 0 });
  const hub = createConsoleEventHub({ runtimeId: 'login-flow-test' });
  const release = new ConsoleLoginAssistBindings(() => () => {}).acquire(assist, hub);
  const flow = assist.beginFlow({ adapter: 'demo', endpointKey: 'bot', owner: {} });
  const answer = flow.challenge({
    kind: 'qrcode', title: '扫码', media: { qrImage: 'data:image/png;base64,QRDATA' },
    blocks: [{ kind: 'copy', id: 'device', label: '设备信息', content: '{"guid":"SECRET"}', format: 'json', sensitive: true }],
  });
  const events = hub.history().items.filter(item => item.type === 'endpoint.login.flow');
  expect(events.length).toBeGreaterThan(0);
  const last = events.at(-1)!.data as { steps: { challenge?: { media?: { qrImageOmitted?: boolean } } }[] };
  expect(last.steps[0]!.challenge!.media!.qrImageOmitted).toBe(true);
  expect(JSON.stringify(hub.history().items.filter(item => item.type === 'endpoint.login.flow'))).not.toMatch(/QRDATA|SECRET/u);
  // The live snapshot (login.flow.get) still has both.
  expect(JSON.stringify(assist.listFlows())).toMatch(/QRDATA/u);
  assist.submit(assist.listPending()[0]!.id, 'ok');
  await answer;
  release();
});

it('strips QR images from the legacy pending / expired events, like the flow events', async () => {
  const assist = new LoginAssist(null, { defaultTimeoutMs: 0 });
  const hub = createConsoleEventHub({ runtimeId: 'login-legacy-test' });
  const release = new ConsoleLoginAssistBindings(() => () => {}).acquire(assist, hub);
  const flow = assist.beginFlow({ adapter: 'demo', endpointKey: 'bot', owner: {} });
  const qr = flow.challenge({ kind: 'qrcode', title: '扫码', media: { qrImage: 'data:image/png;base64,QRDATA' } });
  const legacy = assist.waitForInput('demo', 'other', 'qrcode', { message: '扫码', image: 'data:image/png;base64,LEGACYQR' }, { owner: {}, timeoutMs: 0 });
  const pending = hub.history().items.filter(item => item.type === 'endpoint.login.pending');
  expect(pending).toHaveLength(2);
  expect(JSON.stringify(hub.history().items)).not.toMatch(/QRDATA|LEGACYQR/u);
  expect(pending.every(item => (item.data as { payload: { imageOmitted?: boolean } }).payload.imageOmitted === true)).toBe(true);
  // login.list (authorized per Endpoint) still carries the live material for the Console.
  expect(JSON.stringify(assist.listPending())).toMatch(/QRDATA/u);
  expect(JSON.stringify(assist.listPending())).toMatch(/LEGACYQR/u);
  for (const task of assist.listPending()) assist.submit(task.id, 'ok');
  await Promise.all([qr, legacy]);
  release();
});

async function emitPendingTask(assist: LoginAssist, owner: object): Promise<void> {
  const result = assist.waitForInput('icqq', 'main', 'qrcode', {}, { owner, timeoutMs: 0 });
  const task = assist.listPending().at(-1);
  if (!task) throw new Error('expected a pending login task');
  assist.submit(task.id, 'ok');
  await result;
}

it('strips verification links (they can carry a sid) from the legacy pending events', async () => {
  const assist = new LoginAssist(null, { defaultTimeoutMs: 0 });
  const hub = createConsoleEventHub({ runtimeId: 'login-legacy-url-test' });
  const release = new ConsoleLoginAssistBindings(() => () => {}).acquire(assist, hub);
  const answer = assist.waitForInput('demo', 'bot', 'slider', { message: '滑块', url: 'https://captcha.example/x?sid=SECRETSID' }, { owner: {}, timeoutMs: 0 });
  const pending = hub.history().items.filter(item => item.type === 'endpoint.login.pending');
  expect(pending).toHaveLength(1);
  // (flow events drop links in withoutLoginMedia, covered by the core login-flow tests)
  expect(JSON.stringify(pending)).not.toMatch(/SECRETSID/u);
  expect((pending[0]!.data as { payload: { urlOmitted?: boolean } }).payload.urlOmitted).toBe(true);
  expect(JSON.stringify(assist.listPending())).toMatch(/SECRETSID/u);
  assist.submit(assist.listPending()[0]!.id, 'ticket');
  await answer;
  release();
});
