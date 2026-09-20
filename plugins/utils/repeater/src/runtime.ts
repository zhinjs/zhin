import { createToken } from 'zhin.js';
import type { RepeaterEngine } from './engine.js';

export const repeaterEngineToken = createToken<RepeaterEngine>(
  'zhin.repeater.engine',
  'Generation-owned Repeater engine',
);
