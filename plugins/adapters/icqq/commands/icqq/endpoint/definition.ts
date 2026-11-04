import { messages as t } from '../../../src/i18n.js';
import { createEndpointCommands } from 'zhin.js/adapter';
import { defineCommand } from 'zhin.js/command';

export const icqqEndpointCommands = createEndpointCommands({
  adapterKey: 'icqq',
  adapterDisplayName: 'ICQQ',
  describeEntry: (_entry, locale) => t(locale, 'direct'),
  addDescription: '保存 ICQQ 账号；保存后需手动启动',
  addDescriptionI18n: { en: 'Save an ICQQ account; start it explicitly after saving' },
}, defineCommand);
