import { createPluginEventChannel, rootPluginId, type HmrEventDetails } from '../src/index.js';

const details: HmrEventDetails = {
  trigger: 'manual', changed: [], planned: { fullRoot: true, plugins: [rootPluginId()], capabilities: [] },
  previousGeneration: 1, activeGeneration: 1,
  receiver: { owner: rootPluginId(), creationGeneration: 1, state: 'current' },
};

it('awaits every attempted handler even when another handler rejects, without automatically aborting its signal', async () => {
  const channel = createPluginEventChannel(); const signal = new AbortController().signal;
  let finish!: () => void; let entered!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { finish = resolve; });
  const calls: string[] = [];
  channel.events.on('hmr.pause', () => { calls.push('rejected'); throw new Error('checkpoint failed'); });
  channel.events.on('hmr.pause', async event => { expect(event.signal).toBe(signal); entered(); await held; calls.push('settled'); });
  let settled = false;
  const delivery = channel.dispatch('hmr.pause', { signal, details });
  const rejected = expect(delivery).rejects.toThrow('hmr.pause handlers failed');
  void delivery.finally(() => { settled = true; }).catch(() => undefined);
  await enteredPromise; expect(settled).toBe(false); expect(signal.aborted).toBe(false);
  finish(); await rejected; expect(calls).toEqual(['rejected', 'settled']);
  channel.dispose();
});

it('keeps unsubscribe and disposal local to the concrete instance', async () => {
  const old = createPluginEventChannel(), next = createPluginEventChannel();
  const calls: string[] = [];
  const remove = old.events.on('hmr.pause', () => { calls.push('removed'); });
  remove(); old.events.on('hmr.pause', () => { calls.push('old'); });
  next.events.on('hmr.pause', () => { calls.push('next'); });
  old.dispose();
  expect(() => old.events.on('hmr.pause', () => undefined)).toThrow('disposed');
  await expect(old.dispatch('hmr.pause', { signal: new AbortController().signal, details })).rejects.toThrow('disposed');
  await next.dispatch('hmr.pause', { signal: new AbortController().signal, details });
  expect(calls).toEqual(['next']); next.dispose();
});
