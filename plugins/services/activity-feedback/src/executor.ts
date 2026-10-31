import {
  ActivityFeedbackManager, activityFeedbackSource, createActivityFeedbackAdapter,
  type ActivityFeedbackEventContext, type ActivityFeedbackIO, type ActivityFeedbackPhase,
  type ResolvedActivityFeedbackPhaseConfig,
} from '@zhin.js/agent';
import { conversationRefKey, type OutboundHost } from 'zhin.js';

export interface CapturedFeedbackOperation extends ActivityFeedbackIO {
  readonly signal: AbortSignal;
  release(): void;
}

/** One source capture, never a directory lookup by an alias at execution time. */
export interface ActivityFeedbackEndpointAccess {
  capture(context: ActivityFeedbackEventContext): CapturedFeedbackOperation | undefined;
}
export function createNoopEndpointAccess(): ActivityFeedbackEndpointAccess {
  return { capture: () => undefined };
}

export function createOutboundEndpointAccess(
  outbound: OutboundHost,
  logger?: { debug: (message: string, ...args: unknown[]) => void },
): ActivityFeedbackEndpointAccess {
  return {
    capture(context) {
      const source = context[activityFeedbackSource];
      if (!source || source.signal.aborted || !outbound.captureOperation) return undefined;
      try { return outbound.captureOperation(source); }
      catch (error) {
        logger?.debug('[ActivityFeedback] originating account is unavailable:', error instanceof Error ? error.message : String(error));
        return undefined;
      }
    },
  };
}

type Entry = {
  readonly key: string;
  readonly sourceClient: unknown;
  readonly operation: CapturedFeedbackOperation;
  readonly manager: ActivityFeedbackManager;
  readonly phases: Set<ActivityFeedbackPhase>;
  readonly detach: () => void;
  closing?: Promise<void>;
};

/** Holds only the bound operations needed by live phases, and releases them on every terminal path. */
export class ActivityFeedbackExecutor {
  readonly #entries = new Map<string, Entry>();
  constructor(private readonly access: ActivityFeedbackEndpointAccess) {}

  async start(context: ActivityFeedbackEventContext, phase: ActivityFeedbackPhase,
    config: ResolvedActivityFeedbackPhaseConfig): Promise<void> {
    const source = context[activityFeedbackSource];
    if (!source || source.signal.aborted) return;
    const key = this.#key(context, source.target);
    let entry = this.#entries.get(key);
    while (entry && (entry.sourceClient !== source.client || entry.closing)) {
      await this.#close(entry);
      entry = this.#entries.get(key);
    }
    if (!entry) {
      const operation = this.access.capture(context);
      if (!operation) return;
      const manager = new ActivityFeedbackManager();
      manager.registerAdapter(createActivityFeedbackAdapter({ platform: context.platform, io: operation }));
      const cancel = () => { void this.#close(created).catch(() => undefined); };
      const created: Entry = { key, sourceClient: source.client, operation, manager, phases: new Set(),
        detach: () => operation.signal.removeEventListener('abort', cancel) };
      operation.signal.addEventListener('abort', cancel, { once: true });
      this.#entries.set(key, created);
      entry = created;
      if (operation.signal.aborted) { await this.#close(entry); return; }
    }
    entry.phases.add(phase);
    try {
      const indicator = await entry.manager.start(phase, context.options, config);
      if (!indicator.isActive()) {
        entry.phases.delete(phase);
        if (!entry.phases.size) await this.#close(entry);
      }
    } catch (error) { await this.#close(entry); throw error; }
  }

  async stop(context: ActivityFeedbackEventContext, phase: ActivityFeedbackPhase): Promise<void> {
    const source = context[activityFeedbackSource];
    if (!source) return;
    const entry = this.#entries.get(this.#key(context, source.target));
    if (!entry || entry.sourceClient !== source.client) return;
    try { await entry.manager.stop(phase, context.options); }
    finally {
      entry.phases.delete(phase);
      if (!entry.phases.size) await this.#close(entry);
    }
  }

  async updateText(context: ActivityFeedbackEventContext, phase: ActivityFeedbackPhase, text: string): Promise<void> {
    const source = context[activityFeedbackSource];
    if (!source) return;
    const entry = this.#entries.get(this.#key(context, source.target));
    if (!entry || entry.closing || entry.operation.signal.aborted || entry.sourceClient !== source.client) return;
    await entry.manager.getActiveIndicator(phase, context.options)?.update?.(text);
  }
  updateThinkingText(context: ActivityFeedbackEventContext, text: string): Promise<void> {
    return this.updateText(context, 'thinking', text);
  }
  async dispose(): Promise<void> { await Promise.allSettled([...this.#entries.values()].map(entry => this.#close(entry))); }

  #key(context: ActivityFeedbackEventContext, target: ActivityFeedbackIO['target']): string {
    return JSON.stringify([conversationRefKey(target), context.sessionId, context.messageId ?? null]);
  }
  #close(entry: Entry): Promise<void> {
    return entry.closing ??= Promise.resolve().then(async () => {
      entry.detach();
      try { await entry.manager.dispose(); }
      finally {
        entry.operation.release();
        if (this.#entries.get(entry.key) === entry) this.#entries.delete(entry.key);
      }
    });
  }
}

/** Policy orchestration needs behavior, not the concrete executor's private state. */
export type ActivityFeedbackExecution = Pick<ActivityFeedbackExecutor,
  'start' | 'stop' | 'updateText' | 'updateThinkingText' | 'dispose'>;
