import {
  PluginDatabaseHost, PluginOutboundHost, PluginScheduleHost, SnapshotStore, Scope,
  createGenerationAdmissionGate, createToken, childPluginId, rootPluginId,
  type DatabaseHost, type DatabaseHostModel, type DatabaseHostSelection,
  type ScheduleHost, type ScheduleJobRegistration, type SnapshotState,
  generationAdmissionBinder,
} from '../src/index.js';

const owner = childPluginId(rootPluginId(), 'reminder');
const target = { endpoint: { adapter: 'icqq', id: 'endpoint' }, kind: 'group' as const, id: 'room' };
const input = { adapter: 'icqq', endpointKey: 'main', conversation: { kind: 'group' as const, id: 'room' }, content: 'hello' };

function state(resources: readonly unknown[]): SnapshotState {
  return { root: rootPluginId(), tree: new Map(), config: new Map(), capabilities: new Map(), projections: new Map(),
    resources: new Map([[owner, new Map(resources.map((value, index) => [createToken(`test.host.${index}`).id, value]))]]) };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('owner Host generation admission', () => {
  it('closes candidate declarations on Scope seal, failed setup disposal and binder cloning', async () => {
    const gate = createGenerationAdmissionGate();
    const port: DatabaseHost = { dialect: 'sqlite', started: false, define: vi.fn(), tables: () => [], models: { get: () => undefined },
      getRawDatabase: () => undefined, start: async () => undefined, stop: async () => undefined };
    const facade = new PluginDatabaseHost(owner, port, gate);
    const scope = new Scope(owner);
    scope.provide(createToken('test.database'), facade);
    facade.define('before-seal', {});
    scope.seal();
    expect(() => facade.define('after-seal', {})).toThrow('inactive generation');
    const store = new SnapshotStore(state([facade]));
    facade.define('published', {});
    await store.close();
    expect(() => facade.define('retired', {})).toThrow('inactive generation');

    const failedGate = createGenerationAdmissionGate();
    const failed = new PluginDatabaseHost(owner, port, failedGate);
    const failedScope = new Scope(owner);
    failedScope.provide(createToken('test.database'), failed);
    await failedScope.disposers.dispose();
    expect(() => failed.define('failed', {})).toThrow('inactive generation');
    expect(() => failed[generationAdmissionBinder](failedGate).define('clone', {})).toThrow('inactive generation');
    const schedule = new PluginScheduleHost(owner, { register: vi.fn(), list: () => [] }, failedGate);
    const failedScheduleScope = new Scope(owner);
    failedScheduleScope.provide(createToken('test.schedule'), schedule);
    await failedScheduleScope.disposers.dispose();
    expect(() => schedule.register({ id: 'failed', cron: '* * * * * *', execute() {} })).toThrow('inactive generation');
    expect(() => schedule[generationAdmissionBinder](failedGate).list()).toThrow('inactive generation');
  });

  it('preserves optional durable target capability', () => {
    const facade = new PluginOutboundHost(owner, { send: async () => null });
    expect(facade.sendTarget).toBeUndefined();
    const supported = new PluginOutboundHost(owner, { send: async () => null, sendTarget: async () => 'id' });
    expect(typeof supported.sendTarget).toBe('function');
  });

  it('finishes admitted views after retirement while rejecting unrelated and detached work', async () => {
    const gate = createGenerationAdmissionGate();
    const siblingGate = createGenerationAdmissionGate();
    const port = { send: vi.fn().mockResolvedValue('id'), sendTarget: vi.fn().mockResolvedValue('id'),
      runWithView: async <T>(operation: () => Promise<T>) => operation() };
    const facade = new PluginOutboundHost(owner, port, gate);
    const sibling = new PluginOutboundHost(childPluginId(rootPluginId(), 'preferences'), port, siblingGate);
    const store = new SnapshotStore(state([facade, sibling]));
    const entered = deferred();
    const continueView = deferred();
    const continueDetached = deferred();
    let detached!: Promise<string | null>;
    const disposed = vi.fn();
    store.commit(0, { snapshot: state([facade, sibling]), dispose: disposed });
    const admitted = facade.runWithView!(async () => {
      detached = (async () => { await continueDetached.promise; return facade.sendTarget!(target, 'detached'); })();
      void detached.catch(() => undefined);
      entered.resolve();
      await continueView.promise;
      await facade.send(input);
      return facade.runWithView!(async () => facade.sendTarget!(target, 'nested'));
    });
    await entered.promise;
    store.commit(1, { snapshot: state([sibling]), dispose: () => undefined });
    expect(gate.active).toBe(false);
    expect(disposed).not.toHaveBeenCalled();
    await expect(facade.send(input)).rejects.toThrow('inactive generation');
    await expect(facade.sendTarget!(target, 'unrelated')).rejects.toThrow('inactive generation');
    await expect(sibling.send(input)).resolves.toBe('id');
    continueView.resolve();
    await expect(admitted).resolves.toBe('id');
    expect(port.sendTarget).toHaveBeenCalledWith(target, 'nested', owner);
    await vi.waitFor(() => expect(disposed).toHaveBeenCalledTimes(1));
    continueDetached.resolve();
    await expect(detached).rejects.toThrow('inactive generation');
    expect(port.sendTarget).toHaveBeenCalledTimes(1);
    await store.close();
  });

  it('keeps admitted nested sends leased even if the view callback does not await them', async () => {
    const finishSend = deferred();
    const port = { send: async () => { await finishSend.promise; return 'id'; },
      runWithView: async <T>(operation: () => Promise<T>) => operation() };
    const facade = new PluginOutboundHost(owner, port, createGenerationAdmissionGate());
    const store = new SnapshotStore(state([facade]));
    const disposed = vi.fn();
    store.commit(0, { snapshot: state([facade]), dispose: disposed });
    let send!: Promise<string | null>;
    await facade.runWithView!(async () => { send = facade.send(input); });
    store.commit(1, { snapshot: state([]), dispose: () => undefined });
    expect(disposed).not.toHaveBeenCalled();
    finishSend.resolve();
    await expect(send).resolves.toBe('id');
    await vi.waitFor(() => expect(disposed).toHaveBeenCalledTimes(1));
    await store.close();
  });

  it('gates retained models and lazy queries at execution and drains admitted writes', async () => {
    const entered = deferred();
    const finishWrite = deferred();
    const executeSelect = vi.fn().mockResolvedValue([{ id: 1 }]);
    const selection: DatabaseHostSelection = {
      where: () => selection, orderBy: () => selection, limit: () => selection,
      then: (fulfilled, rejected) => executeSelect().then(fulfilled, rejected),
    };
    const model: DatabaseHostModel = {
      select: () => selection, insert: vi.fn(async () => { entered.resolve(); await finishWrite.promise; return 1; }),
      delete: () => ({ where: vi.fn().mockResolvedValue(1) }),
      update: () => ({ where: vi.fn().mockResolvedValue(1) }), count: vi.fn().mockResolvedValue(1),
    };
    const port: DatabaseHost = { dialect: 'sqlite', started: true, define: vi.fn(), tables: () => [], models: { get: () => model },
      getRawDatabase: () => undefined, start: async () => undefined, stop: async () => undefined };
    const gate = createGenerationAdmissionGate();
    const facade = new PluginDatabaseHost(owner, port, gate);
    facade.define('messages', {});
    const retained = facade.models.get('messages')!;
    const query = retained.select('id').where({ id: 1 }).orderBy('id').limit(1);
    await expect(Promise.resolve(query)).rejects.toThrow('inactive generation');
    expect(executeSelect).not.toHaveBeenCalled();
    const store = new SnapshotStore(state([facade]));
    await expect(Promise.resolve(query)).resolves.toEqual([{ id: 1 }]);
    const delayedQuery = retained.select('id');
    const delayedDelete = retained.delete();
    const delayedUpdate = retained.update({ id: 2 });
    const write = retained.insert({ id: 1 });
    await entered.promise;
    const disposed = vi.fn();
    store.commit(0, { snapshot: state([facade]), dispose: disposed });
    store.commit(1, { snapshot: state([]), dispose: () => undefined });
    expect(disposed).not.toHaveBeenCalled();
    await expect(retained.insert({ id: 2 })).rejects.toThrow('inactive generation');
    await expect(retained.count!()).rejects.toThrow('inactive generation');
    await expect(delayedDelete.where({ id: 1 })).rejects.toThrow('inactive generation');
    await expect(delayedUpdate.where({ id: 1 })).rejects.toThrow('inactive generation');
    await expect(Promise.resolve(delayedQuery)).rejects.toThrow('inactive generation');
    expect(() => retained.select('id')).toThrow('inactive generation');
    expect(() => facade.models.get('messages')).toThrow('inactive generation');
    expect(() => facade.define('messages', {})).toThrow('inactive generation');
    expect(() => facade.tables()).toThrow('inactive generation');
    expect(executeSelect).toHaveBeenCalledTimes(1);
    finishWrite.resolve();
    await expect(write).resolves.toBe(1);
    await vi.waitFor(() => expect(disposed).toHaveBeenCalledTimes(1));
    await store.close();
  });

  it('preserves immutable selection builders without executing them during construction', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const selection = (steps: readonly unknown[] = []): DatabaseHostSelection => ({
      where: (query) => selection([...steps, ['where', query]]),
      orderBy: (field, direction) => selection([...steps, ['orderBy', field, direction]]),
      limit: (count) => selection([...steps, ['limit', count]]),
      then: (fulfilled, rejected) => execute(steps).then(fulfilled, rejected),
    });
    const model: DatabaseHostModel = { select: () => selection(), insert: async () => undefined,
      delete: () => ({ where: async () => undefined }), update: () => ({ where: async () => undefined }) };
    const port: DatabaseHost = { dialect: 'sqlite', started: true, define() {}, tables: () => [], models: { get: () => model },
      getRawDatabase: () => undefined, start: async () => undefined, stop: async () => undefined };
    const facade = new PluginDatabaseHost(owner, port, createGenerationAdmissionGate());
    const store = new SnapshotStore(state([facade]));
    const query = facade.models.get('messages')!.select('id').where({ id: 1 }).orderBy('id', 'DESC').limit(5);
    expect(execute).not.toHaveBeenCalled();
    await query;
    expect(execute).toHaveBeenCalledWith([['where', { id: 1 }], ['orderBy', 'id', 'DESC'], ['limit', 5]]);
    await store.close();
  });

  it('allows candidate schedule declarations but rejects stale registration and callbacks', async () => {
    const gate = createGenerationAdmissionGate();
    const jobs: ScheduleJobRegistration[] = [];
    const disposeJob = vi.fn();
    const port: ScheduleHost = { register: (job) => { jobs.push(job); return disposeJob; }, list: () => jobs };
    const facade = new PluginScheduleHost(owner, port, gate);
    const execute = vi.fn();
    const dispose = facade.register({ id: 'remind', cron: '* * * * * *', execute });
    expect(() => jobs[0].execute()).toThrow('inactive generation');
    const store = new SnapshotStore(state([facade]));
    jobs[0].execute();
    expect(execute).toHaveBeenCalledTimes(1);
    store.commit(0, { snapshot: state([]), dispose: () => undefined });
    expect(() => facade.register({ id: 'stale', cron: '* * * * * *', execute })).toThrow('inactive generation');
    expect(() => facade.list()).toThrow('inactive generation');
    expect(() => jobs[0].execute()).toThrow('inactive generation');
    // Cleanup remains callable after retirement and cannot introduce a new job.
    dispose();
    expect(disposeJob).toHaveBeenCalledTimes(1);
    expect(jobs).toHaveLength(1);
    await store.close();
  });
});
