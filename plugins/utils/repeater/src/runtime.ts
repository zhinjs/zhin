import { definePluginStore } from 'zhin.js';
import type { RepeaterEngine } from './engine.js';

export const repeaterEngineToken = definePluginStore<RepeaterEngine>(
  'zhin.repeater.engine',
  'Conversation repeat streak and cooldown state',
);
