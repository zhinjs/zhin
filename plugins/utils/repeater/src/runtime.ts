import { definePluginStore } from 'zhin.js';
import type { RepeaterConfig, RepeaterEngine } from './engine.js';

export const repeaterEngineToken = definePluginStore<RepeaterEngine>(
  'zhin.repeater.engine',
  'Conversation repeat streak and cooldown state',
);

/** Effective configuration per conversation (ADR 0055): global < adapter < endpoint < conversation. */
export interface RepeaterConfigResolver {
  configFor(message: unknown): Readonly<RepeaterConfig>;
}

export const repeaterConfigToken = definePluginStore<RepeaterConfigResolver>(
  'zhin.repeater.config',
  'Layered repeater configuration for one message',
);
