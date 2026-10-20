import { createToken } from 'zhin.js';
import type { NettoolsService } from './service.js';

/** Owner-scoped nettools service for one plugin instance. */
export const nettoolsServiceToken = createToken<NettoolsService>(
  'zhin.nettools.service',
  'Owner-scoped network tools service',
);
