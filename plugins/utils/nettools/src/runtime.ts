import { definePluginStore } from 'zhin.js';
import type { NettoolsService } from './service.js';

/** Owner-scoped nettools service for one plugin instance. */
export const nettoolsServiceStore = definePluginStore<NettoolsService>(
  'zhin.nettools.service',
  'Owner-scoped network tools service',
);
export const nettoolsServiceToken = nettoolsServiceStore;
