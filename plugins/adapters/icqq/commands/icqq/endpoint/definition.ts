import { createEndpointCommands, endpointConfigurationStoreToken } from 'zhin.js/adapter';
import { defineCommand } from 'zhin.js/command';
import { icqqRuntimeStateToken } from '../../../src/icqq-runtime-state.js';

export const icqqEndpointCommands = createEndpointCommands({
  adapterKey: 'icqq',
  adapterDisplayName: 'ICQQ',
  running: (use) => use(icqqRuntimeStateToken).endpoints.values(),
  describeEntry: () => 'direct（直连 @icqqjs/icqq）',
  addDescription: '登记 ICQQ endpoint（重启 zhin 生效）',
  bindFlow: async ({ id, use }) => {
    if (!id) {
      return '用法：icqq endpoint add <uin>（uin 为纯数字 QQ 号）';
    }
    if (!/^\d+$/.test(id)) {
      return 'icqq endpoint 名必须是纯数字 QQ 号（uin）';
    }
    try {
      const { filePath } = await use(endpointConfigurationStoreToken).add({
        adapterKey: 'icqq',
        entry: { id },
        environment: {},
      });
      return (
        `✅ endpoint「${id}」已追加到 ${filePath} 的 plugins.icqq.endpoints。\n` +
        `重启 zhin 后生效。`
      );
    } catch (error) {
      return `添加失败：${error instanceof Error ? error.message : String(error)}`;
    }
  },
}, defineCommand);
