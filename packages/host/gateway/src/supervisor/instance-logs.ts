/**
 * Instance log capture (ADR 0054 §3): the gateway collects the instance's stdout / stderr into an
 * in-memory ring buffer (for `gateway.instance.logs` and offline viewing) and a size-rotated file
 * (`.zhin/logs/instance.log`, `.1`, `.2`, …).
 */
import { closeSync, existsSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { Readable } from 'node:stream';

export type InstanceLogStream = 'stdout' | 'stderr';

export interface InstanceLogLine {
  /** Monotonic sequence number, unique per collector. */
  readonly seq: number;
  /** Epoch milliseconds when the line was captured. */
  readonly time: number;
  readonly stream: InstanceLogStream;
  readonly line: string;
}

export interface InstanceLogOptions {
  /** Log file path; `false` keeps the ring buffer only. */
  readonly file?: string | false;
  /** Rotate once the file would exceed this many bytes. Default 10 MiB. */
  readonly maxBytes?: number;
  /** Rotated files kept besides the active one (`.1` … `.N`). Default 5. */
  readonly maxFiles?: number;
  /** Ring buffer capacity in lines. Default 1000. */
  readonly capacity?: number;
}

export const DEFAULT_INSTANCE_LOG_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_INSTANCE_LOG_MAX_FILES = 5;
export const DEFAULT_INSTANCE_LOG_CAPACITY = 1_000;
/** A line longer than this is split, so a child that never prints a newline cannot grow memory. */
const MAX_PENDING_LINE = 64 * 1024;

export class InstanceLogCollector {
  readonly #file: string | undefined;
  readonly #maxBytes: number;
  readonly #maxFiles: number;
  readonly #capacity: number;
  readonly #ring: InstanceLogLine[] = [];
  readonly #listeners = new Set<(line: InstanceLogLine) => void>();
  readonly #pending: Record<InstanceLogStream, string> = { stdout: '', stderr: '' };
  #seq = 0;
  #fd: number | undefined;
  #size = 0;
  #closed = false;

  constructor(options: InstanceLogOptions = {}) {
    this.#file = options.file === false ? undefined : options.file;
    this.#maxBytes = Math.max(1, options.maxBytes ?? DEFAULT_INSTANCE_LOG_MAX_BYTES);
    this.#maxFiles = Math.max(0, Math.floor(options.maxFiles ?? DEFAULT_INSTANCE_LOG_MAX_FILES));
    this.#capacity = Math.max(1, Math.floor(options.capacity ?? DEFAULT_INSTANCE_LOG_CAPACITY));
  }

  get file(): string | undefined { return this.#file; }

  /** Captures a child stream until it ends. */
  attach(stream: Readable, kind: InstanceLogStream): void {
    const decoder = new StringDecoder('utf8');
    stream.on('data', (chunk: Buffer | string) => {
      this.write(kind, typeof chunk === 'string' ? chunk : decoder.write(chunk));
    });
    stream.once('end', () => {
      const rest = decoder.end();
      if (rest) this.write(kind, rest);
      this.flush(kind);
    });
  }

  /** Appends raw text; complete lines are recorded, the remainder waits for its newline. */
  write(kind: InstanceLogStream, text: string): void {
    if (this.#closed || text.length === 0) return;
    let buffer = this.#pending[kind] + text;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      this.#record(kind, buffer.slice(0, newline).replace(/\r$/u, ''));
      buffer = buffer.slice(newline + 1);
    }
    while (buffer.length > MAX_PENDING_LINE) {
      this.#record(kind, buffer.slice(0, MAX_PENDING_LINE));
      buffer = buffer.slice(MAX_PENDING_LINE);
    }
    this.#pending[kind] = buffer;
  }

  /** Records an unterminated trailing line (e.g. when the child exits). */
  flush(kind?: InstanceLogStream): void {
    for (const stream of kind ? [kind] : (['stdout', 'stderr'] as const)) {
      const rest = this.#pending[stream];
      this.#pending[stream] = '';
      if (rest) this.#record(stream, rest);
    }
  }

  /** The newest `limit` lines (all buffered lines by default), oldest first. */
  tail(limit = this.#capacity): readonly InstanceLogLine[] {
    const count = Math.max(0, Math.min(limit, this.#ring.length));
    return Object.freeze(this.#ring.slice(this.#ring.length - count));
  }

  /** Live lines; returns an unsubscribe function. */
  subscribe(listener: (line: InstanceLogLine) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  close(): void {
    if (this.#closed) return;
    this.flush();
    this.#closed = true;
    this.#listeners.clear();
    this.#closeFile();
  }

  #record(stream: InstanceLogStream, line: string): void {
    const entry: InstanceLogLine = Object.freeze({ seq: ++this.#seq, time: Date.now(), stream, line });
    this.#ring.push(entry);
    if (this.#ring.length > this.#capacity) this.#ring.splice(0, this.#ring.length - this.#capacity);
    this.#append(`${line}\n`);
    for (const listener of [...this.#listeners]) {
      try { listener(entry); } catch { /* a faulty subscriber must not stop capture */ }
    }
  }

  #append(text: string): void {
    if (!this.#file) return;
    try {
      const bytes = Buffer.byteLength(text);
      this.#open();
      if (this.#size > 0 && this.#size + bytes > this.#maxBytes) this.#rotate();
      this.#open();
      writeSync(this.#fd!, text);
      this.#size += bytes;
    } catch {
      // Disk errors must not take the supervisor down; the ring buffer still has the line.
      this.#closeFile();
    }
  }

  #open(): void {
    if (this.#fd !== undefined || !this.#file) return;
    mkdirSync(dirname(this.#file), { recursive: true });
    this.#fd = openSync(this.#file, 'a');
    this.#size = statSync(this.#file).size;
  }

  #rotate(): void {
    const file = this.#file!;
    this.#closeFile();
    if (this.#maxFiles === 0) {
      rmSync(file, { force: true });
      return;
    }
    rmSync(`${file}.${this.#maxFiles}`, { force: true });
    for (let index = this.#maxFiles - 1; index >= 1; index -= 1) {
      if (existsSync(`${file}.${index}`)) renameSync(`${file}.${index}`, `${file}.${index + 1}`);
    }
    renameSync(file, `${file}.1`);
  }

  #closeFile(): void {
    if (this.#fd === undefined) return;
    try { closeSync(this.#fd); } catch { /* already closed */ }
    this.#fd = undefined;
    this.#size = 0;
  }
}
