import { createToken } from 'zhin.js';
import type { LedgerService } from './service.js';

export const ledgerServiceToken = createToken<LedgerService>('zhin.ledger.service', 'Personal expense ledger');
