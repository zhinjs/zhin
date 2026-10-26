import { messages as t } from '../../../src/i18n.js';
import { createEndpointCommands, endpointConfigurationStoreToken } from 'zhin.js/adapter';
import { defineCommand } from 'zhin.js/command';
import { icqqRuntimeStateToken } from '../../../src/icqq-runtime-state.js';

export const icqqEndpointCommands = createEndpointCommands({
  adapterKey: 'icqq',
  adapterDisplayName: 'ICQQ',
  running: (use) => use(icqqRuntimeStateToken).endpoints.values(),
  describeEntry: (_entry, locale) => t(locale, 'direct'),
  addDescription: '登记 ICQQ endpoint（重启 zhin 生效）',
  addDescriptionI18n: { en: 'Register an ICQQ endpoint; restart zhin to apply' },
  bindFlow: async ({ id, use, locale, formatCommand }) => {
    if (!id) {
      const command = formatCommand?.('icqq endpoint add');
      return command ? t(locale, 'addUsage', { command }) : t(locale, 'uinRequired');
    }
    if (!/^\d+$/.test(id)) {
      return t(locale, 'uinInvalid');
    }
    try {
      const { filePath } = await use(endpointConfigurationStoreToken).add({
        adapterKey: 'icqq',
        entry: { id },
        environment: {},
      });
      return t(locale, 'endpointAdded', { id, file: filePath });
    } catch (error) {
      return t(locale, 'endpointAddFailed', { error: error instanceof Error ? error.message : String(error) });
    }
  },
}, defineCommand);
