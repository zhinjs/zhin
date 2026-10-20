import { LoginAssist } from '@zhin.js/core';
import { createConsoleEventHub } from '@zhin.js/host-http';
import { ConsoleLoginAssistBindings } from '../../../src/plugin-runtime/console/login-assist-binding.js';

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
    expect(hub.history().items).toHaveLength(1);
    expect(bindStdin).toHaveBeenCalledTimes(1);

    firstRelease();
    await emitPendingTask(assist, owner);
    expect(hub.history().items).toHaveLength(2);

    secondRelease();
    await emitPendingTask(assist, owner);
    expect(hub.history().items).toHaveLength(2);
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

async function emitPendingTask(assist: LoginAssist, owner: object): Promise<void> {
  const result = assist.waitForInput('icqq', 'main', 'qrcode', {}, { owner, timeoutMs: 0 });
  const task = assist.listPending().at(-1);
  if (!task) throw new Error('expected a pending login task');
  assist.submit(task.id, 'ok');
  await result;
}
