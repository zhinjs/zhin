import { createToken, type Scope } from '@zhin.js/plugin-runtime';
import type {
  PortfolioControlOutboxItem,
  PortfolioControlOutboxRepository,
} from '../portfolio/capacity-control-outbox.js';
import type { PortfolioJournalRepository } from '../portfolio/portfolio-journal.js';
import type { GenerationOwnedPortfolioCapacityRuntime } from './workroom-portfolio-capacity.js';
import {
  WorkroomPortfolioControlRuntime,
  type PortfolioWorkroomAckAuthorityPort,
  type PortfolioWorkroomControlDeliveryPort,
  type PortfolioWorkroomRouteAuthorityPort,
} from './workroom-portfolio-control-runtime.js';

export interface WorkroomPortfolioControlWorker {
  readonly runtime: WorkroomPortfolioControlRuntime;
  start(): void;
  drain(): Promise<number>;
  dispose(): Promise<void>;
}

export const portfolioControlWorkerToken = createToken<WorkroomPortfolioControlWorker>(
  'zhin.agent.portfolio-control-worker',
  'Generation-owned durable Portfolio Grant/Reclaim delivery worker',
);

export interface InstallWorkroomPortfolioControlWorkerOptions {
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly resources: Pick<Scope, 'has' | 'provide' | 'use'>;
  readonly journal: Pick<PortfolioJournalRepository, 'listPortfolioIds' | 'read'>;
  readonly outbox: PortfolioControlOutboxRepository;
  readonly capacity: Pick<GenerationOwnedPortfolioCapacityRuntime, 'consume' | 'acknowledgeReclaim'>;
  readonly route: PortfolioWorkroomRouteAuthorityPort;
  readonly grantAssignments: PortfolioWorkroomControlDeliveryPort & PortfolioWorkroomAckAuthorityPort;
  readonly checkpointAcks: PortfolioWorkroomControlDeliveryPort & PortfolioWorkroomAckAuthorityPort;
  readonly workerId?: string;
  readonly intervalMs?: number;
  readonly autoStart?: boolean;
  readonly onError?: (error: unknown) => void;
}

/** Installs one generation-owned worker; discussion surfaces receive no command port. */
export function installWorkroomPortfolioControlWorker(
  options: InstallWorkroomPortfolioControlWorkerOptions,
): WorkroomPortfolioControlWorker {
  if (options.resources.has(portfolioControlWorkerToken)) {
    return options.resources.use(portfolioControlWorkerToken);
  }
  const control = multiplexControl(options.grantAssignments, options.checkpointAcks);
  const runtime = new WorkroomPortfolioControlRuntime({
    generation: options.generation,
    workerId: options.workerId ?? `portfolio-control:generation:${options.generation}`,
    journal: options.journal,
    outbox: options.outbox,
    capacity: options.capacity,
    route: options.route,
    delivery: control,
    acknowledgements: control,
    ...(options.onError ? { onDeliveryError: options.onError } : {}),
  });
  const worker = new GenerationOwnedPortfolioControlWorker({
    runtime,
    signal: options.signal,
    intervalMs: options.intervalMs ?? 1_000,
    ...(options.onError ? { onError: options.onError } : {}),
  });
  options.resources.provide(portfolioControlWorkerToken, worker);
  if (options.autoStart !== false) worker.start();
  return worker;
}

class GenerationOwnedPortfolioControlWorker implements WorkroomPortfolioControlWorker {
  readonly runtime: WorkroomPortfolioControlRuntime;
  readonly #signal: AbortSignal;
  readonly #intervalMs: number;
  readonly #onError?: (error: unknown) => void;
  #timer?: ReturnType<typeof setTimeout>;
  #running?: Promise<number>;
  #stopped = false;

  constructor(options: Readonly<{
    runtime: WorkroomPortfolioControlRuntime;
    signal: AbortSignal;
    intervalMs: number;
    onError?: (error: unknown) => void;
  }>) {
    if (!Number.isSafeInteger(options.intervalMs) || options.intervalMs < 1) {
      throw new Error('Portfolio Control worker interval is invalid');
    }
    this.runtime = options.runtime;
    this.#signal = options.signal;
    this.#intervalMs = options.intervalMs;
    this.#onError = options.onError;
    this.#signal.addEventListener('abort', this.#abort, { once: true });
  }

  start(): void {
    if (this.#stopped || this.#signal.aborted) return;
    if (!this.#timer) this.#schedule(0);
  }

  async drain(): Promise<number> {
    if (this.#stopped || this.#signal.aborted) return 0;
    if (this.#running) return await this.#running;
    const running = this.runtime.drain(this.#signal);
    this.#running = running;
    try {
      return await running;
    } finally {
      if (this.#running === running) this.#running = undefined;
    }
  }

  async dispose(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#signal.removeEventListener('abort', this.#abort);
    await this.#running;
  }

  readonly #abort = () => { void this.dispose(); };

  #schedule(delay: number): void {
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      if (this.#stopped || this.#signal.aborted) return;
      void this.drain().catch(error => this.#onError?.(error)).finally(() => {
        if (!this.#stopped && !this.#signal.aborted) this.#schedule(this.#intervalMs);
      });
    }, delay);
    this.#timer.unref?.();
  }
}

function multiplexControl(
  grant: PortfolioWorkroomControlDeliveryPort & PortfolioWorkroomAckAuthorityPort,
  reclaim: PortfolioWorkroomControlDeliveryPort & PortfolioWorkroomAckAuthorityPort,
): PortfolioWorkroomControlDeliveryPort & PortfolioWorkroomAckAuthorityPort {
  const delegate = (item: PortfolioControlOutboxItem) => item.payload.kind === 'grant_offer' ? grant : reclaim;
  return Object.freeze({
    deliver: (item: PortfolioControlOutboxItem, signal: AbortSignal) =>
      delegate(item).deliver(item, signal),
    reconcile: (item: PortfolioControlOutboxItem, signal: AbortSignal) =>
      delegate(item).reconcile(item, signal),
    authenticate: (item: PortfolioControlOutboxItem, ack: Parameters<PortfolioWorkroomAckAuthorityPort['authenticate']>[1]) =>
      delegate(item).authenticate(item, ack),
  });
}
