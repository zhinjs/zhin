import { definePluginStore } from 'zhin.js';
import type { LedgerService } from './service.js';

export const ledgerServiceStore = definePluginStore<LedgerService>('zhin.ledger.service', 'Personal expense ledger');
export const ledgerServiceToken = ledgerServiceStore;
