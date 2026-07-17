/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports --
 * The serialized bootstrap cannot retain imported runtime values or external types. */
/**
 * This function is serialized into Worker and child-process entry scripts.
 * It must remain self-contained: every dependency belongs inside the function.
 */
export function isolateBootstrap(): void {
  const processSend = process.send?.bind(process);
  const workerThreads = processSend ? undefined : require('node:worker_threads');
  const endpoint = processSend
    ? {
        send: (message: unknown) => processSend(message),
        receive: (listener: (message: any) => void) => process.on('message', listener),
      }
    : {
        send: (message: unknown) => workerThreads.parentPort.postMessage(message),
        receive: (listener: (message: any) => void) => workerThreads.parentPort.on('message', listener),
      };

  let definition: any;
  let preparePayload: any;
  let state = 'empty';
  const disposers: Array<() => unknown> = [];
  const handlers = new Map<string, (input: unknown) => unknown>();
  const hostCalls = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  let nextHostCall = 1;

  const errorValue = (error: unknown) => {
    const value = error instanceof Error ? error : new Error(String(error));
    return { name: value.name, message: value.message, stack: value.stack };
  };
  const fromErrorValue = (error: any) => {
    const value = new Error(error?.message ?? 'Unknown Host RPC error');
    value.name = error?.name ?? 'Error';
    if (error?.stack) value.stack = error.stack;
    return value;
  };
  const clone = (value: unknown) => structuredClone(value);
  // Construct native import inside the isolate so test runners and future
  // Host compilers cannot rewrite it to a Host-only helper.
  const importModule = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<any>;

  const channel = {
    expose(method: string, handler: (input: unknown) => unknown) {
      if (!method || handlers.has(method)) throw new Error(`Duplicate isolated method: ${method}`);
      handlers.set(method, handler);
      return () => handlers.delete(method);
    },
    call(method: string, input?: unknown) {
      const id = nextHostCall++;
      endpoint.send({ type: 'host-call', id, method, input: clone(input) });
      return new Promise((resolve, reject) => hostCalls.set(id, { resolve, reject }));
    },
    emit(name: string, payload?: unknown) {
      endpoint.send({ type: 'event', name, payload: clone(payload) });
    },
  };

  const disposeSetup = async () => {
    const errors: unknown[] = [];
    for (const dispose of disposers.splice(0).reverse()) {
      try { await dispose(); } catch (error) { errors.push(error); }
    }
    handlers.clear();
    if (errors.length > 0) throw new AggregateError(errors, 'Isolated Plugin disposal failed');
  };

  const methods = {
    async prepare(payload: any) {
      if (state !== 'empty') throw new Error('Isolated Plugin has already been prepared');
      preparePayload = payload;
      const namespace = await importModule(payload.entry);
      definition = namespace.default;
      if (!definition || typeof definition.name !== 'string') {
        throw new TypeError(`${payload.packageName} does not default-export a Plugin definition`);
      }
      const allowed = new Set(['zhin.isolate.channel', 'zhin.runtime-environment']);
      for (const token of definition.requires ?? []) {
        if (!allowed.has(token.id)) throw new Error(`Host resource cannot cross isolation boundary: ${token.id}`);
      }
      const descriptor = { name: definition.name, metadata: definition.metadata };
      clone(descriptor);
      state = 'prepared';
      return descriptor;
    },
    async activate() {
      if (state !== 'prepared') throw new Error(`Cannot activate isolated Plugin from ${state}`);
      const local = new Map<string, unknown>([
        ['zhin.isolate.channel', channel],
        ['zhin.runtime-environment', Object.freeze(preparePayload.environment)],
      ]);
      const lifecycle = {
        add(dispose: () => unknown) { disposers.push(dispose); return dispose; },
        seal() {},
        dispose: disposeSetup,
      };
      const resources = {
        use(token: { id: string }) {
          if (!local.has(token.id)) throw new Error(`Missing isolated resource ${token.id}`);
          return local.get(token.id);
        },
        has(token: { id: string }) { return local.has(token.id); },
        provide(token: { id: string }, value: unknown, dispose?: () => unknown) {
          if (local.has(token.id)) throw new Error(`Duplicate isolated resource ${token.id}`);
          local.set(token.id, value);
          if (dispose) disposers.push(dispose);
        },
      };
      const plugin = Object.freeze({
        id: preparePayload.owner,
        instanceKey: preparePayload.owner.split('/').at(-1),
        parent: preparePayload.parent,
        root: 'root',
        role: 'child',
      });
      try {
        const returned = await definition.setup?.({
          plugin,
          config: { get: () => Object.freeze(preparePayload.config) },
          resources,
          lifecycle,
          handoff: { add() { throw new Error('Nested generation handoff is unavailable in isolation'); } },
        });
        if (returned) disposers.push(returned);
        state = 'active';
      } catch (error) {
        await disposeSetup();
        state = 'prepared';
        throw error;
      }
    },
    async deactivate() {
      if (state === 'active') await disposeSetup();
      if (state !== 'closed') state = 'prepared';
    },
    async call(payload: any) {
      if (state !== 'active') throw new Error(`Isolated Plugin is not active: ${state}`);
      const handler = handlers.get(payload.method);
      if (!handler) throw new Error(`Unknown isolated method: ${payload.method}`);
      return clone(await handler(payload.input));
    },
    async dispose() {
      if (state === 'active') await disposeSetup();
      state = 'closed';
      for (const pending of hostCalls.values()) pending.reject(new Error('Isolated Plugin closed'));
      hostCalls.clear();
    },
  };

  endpoint.receive(async (message: any) => {
    if (message?.type === 'host-result') {
      const pending = hostCalls.get(message.id);
      if (!pending) return;
      hostCalls.delete(message.id);
      if (message.ok) pending.resolve(message.value);
      else pending.reject(fromErrorValue(message.error));
      return;
    }
    if (message?.type !== 'request') return;
    try {
      const value = await methods[message.method as keyof typeof methods](message.payload);
      endpoint.send({ type: 'response', id: message.id, ok: true, value: clone(value) });
    } catch (error) {
      endpoint.send({ type: 'response', id: message.id, ok: false, error: errorValue(error) });
    }
  });
}
