import {
  scheduleHostToken,
  type CapabilitySlot,
  type Dispose,
  type PluginScheduleHost,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import type { ScheduleDefinition } from './definition.js';

export class ScheduleIndex {
  readonly $projection = 'zhin.schedule-index/1' as const;
  readonly #disposers: Dispose[] = [];
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
        this.#disposers.push(host.register({
          id: slot.localName,
          cron: slot.definition.cron,
          description: slot.definition.description,
          execute: slot.definition.execute,
        }));
      }
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop(): void {
    for (const dispose of this.#disposers.splice(0).reverse()) dispose();
    this.#started = false;
  }
}
