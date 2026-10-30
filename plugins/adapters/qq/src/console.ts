/**
 * QQ Console RPC：除通用 endpoint 管理外，把 `qq endpoint add` 的扫码绑定
 * （以及公域 / 私域选择、取消）搬到 Console 页面。
 */
import {
  endpointConfigurationStoreToken,
  createAdapterConsoleRpc,
  type AdapterConsoleResources,
  type AdapterConsoleSpec,
  type EndpointConfigurationStore,
} from 'zhin.js/adapter';
import { PluginConsoleRpcError, type PluginConsoleRpc } from 'zhin.js';
import { qqConsoleSpec } from './qq-console-spec.js';
import {
  cancelQqConsoleBind,
  completeQqConsoleBind,
  startQqConsoleBind,
} from './qq-console.js';
import type { QqRuntimeState } from './qq-runtime-state.js';

export function createQqConsoleRpc(
  state: QqRuntimeState,
  resources: AdapterConsoleResources,
  getConfig: () => unknown,
): PluginConsoleRpc {
  const store: EndpointConfigurationStore | undefined = resources.has(endpointConfigurationStoreToken)
    ? resources.use(endpointConfigurationStoreToken)
    : undefined;

  const spec: AdapterConsoleSpec = {
    ...qqConsoleSpec,
    running: () => state.endpoints.values(),
    getConfig,
    extraStatus: () => {
      const bind = state.consoleBind;
      if (!bind) {
        return { bindState: state.bindFlow ? 'binding' : 'idle' };
      }
      return {
        bindState: bind.state,
        ...(bind.url ? { scanUrl: bind.url } : {}),
        ...(bind.message ? { bindMessage: bind.message } : {}),
        ...(bind.pending ? { bindEndpoint: bind.pending.endpointId } : {}),
        ...(bind.error ? { bindError: bind.error } : {}),
      };
    },
    availableActions: () => {
      if (!store) return [];
      if (state.consoleBind?.pending) return ['qq-bind-kind', 'qq-bind-cancel'];
      if (state.bindFlow || state.consoleBind?.state === 'waiting') return ['qq-bind-cancel'];
      return ['qq-bind-start'];
    },
    actions: {
      'qq-bind-start': {
        label: '扫码绑定新机器人',
        labelI18n: { en: 'Bind a bot with QR' },
        description: '用手机 QQ 扫码，成功后选择公域 / 私域，再一次性写入 .env 与配置。',
        descriptionI18n: { en: 'Scan with mobile QQ, choose public/private, then save credentials to .env and the config.' },
        handler: async () => {
          if (!store) throw new PluginConsoleRpcError('unsupported', '当前运行环境不支持写入 endpoint 配置');
          const { url } = await startQqConsoleBind(state);
          return { message: '请用手机 QQ 扫码；扫码成功后选择公域或私域', url };
        },
      },
      'qq-bind-kind': {
        label: '选择公域 / 私域',
        labelI18n: { en: 'Choose public/private' },
        description: '公域订阅 PUBLIC_GUILD_MESSAGES；私域订阅 GUILD_MESSAGES。',
        descriptionI18n: { en: 'Public subscribes PUBLIC_GUILD_MESSAGES; private subscribes GUILD_MESSAGES.' },
        options: [
          { value: 'public', label: '公域', labelI18n: { en: 'Public' } },
          { value: 'private', label: '私域', labelI18n: { en: 'Private' } },
        ],
        handler: async (input) => {
          if (!store) throw new PluginConsoleRpcError('unsupported', '当前运行环境不支持写入 endpoint 配置');
          const result = await completeQqConsoleBind(state, store, input.value);
          return {
            message: `已写入 endpoint「${result.endpointId}」（${result.botKind}），重启或热重载后生效`,
            details: { endpoint: result.endpointId, botKind: result.botKind, intents: result.intents.join(', ') },
          };
        },
      },
      'qq-bind-cancel': {
        label: '取消扫码绑定',
        labelI18n: { en: 'Cancel QR binding' },
        description: '中止正在进行的扫码绑定；已写入的配置不会删除。',
        descriptionI18n: { en: 'Stop the current QR binding flow; already-saved configuration is untouched.' },
        handler: async () => {
          const cancelled = cancelQqConsoleBind(state);
          return { message: cancelled ? '已取消绑定' : '当前没有进行中的绑定流程' };
        },
      },
    },
  };
  return createAdapterConsoleRpc(spec, resources);
}
