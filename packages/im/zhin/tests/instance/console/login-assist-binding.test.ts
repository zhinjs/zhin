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

async function emitPendingTask(assist: LoginAssist, owner: object): Promise<void> {
  const result = assist.waitForInput('icqq', 'main', 'qrcode', {}, { owner, timeoutMs: 0 });
  const task = assist.listPending().at(-1);
  if (!task) throw new Error('expected a pending login task');
  assist.submit(task.id, 'ok');
  await result;
}
