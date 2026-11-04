import type { AssistantStreamEvent } from '../llm/llm-api-runtime.js';
import { ProviderError, type LanguageRun } from './types.js';

export interface OwnedLanguageRunOptions {
  readonly source: AsyncIterable<AssistantStreamEvent>;
  readonly controller: AbortController;
  readonly release: () => Promise<void>;
  readonly project: (event: AssistantStreamEvent) => AssistantStreamEvent;
  readonly onCleanupError: (error: unknown) => void;
}
/** Pull-only, one-consumer stream. This class never reads ahead or stores events. */
export class OwnedLanguageRun implements LanguageRun {
  readonly #iterator: AsyncIterator<AssistantStreamEvent>;
  #claimed = false;
  #closed = false;
  #closing?: Promise<void>;
  readonly #abort = () => { void this.close().catch(() => undefined); };
  constructor(private readonly options: OwnedLanguageRunOptions) {
    this.#iterator = options.source[Symbol.asyncIterator]();
    options.controller.signal.addEventListener('abort', this.#abort, { once: true });
  }
  [Symbol.asyncIterator](): AsyncIterator<AssistantStreamEvent> {
    if (this.#claimed) throw new ProviderError('multiple-stream-consumers');
    this.#claimed = true;
    return {
      next: () => this.#next(),
      return: async () => { await this.close(); return { done: true, value: undefined }; },
      throw: async error => {
        await this.close();
        throw error;
      },
    };
  }
  async #next(): Promise<IteratorResult<AssistantStreamEvent>> {
    if (this.#closed) { await this.#closing; return { done: true, value: undefined }; }
    try {
      const result = await this.#iterator.next();
      if (this.#closed) { await this.#closing; return { done: true, value: undefined }; }
      if (result.done) { await this.#finish(false); return { done: true, value: undefined }; }
      return { done: false, value: this.options.project(result.value) };
    } catch (error) {
      await this.#finish(true);
      throw error;
    }
  }
  #finish(returnIterator: boolean): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.options.controller.signal.removeEventListener('abort', this.#abort);
    this.options.controller.abort(new ProviderError('operation-closed'));
    this.#closing = Promise.resolve().then(async () => {
      if (returnIterator && this.#iterator.return) {
        try { await this.#iterator.return(); } catch (error) {
          try { this.options.onCleanupError(error); } catch { /* diagnostics cannot prevent resource release */ }
        }
      }
      await this.options.release();
    });
    return this.#closing;
  }
  close(): Promise<void> { return this.#finish(true); }
  [Symbol.asyncDispose](): Promise<void> { return this.close(); }
}
