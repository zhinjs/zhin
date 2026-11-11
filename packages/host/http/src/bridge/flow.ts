/**
 * Credit-based body streaming shared by both ends of the bridge (ADR 0054 §3).
 *
 * The sender ({@link pumpBody}) never has more than its credit in flight; the receiver
 * ({@link InboundBody}) buffers at most the window and grants credit as its consumer reads.
 */

/**
 * A copy that owns its whole `ArrayBuffer`. Structured clone serializes a view's entire backing
 * buffer, so a pooled `Buffer` or a `subarray` would otherwise ship unrelated bytes.
 */
export function ownBytes(chunk: Uint8Array): Uint8Array {
  if (chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength && !(chunk.buffer instanceof SharedArrayBuffer)) {
    return Object.getPrototypeOf(chunk) === Uint8Array.prototype ? chunk : new Uint8Array(chunk.buffer, 0, chunk.byteLength);
  }
  return new Uint8Array(chunk);
}

export class BridgeStreamClosedError extends Error {
  constructor(message = 'Bridge stream closed') {
    super(message);
    this.name = 'BridgeStreamClosedError';
  }
}

/** Sender-side credit: {@link take} waits while the receiver has not granted more. */
export class CreditGate {
  #credit: number;
  #waiter: (() => void) | undefined;
  #closed: Error | undefined;

  constructor(initial: number) {
    this.#credit = initial;
  }

  get available(): number { return this.#credit; }

  add(bytes: number): void {
    this.#credit += bytes;
    this.#wake();
  }

  /** Resolves with up to `max` bytes of credit (at least 1); rejects once closed. */
  async take(max: number): Promise<number> {
    while (this.#credit <= 0) {
      if (this.#closed) throw this.#closed;
      await new Promise<void>((resolve) => { this.#waiter = resolve; });
    }
    if (this.#closed) throw this.#closed;
    const granted = Math.min(max, this.#credit);
    this.#credit -= granted;
    return granted;
  }

  close(error: Error = new BridgeStreamClosedError()): void {
    this.#closed ??= error;
    this.#wake();
  }

  #wake(): void {
    const waiter = this.#waiter;
    this.#waiter = undefined;
    waiter?.();
  }
}

export interface PumpBodyOptions {
  readonly gate: CreditGate;
  readonly maxChunkBytes: number;
  send(chunk: Uint8Array): void;
  /** Aborting stops the pump and cancels the source. */
  readonly signal?: AbortSignal;
}

/**
 * Reads `source` to the end and sends it in chunks that fit both the frame limit and the
 * available credit. Rejects when the source errors, the gate closes or `signal` aborts; the
 * source is cancelled in every failure case.
 */
export async function pumpBody(source: ReadableStream<Uint8Array>, options: PumpBodyOptions): Promise<void> {
  const reader = source.getReader();
  const onAbort = (): void => {
    options.gate.close(new BridgeStreamClosedError('Bridge stream aborted'));
    void reader.cancel(options.signal?.reason).catch(() => undefined);
  };
  if (options.signal?.aborted) onAbort();
  else options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) return;
      const value: unknown = next.value;
      const bytes = value instanceof Uint8Array
        ? value
        : typeof value === 'string' ? new TextEncoder().encode(value) : undefined;
      if (!bytes) throw new TypeError('Body chunks must be Uint8Array');
      let offset = 0;
      while (offset < bytes.byteLength) {
        const size = await options.gate.take(Math.min(options.maxChunkBytes, bytes.byteLength - offset));
        options.send(ownBytes(bytes.subarray(offset, offset + size)));
        offset += size;
      }
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

export interface InboundBodyOptions {
  /** Credit the sender started with; also the most this body buffers. */
  readonly window: number;
  /** Grants `bytes` more credit to the sender. */
  grant(bytes: number): void;
  /** The consumer cancelled the body; tell the sender to stop. */
  cancel(reason: unknown): void;
}

/** Receiver side: a pull-driven `ReadableStream` that grants credit as its consumer reads. */
export class InboundBody {
  readonly stream: ReadableStream<Uint8Array>;
  readonly #options: InboundBodyOptions;
  readonly #queue: Uint8Array[] = [];
  #buffered = 0;
  #ungranted = 0;
  #ended = false;
  #error: unknown;
  #failed = false;
  #cancelled = false;
  #waiter: (() => void) | undefined;

  constructor(options: InboundBodyOptions) {
    this.#options = options;
    this.stream = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        while (this.#queue.length === 0 && !this.#ended && !this.#failed) {
          await new Promise<void>((resolve) => { this.#waiter = resolve; });
        }
        const chunk = this.#queue.shift();
        if (chunk) {
          this.#buffered -= chunk.byteLength;
          this.#consumed(chunk.byteLength);
          controller.enqueue(chunk);
          return;
        }
        if (this.#failed) controller.error(this.#error);
        else controller.close();
      },
      cancel: (reason) => {
        this.#cancelled = true;
        this.#queue.length = 0;
        this.#buffered = 0;
        if (!this.#ended && !this.#failed) this.#options.cancel(reason);
        this.#ended = true;
      },
    }, { highWaterMark: 0 });
  }

  /** Whether the stream reached a terminal state (end, error, cancel). */
  get settled(): boolean { return this.#ended || this.#failed; }

  get bufferedBytes(): number { return this.#buffered; }

  /** Queues a chunk; false when the sender exceeded its credit (protocol violation). */
  push(chunk: Uint8Array): boolean {
    if (this.#cancelled || this.settled) return true;
    if (this.#buffered + this.#ungranted + chunk.byteLength > this.#options.window) return false;
    this.#queue.push(chunk);
    this.#buffered += chunk.byteLength;
    this.#wake();
    return true;
  }

  end(): void {
    if (this.settled) return;
    this.#ended = true;
    this.#wake();
  }

  fail(error: unknown): void {
    if (this.settled) return;
    this.#failed = true;
    this.#error = error;
    this.#queue.length = 0;
    this.#buffered = 0;
    this.#wake();
  }

  #consumed(bytes: number): void {
    this.#ungranted += bytes;
    // Grant in batches. The sender stalls only with a full window in flight; once the queue is
    // drained all of it is ungranted, so any threshold up to the window can never deadlock.
    if (this.#ungranted >= Math.max(1, Math.floor(this.#options.window / 4))) {
      const granted = this.#ungranted;
      this.#ungranted = 0;
      if (!this.#ended && !this.#failed) this.#options.grant(granted);
    }
  }

  #wake(): void {
    const waiter = this.#waiter;
    this.#waiter = undefined;
    waiter?.();
  }
}
