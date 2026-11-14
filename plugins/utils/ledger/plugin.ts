import {
  databaseHostToken,
  definePlugin,
  definePluginCapabilityGraph,
  outboundHostToken,
  pluginConsoleRpcToken,
} from 'zhin.js';
import { resolveLedgerConfig, type LedgerConfig } from './src/config.js';
import { createLedgerConsoleRpc } from './src/console.js';
import { ledgerServiceStore } from './src/runtime.js';
import { LedgerService } from './src/service.js';
import { defineLedgerTables } from './src/store.js';

export default definePlugin<LedgerConfig>({
  name: 'ledger',
  metadata: { displayName: '记账', displayNameI18n: { 'zh-CN': '记账', en: 'Ledger' } },
  requires: [databaseHostToken],
  capabilityGraph: definePluginCapabilityGraph({
    provides: [ledgerServiceStore, pluginConsoleRpcToken],
    injects: [databaseHostToken, outboundHostToken],
    features: {
      commands: [
        'ledger-add',
        'ledger-delete',
        'ledger-list',
        'ledger-month',
        'ledger-report',
        'ledger-stats',
        'ledger-today',
        'ledger-week',
      ],
      schedules: ['daily-report'],
      skills: ['ledger'],
      tools: [
        'skill/ledger/ledger_add',
        'skill/ledger/ledger_delete',
        'skill/ledger/ledger_list',
        'skill/ledger/ledger_summary',
      ],
      pages: ['index'],
    },
  }),
  setup(context) {
    const config = resolveLedgerConfig(context.config.get());
    const database = context.resources.use(databaseHostToken);
    defineLedgerTables(database);
    const outbound = context.resources.has(outboundHostToken) ? context.resources.use(outboundHostToken) : undefined;
    const service = ledgerServiceStore.provide(context, new LedgerService(database, outbound, config, {
      // ADR 0050 / 0055: switch and `reportWhenEmpty` resolved for each subscriber's private conversation.
      isEnabledFor: target => context.isEnabledFor({ conversation: target }),
      reportWhenEmptyFor: target => context.configFor({ conversation: target }).reportWhenEmpty ?? config.reportWhenEmpty,
    }));
    return {
      consoleRpc: createLedgerConsoleRpc(service),
    };
  },
});
