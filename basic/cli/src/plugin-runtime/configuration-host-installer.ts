import { adapterFeatureId, isAdapterIndex, type AdapterIndex } from '@zhin.js/adapter';
import { commandFeatureId, defineCommand, type CommandContext, type CommandParams } from '@zhin.js/command';
import { readOperationSession } from '@zhin.js/feature-kit';
import { createMessages, type Locale } from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import { ConfigChatAccessError, parseConfigurationPath, type ConsoleConfigurationStore } from './console/module.js';
import type { ConfigurationChatAuthorizer } from './sender-enrichment.js';

const messages = createMessages({
  description: { 'zh-CN': '管理可在聊天中安全访问的项目配置', en: 'Manage project configuration that is safe to access in chat' },
  denied: { 'zh-CN': '仅允许真实 Bot 主人在私聊中管理配置。', en: 'Configuration management requires a real Bot owner in a private chat.' },
  sensitive: { 'zh-CN': '敏感配置不能通过聊天读写，请使用本机 CLI。', en: 'Sensitive configuration cannot be read or changed in chat. Use the local CLI.' },
  unknown: { 'zh-CN': '无法证明该配置可安全用于聊天，请使用本机 CLI。', en: 'This configuration is not proven safe for chat. Use the local CLI.' },
  missing: { 'zh-CN': '配置路径不存在。', en: 'The configuration path does not exist.' },
  path: { 'zh-CN': '配置路径格式不正确。', en: 'The configuration path is invalid.' },
  json: { 'zh-CN': '配置值必须是有效 JSON；字符串需要双引号。', en: 'The value must be valid JSON. Strings need double quotes.' },
  unavailable: { 'zh-CN': '当前环境无法确定配置指令的调用方式。', en: 'The configuration command invocation is unavailable in this environment.' },
  unconfirmed: { 'zh-CN': '配置操作结果未确认，请只读检查状态；不会自动重试。', en: 'The configuration outcome is unconfirmed. Check status read-only; no automatic retry is made.' },
  conflict: { 'zh-CN': '配置已被其他操作修改，本次未保存，请重新读取。', en: 'Another operation changed the configuration. This change was not saved; read it again.' },
  invalid: { 'zh-CN': '配置校验失败，本次未保存。', en: 'Configuration validation failed. This change was not saved.' },
  saved: { 'zh-CN': '配置已保存。', en: 'Configuration saved.' },
  pending: { 'zh-CN': '部分配置待重启或等待依赖，保存不代表全部生效。', en: 'Some configuration requires a restart or dependencies. Saving does not mean everything is active.' },
  active: { 'zh-CN': '此文件版本与当前运行配置一致。', en: 'This file revision matches the active configuration.' },
  failed: { 'zh-CN': '存在配置应用失败，请检查运行状态。', en: 'Some configuration failed to apply. Check runtime status.' },
  superseded: { 'zh-CN': '该次申请已被较新修订替代，请重新读取。', en: 'A newer revision superseded this request. Read the current state again.' },
  invalidApplication: { 'zh-CN': '已保存，但配置应用校验失败。', en: 'Saved, but configuration application validation failed.' },
  noEvidence: { 'zh-CN': '当前文件版本尚未确认生效。', en: 'The current file revision has not been confirmed active.' },
  read: { 'zh-CN': '已读取安全配置。', en: 'Safe configuration read.' },
});

type Store = Pick<ConsoleConfigurationStore, 'readChat' | 'patchChat'>;
type ReadResult = Awaited<ReturnType<Store['readChat']>>;

function applicationSummary(result: ReadResult, locale: Locale): string {
  if (result.applicationError === 'unconfirmed') return messages(locale, 'unconfirmed');
  if (result.applicationError === 'superseded') return messages(locale, 'superseded');
  if (result.applicationError === 'invalid') return messages(locale, 'invalidApplication');
  const app = result.application;
  if (!app || app.sourceRevision !== result.revision) return messages(locale, 'noEvidence');
  const states = new Set(app.groups.map(group => group.status));
  if (states.has('unknown')) return messages(locale, 'unconfirmed');
  if (states.has('superseded')) return messages(locale, 'superseded');
  if (states.has('failed')) return messages(locale, 'failed');
  if (states.has('restart-pending') || states.has('blocked')) return messages(locale, 'pending');
  return messages(locale, app.saved && app.generation > 0 ? 'active' : 'noEvidence');
}

/** Host-owned commands; no Agent, model tool, independent apply, or reply side channel. */
export function installConfigurationHost(options: Readonly<{ store: Store; authorize: ConfigurationChatAuthorizer }>): RootResourceInstaller {
  return context => {
    if (!context.hasFeature?.(commandFeatureId)) return;
    const allowed = (command: CommandContext): boolean => {
      const session = readOperationSession(command.input);
      const adapters = command.project<AdapterIndex>(adapterFeatureId);
      return !!session && session.scene.kind === 'private' && isAdapterIndex(adapters) && options.authorize(session, adapters);
    };
    const register = (action: string, params: CommandParams, execute: (command: CommandContext) => Promise<string> | string) => {
      context.addFeature(commandFeatureId, action ? `config/${action}` : 'config', defineCommand({
        description: messages('zh-CN', 'description'), descriptionI18n: { en: messages('en', 'description') },
        permit: ['role(master)', 'private()'], params, options: {},
        execute: async command => {
          try { if (!allowed(command)) return messages(command.locale, 'denied'); }
          catch { return messages(command.locale, 'denied'); }
          try {
            command.signal.throwIfAborted();
            return await execute(command);
          } catch (error) {
            if (command.signal.aborted) throw error;
            if (error instanceof ConfigChatAccessError) return messages(command.locale, error.kind);
            return messages(command.locale, 'unconfirmed');
          }
        },
      }));
    };
    const pathOf = (command: CommandContext): readonly string[] | undefined => {
      try { return parseConfigurationPath(typeof command.params.path === 'string' ? command.params.path : ''); }
      catch { return undefined; }
    };
    register('', {}, command => {
      const lines = ['list', 'get', 'schema', 'status', 'set', 'delete'].map(action => command.formatCommand(`config ${action}`));
      return lines.some(line => line === undefined) ? messages(command.locale, 'unavailable') : lines.join('\n');
    });
    for (const mode of ['get', 'list', 'schema', 'status'] as const) {
      register(mode, mode === 'status' ? {} : { path: { type: 'string', optional: mode !== 'get' } }, async command => {
        const path = pathOf(command);
        if (!path) return messages(command.locale, 'path');
        const result = await options.store.readChat(path, mode);
        if (mode === 'status') return `${applicationSummary(result, command.locale)}\n${JSON.stringify(result, null, 2)}`;
        const value = mode === 'list' ? result.keys : mode === 'schema' ? result.schema : result.value;
        return `${messages(command.locale, 'read')}\n${JSON.stringify(value, null, 2)}`;
      });
    }
    for (const action of ['set', 'delete'] as const) {
      register(action, { path: { type: 'string' }, ...(action === 'set' ? { value: { type: 'text' as const } } : {}) }, async command => {
        const path = pathOf(command);
        if (!path?.length) return messages(command.locale, 'path');
        let value: unknown;
        if (action === 'set') {
          try { value = JSON.parse(String(command.params.value)); }
          catch { return messages(command.locale, 'json'); }
        }
        const before = await options.store.readChat([], 'status');
        command.signal.throwIfAborted();
        const result = await options.store.patchChat({ expectedRevision: before.revision,
          patches: action === 'set' ? [{ op: 'set', path, value }] : [{ op: 'remove', path }] });
        if (result.status === 'conflict') return messages(command.locale, 'conflict');
        if (result.status === 'invalid') return messages(command.locale, 'invalid');
        return `${messages(command.locale, 'saved')} ${applicationSummary(result, command.locale)}`;
      });
    }
  };
}
