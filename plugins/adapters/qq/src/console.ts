/**
 * QQ Console RPC：除通用 endpoint 管理外，把 `qq endpoint add` 的扫码绑定
 * （以及公域 / 私域选择、取消）搬到 Console 页面。
 */
import {
  prepareConsoleAdapterMutation,
  ownedConsoleAdapter,
  createAdapterConsoleRpc,
  type AdapterConsoleSpec,
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
  getConfig: () => unknown,
): PluginConsoleRpc {
  const spec: AdapterConsoleSpec = {
    ...qqConsoleSpec,
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
      if (state.consoleBind?.pending) return ['qq-bind-kind', 'qq-bind-cancel'];
      if (state.bindFlow || state.consoleBind?.state === 'waiting') return ['qq-bind-cancel'];
      return ['qq-bind-start'];
    },
    actions: {
      'qq-bind-start': {
        label: '扫码绑定新机器人',
        labelI18n: { en: 'Bind a bot with QR' },
        description: '用手机 QQ 扫码，选择公域 / 私域后保存到账号库；保存后需手动启动。',
        descriptionI18n: { en: 'Scan with mobile QQ, choose public/private and save the account; start it explicitly afterwards.' },
        handler: async (input, call) => {
          if (!call.runtime) throw new PluginConsoleRpcError('unsupported', '账号运行目录不可用');
          const adapter = ownedConsoleAdapter(spec, call);
          if (!adapter.canManage) throw new PluginConsoleRpcError('unsupported', '此环境未提供持久化账号管理');
          if (input.expectedGeneration !== call.runtime.generation || input.expectedRevision !== adapter.revision) {
            throw new PluginConsoleRpcError('conflict', '账号清单已变化，请刷新核实');
          }
          const starting = startQqConsoleBind(state);
          state.consoleAdmission = { adapterId: adapter.descriptor.id, generation: call.runtime.generation, revision: adapter.revision };
          const { url } = await starting;
          return { message: '请用手机 QQ 扫码；扫码成功后选择公域或私域', url };
        },
      },
      'qq-bind-kind': {
        accountMutation: true,
        label: '选择公域 / 私域',
        labelI18n: { en: 'Choose public/private' },
        description: '公域订阅 PUBLIC_GUILD_MESSAGES；私域订阅 GUILD_MESSAGES。',
        descriptionI18n: { en: 'Public subscribes PUBLIC_GUILD_MESSAGES; private subscribes GUILD_MESSAGES.' },
        options: [
          { value: 'public', label: '公域', labelI18n: { en: 'Public' } },
          { value: 'private', label: '私域', labelI18n: { en: 'Private' } },
        ],
        handler: async (input, call) => {
          const captured = state.consoleAdmission;
          if (!captured || captured.generation !== input.expectedGeneration || captured.revision !== input.expectedRevision) {
            throw new PluginConsoleRpcError('conflict', '扫码期间账号清单已变化，请刷新核实');
          }
          const admission = prepareConsoleAdapterMutation(spec, call, input);
          if (admission.adapter.descriptor.id !== captured.adapterId) throw new PluginConsoleRpcError('conflict', '扫码所属 Adapter 已变化');
          const result = await completeQqConsoleBind(state, config => admission.adapter.add(admission.revision,
            { endpointId: config.id, config: { ...config } }, admission.options), input.value);
          return {
            message: `已保存账号「${result.endpointId}」（${result.botKind}），尚未启动`,
            saved: true, restartRequired: false, execution: { ...result.mutation.execution },
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
  return createAdapterConsoleRpc(spec);
}
