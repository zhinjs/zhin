import { databaseHostToken, definePlugin, outboundHostToken } from 'zhin.js';
import { resolveLedgerConfig, type LedgerConfig } from './src/config.js';
import { ledgerServiceToken } from './src/runtime.js';
import { LedgerService } from './src/service.js';
import { defineLedgerTables } from './src/store.js';

export default definePlugin<LedgerConfig>({
  name: 'ledger',
  metadata: { displayName: '记账' },
  requires: [databaseHostToken],
  setup(context) {
    const config = resolveLedgerConfig(context.config.get());
    const database = context.resources.use(databaseHostToken);
    defineLedgerTables(database);
    const outbound = context.resources.has(outboundHostToken) ? context.resources.use(outboundHostToken) : undefined;
    const service = new LedgerService(database, outbound, config);
    context.resources.provide(ledgerServiceToken, service);
  },
});
