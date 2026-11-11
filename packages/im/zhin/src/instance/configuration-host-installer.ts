import { adapterFeatureId, isAdapterIndex, type AdapterIndex } from '@zhin.js/adapter';
import { commandFeatureId, defineCommand, type CommandContext, type CommandParams } from '@zhin.js/command';
import type { ConsoleConfigApplicationStatus } from '@zhin.js/console-protocol';
import { readOperationSession } from '@zhin.js/feature-kit';
import { createMessages, type Locale } from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import { ConfigChatAccessError, ConfigChatRequestRejectedError, parseConfigurationPath, formatConfigurationPath, type ConsoleConfigurationStore } from './console/module.js';
import type { ConfigurationChatAuthorizer } from '@zhin.js/core/runtime';

const messages = createMessages({
  description: { 'zh-CN': '管理可在聊天中安全访问的项目配置', en: 'Manage project configuration that is safe to access in chat' },
  fieldsDescription: { 'zh-CN': '列出聊天可管理的配置字段与类型（不含值）', en: 'List chat-manageable configuration fields and types (no values)' },
  getDescription: { 'zh-CN': '读取一个聊天可管理的配置字段', en: 'Read one chat-manageable configuration field' },
  setDescription: { 'zh-CN': '修改一个聊天可管理的配置字段', en: 'Change one chat-manageable configuration field' },
  unsetDescription: { 'zh-CN': '删除一个可选的聊天可管理配置字段', en: 'Remove one optional chat-manageable configuration field' },
  denied: { 'zh-CN': '仅允许真实 Bot 主人在私聊中管理配置。', en: 'Configuration management requires a real Bot owner in a private chat.' },
  sensitive: { 'zh-CN': '敏感配置不能通过聊天读写，请使用本机 CLI。', en: 'Sensitive configuration cannot be read or changed in chat. Use the local CLI.' },
  permission: { 'zh-CN': '主人、信任名单与审批等权限配置不能通过聊天读写，请使用本机 CLI。', en: 'Owner, trust and approval settings cannot be read or changed in chat. Use the local CLI.' },
  scope: { 'zh-CN': '该配置不在聊天可管理范围内，请使用本机 CLI。', en: 'This configuration is outside the chat-manageable scope. Use the local CLI.' },
  leaf: { 'zh-CN': '聊天只能读写单个字段（标量或标量数组），不能整体覆盖或删除对象。', en: 'Chat can only read or change a single field (a scalar or scalar array), never a whole object.' },
  required: { 'zh-CN': '必填字段不能通过聊天删除。', en: 'A required field cannot be removed in chat.' },
  unknown: { 'zh-CN': '无法证明该配置可安全用于聊天，请使用本机 CLI。', en: 'This configuration is not proven safe for chat. Use the local CLI.' },
  missing: { 'zh-CN': '配置路径不存在。', en: 'The configuration path does not exist.' },
  path: { 'zh-CN': '配置路径格式不正确。', en: 'The configuration path is invalid.' },
  value: { 'zh-CN': '配置值与字段类型不符，期望：', en: 'The value does not match the field type. Expected: ' },
  noFields: { 'zh-CN': '没有可在聊天中管理的配置字段。', en: 'No configuration fields can be managed in chat.' },
  unavailable: { 'zh-CN': '当前环境无法确定配置指令的调用方式。', en: 'The configuration command invocation is unavailable in this environment.' },
  unconfirmed: { 'zh-CN': '配置操作结果未确认，请勿重复发送，先只读核对当前值；不会自动重试。', en: 'The configuration outcome is unconfirmed. Do not resend; check the current value read-only first. No automatic retry is made.' },
  rejected: { 'zh-CN': '配置操作在保存前失败，本次未保存。', en: 'The configuration request failed before saving. This change was not saved.' },
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
type Saved = ConsoleConfigApplicationStatus & { readonly revision: string };

function applicationSummary(result: Saved, locale: Locale): string {
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

function valueType(value: unknown): string {
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
}

/**
 * Leaf-typed value parsing: JSON when it yields an allowed leaf type, otherwise the raw
 * text for string leaves. Objects are never accepted (C4 leaf-only).
 */
export function parseChatConfigurationValue(text: string, types: readonly string[]): { readonly value: unknown } | undefined {
  const allowed = (value: unknown) => {
    const type = valueType(value);
    if (type === 'object') return false;
    if (type === 'number') return types.includes('number') || types.includes('integer') && Number.isInteger(value);
    return types.includes(type);
  };
  try {
    const parsed: unknown = JSON.parse(text);
    if (allowed(parsed)) return { value: parsed };
  } catch { /* fall through to a raw string */ }
  return types.includes('string') ? { value: text } : undefined;
}

/**
 * Host-owned `config fields|get|set|unset` (alias `配置`); no Agent, model tool,
 * whole-document apply, or reply side channel. Only a private chat from a master of
 * any configured endpoint on the receiving Adapter passes (C2, see
 * `createConfigurationChatAuthorizer`); every read/write is limited by the chat field
 * policy (C3/C4). The declarative permit is `private()` only: the sender's `master`
 * role is projected for the receiving endpoint alone, so the authorizer is the
 * authoritative owner check.
 */
export function installConfigurationHost(options: Readonly<{ store: Store; authorize: ConfigurationChatAuthorizer }>): RootResourceInstaller {
  return context => {
    if (!context.hasFeature?.(commandFeatureId)) return;
    const allowed = (command: CommandContext): boolean => {
      const session = readOperationSession(command.input);
      const adapters = command.project<AdapterIndex>(adapterFeatureId);
      return !!session && session.scene.kind === 'private' && isAdapterIndex(adapters) && options.authorize(session, adapters);
    };
    const register = (action: '' | 'fields' | 'get' | 'set' | 'unset', params: CommandParams, execute: (command: CommandContext) => Promise<string> | string) => {
      const description = action ? `${action}Description` as const : 'description';
      context.addFeature(commandFeatureId, action ? `config/${action}` : 'config', defineCommand({
        description: messages('zh-CN', description), descriptionI18n: { en: messages('en', description) },
        alias: [action ? `配置 ${action}` : '配置'],
        permit: ['private()'], params, options: {},
        execute: async command => {
          try { if (!allowed(command)) return messages(command.locale, 'denied'); }
          catch { return messages(command.locale, 'denied'); }
          try {
            command.signal.throwIfAborted();
            return await execute(command);
          } catch (error) {
            if (command.signal.aborted) throw error;
            if (error instanceof ConfigChatAccessError) return messages(command.locale, error.kind);
            if (error instanceof ConfigChatRequestRejectedError) return messages(command.locale, 'rejected');
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
      const lines = ['fields', 'get', 'set', 'unset'].map(action => command.formatCommand(`config ${action}`));
      return lines.some(line => line === undefined) ? messages(command.locale, 'unavailable') : lines.join('\n');
    });
    register('fields', { path: { type: 'string', optional: true } }, async command => {
      const path = pathOf(command);
      if (!path) return messages(command.locale, 'path');
      const { fields = [] } = await options.store.readChat(path, 'fields');
      if (!fields.length) return messages(command.locale, 'noFields');
      const lines = fields.flatMap(field => {
        const path = formatConfigurationPath(field.path);
        if (path === undefined) return [];
        const token = /^-|[\s"'\\]/u.test(path) ? JSON.stringify(path) : path;
        return [`${token}: ${field.type.join(' | ')}`];
      });
      return lines.length ? lines.join('\n') : messages(command.locale, 'noFields');
    });
    register('get', { path: { type: 'string' } }, async command => {
      const path = pathOf(command);
      if (!path?.length) return messages(command.locale, 'path');
      const result = await options.store.readChat(path, 'get');
      return `${messages(command.locale, 'read')}\n${JSON.stringify(result.value, null, 2)}`;
    });
    const write = async (command: CommandContext, action: 'set' | 'unset') => {
      const path = pathOf(command);
      if (!path?.length) return messages(command.locale, 'path');
      // Resolve the exact leaf first: denied paths stop here with their fixed reason,
      // its revision is this write's CAS base and its type drives value parsing.
      const same = (entry: { readonly path: readonly string[] }) => entry.path.length === path.length && entry.path.every((segment, index) => segment === path[index]);
      const leaf = await options.store.readChat(path, 'fields');
      const field = leaf.fields?.find(same);
      if (!field) return messages(command.locale, 'leaf');
      // Exact fields discovery proves properties-only ancestry independently of
      // the display limit. The Store rechecks scope/schema and this revision at CAS.
      let value: unknown;
      if (action === 'set') {
        const parsed = parseChatConfigurationValue(String(command.params.value ?? ''), field.type);
        if (!parsed) return `${messages(command.locale, 'value')}${field.type.join(' | ')}`;
        value = parsed.value;
      }
      command.signal.throwIfAborted();
      const result = await options.store.patchChat({ expectedRevision: leaf.revision,
        patches: action === 'set' ? [{ op: 'set', path, value }] : [{ op: 'remove', path }] });
      if (result.status === 'conflict') return messages(command.locale, 'conflict');
      if (result.status === 'invalid') return messages(command.locale, 'invalid');
      return `${messages(command.locale, 'saved')} ${applicationSummary(result, command.locale)}`;
    };
    register('set', { path: { type: 'string' }, value: { type: 'text' } }, command => write(command, 'set'));
    register('unset', { path: { type: 'string' } }, command => write(command, 'unset'));
  };
}
