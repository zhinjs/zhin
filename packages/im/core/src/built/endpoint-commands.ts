/**
 * IM Endpoint 管理与 /endpoints 内省命令（@zhin.js/core）
 */
import { Adapter } from '../adapter.js';
import { MessageCommand } from '../command.js';
import type { CommandFeature } from './command.js';
import type { Message } from '../message.js';
import type { Plugin } from '../plugin.js';
import { MANAGEMENT_OPERATOR_PERMIT } from './management-command-guard.js';
import { createEndpointLifecycleService } from './endpoint-lifecycle-service.js';
import { endpointHelpText, formatEndpointsList, type EndpointRow } from './introspection-format.js';

function collectRuntimeEndpoints(root: Plugin): EndpointRow[] {
  const rows: EndpointRow[] = [];
  for (const adapterName of root.adapters) {
    const adapter = root.inject(adapterName);
    if (!(adapter instanceof Adapter)) continue;
    for (const [endpointId, endpoint] of adapter.endpoints.entries()) {
      rows.push({
        adapter: String(adapterName),
        name: endpointId,
        online: !!(endpoint as { $connected?: boolean }).$connected,
      });
    }
  }
  return rows;
}

export function registerEndpointManagementCommands(
  plugin: Plugin,
  commandService: CommandFeature,
): () => void {
  const root = plugin.root;
  const disposers: (() => void)[] = [];
  const service = () => createEndpointLifecycleService(root);

  const register = (
    pattern: string,
    desc: string,
    handler: (message: Message, match?: { params?: Record<string, unknown> }) => Promise<string> | string,
  ) => {
    const cmd = new MessageCommand(pattern)
      .desc(desc)
      .permit(MANAGEMENT_OPERATOR_PERMIT)
      .action(async (message, match) => {
        try {
          return await handler(message, match);
        } catch (err) {
          return `❌ ${err instanceof Error ? err.message : String(err)}`;
        }
      });
    commandService.add(cmd, plugin.name);
    disposers.push(() => commandService.remove(cmd));
  };

  register('/endpoint help', 'Endpoint 管理帮助', () => endpointHelpText());

  register('/endpoint add [adapter:word]', '添加 Endpoint', async (message, match) => {
    const adapterKey = typeof match?.params?.adapter === 'string' ? match.params.adapter.trim() : '';
    if (!adapterKey) {
      const list = service().listProvisionableAdapters();
      if (list.length === 0) {
        return '当前没有支持运行时添加的适配器（需 EndpointManager 或 endpointConfigSchema）。';
      }
      return [
        '可用适配器：',
        ...list.map((a) => `  • ${a}  — /endpoint add ${a}`),
      ].join('\n');
    }
    const result = await service().add(adapterKey, message);
    return result.message;
  });

  register('/endpoint remove <adapter:word> <name:word>', '从配置移除 Endpoint', async (_message, match) => {
    const adapterKey = String(match?.params?.adapter ?? '');
    const name = String(match?.params?.name ?? '');
    const result = await service().remove(adapterKey, name);
    return result.message;
  });

  register('/endpoint edit <adapter:word> <name:word>', '编辑 Endpoint 配置', async (message, match) => {
    const adapterKey = String(match?.params?.adapter ?? '');
    const name = String(match?.params?.name ?? '');
    const result = await service().edit(adapterKey, name, message);
    return result.message;
  });

  register('/endpoint start <adapter:word> <name:word>', '连接 Endpoint', async (message, match) => {
    const adapterKey = String(match?.params?.adapter ?? '');
    const name = String(match?.params?.name ?? '');
    const result = await service().start(adapterKey, name, message);
    return result.message;
  });

  register('/endpoint stop <adapter:word> <name:word>', '断开 Endpoint（保留配置）', async (_message, match) => {
    const adapterKey = String(match?.params?.adapter ?? '');
    const name = String(match?.params?.name ?? '');
    const result = await service().stop(adapterKey, name);
    return result.message;
  });

  register('/endpoint cancel', '取消进行中的 Endpoint 添加/绑定', () => {
    if (!service().cancelProvision()) {
      return '当前没有进行中的 Endpoint 绑定流程。';
    }
    return '已取消 Endpoint 绑定流程。';
  });

  register('/endpoint sync', '将内存中的 endpoint 配置写回 zhin.config', async () => {
    const result = await service().syncToDisk();
    return result.message;
  });

  register('/endpoints', '列出各适配器下的 Endpoint 及在线状态', () =>
    formatEndpointsList(collectRuntimeEndpoints(root)),
  );

  return () => {
    for (const d of disposers) d();
  };
}
