import { spawn, type ChildProcess } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { isolateBootstrap } from './bootstrap.js';
import type { HostMessage, IsolateMessage } from './protocol.js';

export type IsolateMode = 'worker' | 'process';

export interface MessageTransport {
  send(message: IsolateMessage): void;
  onMessage(listener: (message: HostMessage) => void): void;
  onExit(listener: (error: Error) => void): void;
  close(): Promise<void>;
}

export function createTransport(mode: IsolateMode): MessageTransport {
  const source = `(${isolateBootstrap.toString()})()`;
  return mode === 'worker'
    ? new WorkerTransport(new Worker(source, { eval: true }))
    : new ProcessTransport(spawn(process.execPath, ['-e', source], {
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        serialization: 'advanced',
      }));
}

class WorkerTransport implements MessageTransport {
  constructor(private readonly worker: Worker) {}
  send(message: IsolateMessage): void { this.worker.postMessage(message); }
  onMessage(listener: (message: HostMessage) => void): void { this.worker.on('message', listener); }
  onExit(listener: (error: Error) => void): void {
    this.worker.once('error', listener);
    this.worker.once('exit', (code) => {
      if (code !== 0) listener(new Error(`Isolated Worker exited with code ${code}`));
    });
  }
  async close(): Promise<void> { await this.worker.terminate(); }
}

class ProcessTransport implements MessageTransport {
  constructor(private readonly child: ChildProcess) {}
  send(message: IsolateMessage): void {
    if (!this.child.send) throw new Error('Isolated process IPC is unavailable');
    this.child.send(message);
  }
  onMessage(listener: (message: HostMessage) => void): void { this.child.on('message', listener); }
  onExit(listener: (error: Error) => void): void {
    this.child.once('error', listener);
    this.child.once('exit', (code, signal) => {
      if (code !== 0) listener(new Error(`Isolated process exited (${code ?? signal})`));
    });
  }
  async close(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.kill();
    await new Promise<void>((resolve) => this.child.once('exit', () => resolve()));
  }
}
