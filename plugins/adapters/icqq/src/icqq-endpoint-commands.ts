/**
 * `icqq.endpoint` 命令族：由 @zhin.js/adapter 的 createEndpointCommands 套件生成。
 *
 * ICQQ 的凭据由外部守护进程（@icqqjs/cli）按账号持有（~/.icqq/<uin>/），
 * 其 IPC/RPC 协议是「按 uin 连接 + auth + 账号级 action」，没有 add-account /
 * 触发 login 的 action——扫码登录只能经 `icqq login <uin>` CLI 完成。
 * 因此 add 不走 kv 凭据录入，而是 bindFlow：校验 uin、把 { name: '<uin>' }
 * 追加到 plugins.icqq.endpoints，并引导用户先完成守护进程登录。
 */
import { addEndpointToConfig, createEndpointCommands } from '@zhin.js/adapter';
import { defineCommand } from '@zhin.js/command';
import { icqqRuntimeStateToken } from './icqq-runtime-state.js';

export const icqqEndpointCommands = createEndpointCommands({
  adapterKey: 'icqq',
  adapterDisplayName: 'ICQQ',
  running: (use) => use(icqqRuntimeStateToken).endpoints.values(),
  describeEntry: (entry) => (entry.rpc ? 'rpc（远程守护进程）' : 'ipc（本地守护进程）'),
  addDescription: '登记 ICQQ endpoint（uin 需先经 icqq login 完成扫码登录；重启 zhin 生效）',
  bindFlow: ({ name }) => {
    if (!name) {
      return '用法：icqq.endpoint add <uin>（uin 为纯数字 QQ 号，且需先执行 icqq login <uin> 完成扫码登录）';
    }
    if (!/^\d+$/.test(name)) {
      return 'icqq endpoint 名必须是纯数字 QQ 号（uin）';
    }
    try {
      const filePath = addEndpointToConfig('icqq', { name });
      return (
        `✅ endpoint「${name}」已追加到 ${filePath} 的 plugins.icqq.endpoints。\n` +
        `⚠️ 请确保已执行 icqq login ${name} 启动守护进程并完成扫码登录；重启 zhin 后生效。`
      );
    } catch (error) {
      return `添加失败：${error instanceof Error ? error.message : String(error)}`;
    }
  },
}, defineCommand);
