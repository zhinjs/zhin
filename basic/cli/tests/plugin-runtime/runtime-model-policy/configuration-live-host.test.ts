import { readFile } from 'node:fs/promises';
import { configurationFixture, configurationPrompt } from '../inference/configuration-fixture.js';

it.each([false, true])('keeps file application receipts separate from graph CAS while a model call is pending (explicit apply=%s)', async explicitApply => {
  const f = await configurationFixture(), held = f.runtime.snapshots.acquire(), inference = f.host.createInference(held);
  const context = { rootId: f.host.rootId, hostOwnerId: f.host.hostOwnerId, ownerId: f.host.hostOwnerId, operationId: 'held', sessionKey: 'session' };
  const scope = await inference.openScope({ context });
  let entered!: () => void, finish!: () => void;
  const enteredPromise = new Promise<void>(done => { entered = done; });
  const release = new Promise<void>(done => { finish = done; });
  f.setTransport(async request => {
    entered(); await release;
    const body = await request.clone().json();
    return Response.json({ id: 'synthetic', object: 'chat.completion', created: 1, model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: body.model }, finish_reason: 'stop' }] });
  });
  const pending = scope.client.generate({ request: { context: configurationPrompt } });
  try {
    await enteredPromise;
    const before = await f.store.readSource(), graphBefore = await f.host.repository.readGraph({ rootId: f.host.rootId });
    const write = await f.store.patchProject({ expectedRevision: before.revision, patches: [
      { op: 'set', path: ['menuKeyword'], value: 'next' }, { op: 'set', path: ['http', 'port'], value: 9191 },
    ] });
    expect(write.status).toBe('saved');
    if (write.status !== 'saved') throw new Error('expected file save');
    expect(write.application).toMatchObject({ sourceRevision: write.revision, saved: true,
      groups: expect.arrayContaining([expect.objectContaining({ effect: 'restart-process', status: 'restart-pending' })]) });
    expect(write).not.toHaveProperty('mutationId');
    expect(JSON.parse(await readFile(f.file, 'utf8'))).toMatchObject({ menuKeyword: 'next', http: { port: 9191 } });
    expect(await f.host.repository.readGraph({ rootId: f.host.rootId })).toEqual(graphBefore);
    if (explicitApply) await expect(f.store.apply(write.revision)).resolves.toMatchObject({ status: 'applied', application: { sourceRevision: write.revision } });
    await f.publish();
    expect((await f.store.readSource()).revision).toBe(write.revision);
    expect((await f.host.repository.readGraph({ rootId: f.host.rootId }))?.revision).toBe(2);
    expect(scope.graph.revision).toBe(1); expect(held.active).toBe(true);
    finish(); await pending;
    expect(f.requests).toHaveLength(1);
    expect(await f.requests[0].clone().json()).toMatchObject({ model: 'old' });
    expect((await f.host.repository.readMutation({ rootId: f.host.rootId, mutationId: 'next' }))?.mutationId).toBe('next');
  } finally { finish(); await pending.catch(() => {}); await scope.close(); inference.retire(); held.release(); await f.close(); }
});
