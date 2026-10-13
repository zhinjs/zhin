import {
  scheduleHostToken,
  stagePluginScheduleRegistration,
  createGenerationAdmissionGate,
  createPluginScheduleCandidate,
  generationAdmissionSource,
  scopeSetupFinalizer,
  type CapabilitySlot,
  type Dispose,
  type PluginScheduleHost,
  type RuntimeSnapshot,
  type PluginId,
} from '@zhin.js/plugin-runtime';
import type { ScheduleDefinition } from './definition.js';

export class ScheduleIndex {
  readonly $projection = 'zhin.schedule-index/1' as const;
  readonly #disposers: Dispose[] = [];
  readonly #admission = createGenerationAdmissionGate();
  readonly #hosts = new Map<PluginId, PluginScheduleHost>();
  #started = false;

  constructor(
    private readonly slots: readonly Readonly<CapabilitySlot<ScheduleDefinition>>[],
    private readonly snapshot: RuntimeSnapshot,
  ) {}

  start(): void {
    if (this.#started) return;
    this.#started = true;
    try {
      for (const slot of this.slots) {
        const resources = this.snapshot.resources.get(slot.owner);
        const host = resources?.get(scheduleHostToken.id) as PluginScheduleHost | undefined;
        if (!host) throw new Error(`Schedule Host is unavailable for ${slot.owner}`);
        let candidate = this.#hosts.get(slot.owner);
        if (!candidate) {
          candidate = createPluginScheduleCandidate(host, this.#admission);
          this.#hosts.set(slot.owner, candidate);
        }
        this.#disposers.push(stagePluginScheduleRegistration(candidate, {
          id: slot.localName,
          cron: slot.definition.cron,
          description: slot.definition.description,
          execute: slot.definition.execute,
        }));
      }
    } catch (error) {
      const cleanupErrors: unknown[] = [];
      try { this.stop(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
      if (cleanupErrors.length > 0) throw new AggregateError([error, ...cleanupErrors], 'Schedule activation and cleanup both failed', { cause: error });
      throw error;
    }
  }

  stop(): void {
    const errors: unknown[] = [];
    for (const dispose of this.#disposers.splice(0).reverse()) {
      try { dispose(); } catch (error) { errors.push(error); }
    }
    for (const host of this.#hosts.values()) host[scopeSetupFinalizer]('dispose');
    this.#hosts.clear();
    this.#started = false;
    if (errors.length > 0) throw new AggregateError(errors, 'Schedule cleanup failed');
  }

  /** @internal Candidate callbacks only enter after their projection is published. */
  get [generationAdmissionSource]() { return [this.#admission]; }
}
