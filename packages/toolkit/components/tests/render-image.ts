import { afterAll, beforeAll, expect } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { PNG } from 'pngjs';

type ImageResult = { data: Buffer; format: string; width: number; height: number };
type PendingImage = {
  resolve: (result: ImageResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
let worker: ChildProcess | undefined;
let workerReady: Promise<void> | undefined;
let workerFailure: Error | undefined;
/** Backstop only: startup (tsx + Chromium launch) is awaited through the worker's ready signal. */
const STARTUP_BACKSTOP_MS = 60_000;
/** One capture after the browser is up; startup no longer counts against it. */
const CAPTURE_TIMEOUT_MS = 8_000;
let sequence = 0;
const pending = new Map<number, PendingImage>();

function rejectPending(error: Error): void {
  workerFailure = error;
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(error);
  }
  pending.clear();
}

function child(): { active: ChildProcess; ready: Promise<void> } {
  if (workerFailure) throw workerFailure;
  if (worker && workerReady) return { active: worker, ready: workerReady };
  // Blink can start only once in an OS process. File-isolated Vitest modules
  // still reuse native modules, so own a process and stop it at this file's end.
  worker = fork(new URL('./render-image-worker.mjs', import.meta.url), [], {
    execArgv: ['--conditions=development', '--import', 'tsx'],
    serialization: 'advanced',
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  const started = worker;
  let settleReady: { resolve: () => void; reject: (error: Error) => void } | undefined;
  workerReady = new Promise<void>((resolve, reject) => { settleReady = { resolve, reject }; });
  // Mark handled: a failure is surfaced through renderImage's await, never as an unhandled rejection.
  workerReady.catch(() => undefined);
  const startup = setTimeout(() => {
    const error = new Error(`Image worker did not start within ${STARTUP_BACKSTOP_MS / 1000} seconds`);
    settleReady?.reject(error);
    rejectPending(error);
    started.kill('SIGKILL');
  }, STARTUP_BACKSTOP_MS);
  worker.on('message', (message: { id?: number; ready?: boolean; result?: ImageResult; error?: string }) => {
    if (message.ready !== undefined) {
      clearTimeout(startup);
      if (message.ready) settleReady?.resolve();
      else {
        const error = new Error(`Image worker failed to start: ${message.error}`);
        workerFailure = error;
        settleReady?.reject(error);
      }
      return;
    }
    if (message.id === undefined) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.result!);
  });
  worker.on('error', (error) => {
    clearTimeout(startup);
    settleReady?.reject(error);
    rejectPending(error);
  });
  worker.on('exit', (code, signal) => {
    clearTimeout(startup);
    const error = new Error(`Image worker exited (${signal ?? code})`);
    settleReady?.reject(error);
    rejectPending(error);
  });
  return { active: worker, ready: workerReady };
}

// Every importer renders: start the worker in a hook with the startup budget, so a test's own
// timeout only covers its captures (a slow, loaded machine no longer fails the first test).
beforeAll(async () => {
  await child().ready;
}, STARTUP_BACKSTOP_MS + 5_000);

afterAll(async () => {
  if (!worker) return;
  if (worker.exitCode !== null || worker.signalCode !== null) {
    if (worker.exitCode === 0) return;
    throw new Error(`Image worker exited (${worker.signalCode ?? worker.exitCode})`);
  }
  const active = worker;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      active.kill('SIGKILL');
      reject(new Error('Image worker did not stop within 4 seconds'));
    }, 4_000);
    active.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Image worker exited (${signal ?? code})`));
    });
    active.send({ stop: true }, error => {
      if (!error) return;
      clearTimeout(timer);
      active.kill('SIGKILL');
      reject(error);
    });
  });
});

/** Real Chromium rendering; exact root fills expose geometry without font dependence. */
export async function renderImage(html: string, width = 240): Promise<PNG> {
  const { active, ready } = child();
  await ready;
  const result = await new Promise<ImageResult>((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      rejectPending(new Error(`Image worker capture exceeded ${CAPTURE_TIMEOUT_MS / 1000} seconds`));
      active.kill('SIGKILL');
    }, CAPTURE_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    active.send({ id, html, width }, error => {
      if (error) rejectPending(error);
    });
  });
  expect(result.format).toBe('png');
  const image = PNG.sync.read(result.data);
  expect(image.width).toBe(width);
  expect(image.height).toBeGreaterThan(0);
  expect(image.width).toBe(result.width);
  expect(image.height).toBe(result.height);
  return image;
}

export function colorBox(image: PNG, hex: string) {
  const color = hex.replace(/^#/, '');
  if (!/^[\da-f]{6}$/i.test(color)) throw new Error(`Expected six-digit color: ${hex}`);
  const rgb = [0, 2, 4].map(offset => parseInt(color.slice(offset, offset + 2), 16));
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;
  let pixels = 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const index = (y * image.width + x) * 4;
      const matches = rgb.every((channel, offset) => image.data[index + offset] === channel);
      if (!matches || image.data[index + 3] !== 255) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      pixels++;
    }
  }
  if (!pixels) throw new Error(`No pixels rendered with ${hex}`);
  return { x: left, y: top, top, width: right - left + 1, height: bottom - top + 1, pixels };
}
