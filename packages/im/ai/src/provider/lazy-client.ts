import { assistantText, type AssistantMessage, type AssistantStreamEvent } from '../llm/index.js';
import { OwnedLanguageRun } from './owned-stream.js';
import { ProviderError, type InferenceClient, type LanguageRun } from './types.js';
import type { InferenceUsageAccounting, InferenceUsageInvocation, InferenceUsageOutcome, InferenceUsageRequest } from './usage.js';

export interface LazyInferenceClientOptions {
  readonly signal: AbortSignal;
  /** Host closure owns the exact lease, identity and graph capture; callers supply none of them. */
  readonly open: (input: Readonly<{ signal: AbortSignal }>) => Promise<InferenceClient>;
  readonly accounting?: InferenceUsageAccounting;
  readonly onCleanupError?: (error: unknown) => void;
}
function usage(message: AssistantMessage): InferenceUsageOutcome {
  const reported = message.usage.reported;
  const total = reported ? reported.totalTokens === true || reported.input === true && reported.output === true
    ? message.usage.totalTokens : undefined : message.usage.totalTokens > 0 ? message.usage.totalTokens : undefined;
  return { ...(total !== undefined ? { totalTokens: total } : {}), text: assistantText(message) };
}

/** One operation's lazy client. Returning it from execute does not transfer its lifetime. */
export function createLazyInferenceClient(options: LazyInferenceClientOptions): InferenceClient {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, options.signal]);
  const pending = new Set<Promise<unknown>>(), runs = new Set<LanguageRun>();
  let opening: Promise<InferenceClient> | undefined, closing: Promise<void> | undefined, underlyingClose: Promise<void> | undefined;
  let closed = false;
  const report = (error: unknown) => { try { options.onCleanupError?.(error); } catch { /* diagnostics are not business results */ } };
  const dispose = (client: InferenceClient) => underlyingClose ??= Promise.resolve().then(() => client.close()).catch(report);
  function assertOpen() {
    if (closed) throw new ProviderError('operation-closed');
    signal.throwIfAborted();
  }
  function get(): Promise<InferenceClient> {
    assertOpen();
    return opening ??= Promise.resolve().then(() => { assertOpen(); return options.open({ signal }); }).then(async client => {
      if (closed || signal.aborted) { await dispose(client); throw new ProviderError('operation-closed'); }
      return client;
    });
  }
  function track<T>(promise: Promise<T>): Promise<T> {
    pending.add(promise); void promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return promise;
  }
  async function invoke<T>(request: InferenceUsageRequest, execute: (client: InferenceClient) => Promise<T>, outcome: (result: T) => InferenceUsageOutcome): Promise<T> {
    assertOpen();
    const invocation = options.accounting?.begin(request);
    try {
      const operation = async () => execute(await get());
      const result = await (invocation ? invocation.run(operation) : operation());
      try { invocation?.finish(outcome(result)); } catch (error) { report(error); }
      return result;
    } finally { try { invocation?.close(); } catch (error) { report(error); } }
  }
  async function close(): Promise<void> {
    if (closing) return closing;
    closed = true; options.signal.removeEventListener('abort', stop);
    controller.abort(new ProviderError('operation-closed'));
    return closing = (async () => {
      await Promise.allSettled([...runs].map(run => run.close()));
      await Promise.allSettled([...pending]);
      if (opening) await opening.then(dispose, () => undefined);
    })();
  }
  const stop = () => { void close().catch(report); };
  options.signal.addEventListener('abort', stop, { once: true });
  if (options.signal.aborted) stop();
  const client: InferenceClient = {
    list(input) { return track((async () => (await get()).list(input))()); },
    generate(input) {
      return track(invoke({ kind: 'language', request: input.request }, underlying => underlying.generate({ ...input,
        signal: input.signal ? AbortSignal.any([signal, input.signal]) : signal }), usage));
    },
    evaluate(input) {
      return track(invoke({ kind: 'decision', state: input.state, questions: input.questions }, underlying => underlying.evaluate({ ...input,
        signal: input.signal ? AbortSignal.any([signal, input.signal]) : signal }), result => ({ totalTokens: result.usage.inputTokens + result.usage.outputTokens })));
    },
    generateImage(input) {
      return track(invoke({ kind: 'image', request: input.request }, underlying => underlying.generateImage({ ...input,
        signal: input.signal ? AbortSignal.any([signal, input.signal]) : signal }), () => ({})));
    },
    async stream(input) {
      assertOpen();
      const streamController = new AbortController();
      const streamSignal = AbortSignal.any([signal, streamController.signal, ...(input.signal ? [input.signal] : [])]);
      let invocation: InferenceUsageInvocation | undefined, source: LanguageRun | undefined, released: Promise<void> | undefined;
      const cancel = () => streamController.abort(streamSignal.reason);
      const release = () => released ??= (async () => {
        runs.delete(run);
        streamSignal.removeEventListener('abort', cancel);
        try { await source?.close(); } catch (error) { report(error); }
        try { invocation?.close(); } catch (error) { report(error); }
      })();
      async function* events(): AsyncGenerator<AssistantStreamEvent> {
        assertOpen(); streamSignal.throwIfAborted();
        invocation = options.accounting?.begin({ kind: 'language', request: input.request });
        const within = <T>(operation: () => Promise<T>) => invocation ? invocation.run(operation) : operation();
        try {
          source = await within(async () => (await get()).stream({ ...input, signal: streamSignal }));
          const iterator = source[Symbol.asyncIterator]();
          for (;;) {
            const next = await within(() => iterator.next());
            if (next.done) return;
            if (next.value.type === 'done' && next.value.message) {
              try { invocation?.finish(usage(next.value.message)); } catch (error) { report(error); }
            }
            yield next.value;
          }
        } finally { await release(); }
      }
      const run = new OwnedLanguageRun({ source: events(), controller: streamController, release, project: value => value, onCleanupError: report });
      runs.add(run);
      streamSignal.addEventListener('abort', cancel, { once: true });
      if (streamSignal.aborted) cancel();
      return run;
    },
    close,
    [Symbol.asyncDispose]: close,
  };
  return Object.freeze(client);
}
