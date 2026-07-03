/**
 * Assistant Event Ingress — 外部事件入队并触发 Job 执行（M2）
 */
import { Logger } from '@zhin.js/core';
import { formatCompact } from '@zhin.js/logger';
import type { AssistantEventsConfig } from './config.js';
import { resolveAssistantEventsConfig } from './config.js';
import type { AssistantEventRequest, AssistantEventResult } from './event-types.js';
import type { ScheduleJobEngine } from './job-engine.js';
import type { ScheduleJobStore } from './job-store.js';
import type { JobAction, JobNotify } from './types.js';

const logger = new Logger(null, 'assistant-event-ingress');

export interface AssistantEventIngressOptions {
  store: ScheduleJobStore;
  engine: ScheduleJobEngine;
  eventsConfig?: AssistantEventsConfig;
}

interface RateBucket {
  windowStart: number;
  count: number;
}

export class AssistantEventIngress {
  private store: ScheduleJobStore;
  private engine: ScheduleJobEngine;
  private eventsCfg: ReturnType<typeof resolveAssistantEventsConfig>;
  private rateBuckets = new Map<string, RateBucket>();

  constructor(options: AssistantEventIngressOptions) {
    this.store = options.store;
    this.engine = options.engine;
    this.eventsCfg = resolveAssistantEventsConfig(options.eventsConfig);
  }

  isEnabled(): boolean {
    return this.eventsCfg.enabled;
  }

  checkRateLimit(source: string): boolean {
    const limit = this.eventsCfg.rateLimitPerMinute;
    if (limit <= 0) return true;
    const now = Date.now();
    const bucket = this.rateBuckets.get(source);
    if (!bucket || now - bucket.windowStart >= 60_000) {
      this.rateBuckets.set(source, { windowStart: now, count: 1 });
      return true;
    }
    if (bucket.count >= limit) return false;
    bucket.count += 1;
    return true;
  }

  validateSource(source: string): string | null {
    const allowed = this.eventsCfg.allowedSources;
    if (!allowed || allowed.length === 0) return null;
    if (!allowed.includes(source)) {
      return `source "${source}" not in allowedSources`;
    }
    return null;
  }

  validateRequest(body: unknown): { ok: true; data: AssistantEventRequest } | { ok: false; error: string } {
    if (!body || typeof body !== 'object') {
      return { ok: false, error: 'body must be a JSON object' };
    }
    const raw = body as Record<string, unknown>;
    const source = typeof raw.source === 'string' ? raw.source.trim() : '';
    if (!source) return { ok: false, error: 'source is required' };

    const jobId = typeof raw.jobId === 'string' ? raw.jobId.trim() : undefined;
    const action = raw.action as JobAction | undefined;
    const hasAction = action && typeof action === 'object' && action.kind === 'agent'
      && typeof action.prompt === 'string' && action.prompt.trim().length > 0;

    if (!jobId && !hasAction) {
      return { ok: false, error: 'jobId or action.kind=agent with prompt is required' };
    }
    if (jobId && hasAction) {
      return { ok: false, error: 'jobId and action are mutually exclusive' };
    }

    return {
      ok: true,
      data: {
        eventId: typeof raw.eventId === 'string' ? raw.eventId.trim() : undefined,
        source,
        type: typeof raw.type === 'string' ? raw.type : undefined,
        payload: raw.payload,
        jobId,
        action: hasAction ? action : undefined,
        notify: raw.notify as JobNotify | undefined,
        label: typeof raw.label === 'string' ? raw.label : undefined,
      },
    };
  }

  async handle(body: unknown): Promise<AssistantEventResult> {
    if (!this.isEnabled()) {
      return { ok: false, status: 'error', error: 'assistant.events is disabled' };
    }

    const parsed = this.validateRequest(body);
    if (!parsed.ok) {
      return { ok: false, status: 'error', error: parsed.error };
    }
    const req = parsed.data;

    const sourceErr = this.validateSource(req.source);
    if (sourceErr) {
      return { ok: false, status: 'error', error: sourceErr };
    }
    if (!this.checkRateLimit(req.source)) {
      return { ok: false, status: 'error', error: 'rate limit exceeded' };
    }

    if (req.eventId) {
      const existing = await this.store.findEventJobByEventId(req.eventId);
      if (existing) {
        logger.debug(formatCompact({ op: 'event_deduped', eventId: req.eventId, jobId: existing.id }));
        return { ok: true, jobId: existing.id, status: 'deduped', deduped: true };
      }
    }

    try {
      if (req.jobId) {
        const job = await this.store.getJob(req.jobId);
        if (!job) {
          return { ok: false, status: 'error', error: `job not found: ${req.jobId}` };
        }
        void this.engine.runJobNow(req.jobId);
        logger.info(formatCompact({ op: 'event_trigger', jobId: req.jobId, source: req.source }));
        return { ok: true, jobId: req.jobId, status: 'queued' };
      }

      const jobId = `event_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      await this.store.createEventJob({
        id: jobId,
        label: req.label || `event:${req.source}`,
        action: req.action!,
        notify: req.notify,
        source: req.source,
        eventType: req.type,
        eventId: req.eventId,
        payload: req.payload,
      });

      void this.engine.runJobNow(jobId);
      logger.info(formatCompact({ op: 'event_enqueue', jobId, source: req.source, type: req.type }));
      return { ok: true, jobId, status: 'queued' };
    } catch (e: unknown) {
      const error = (e as Error)?.message || String(e);
      logger.warn(formatCompact({ op: 'event_error', error }));
      return { ok: false, status: 'error', error };
    }
  }
}
