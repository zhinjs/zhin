import { formatDisplayPath } from '@zhin.js/logger';
import type { SendContent } from '../types.js';
import { Adapter } from '../adapter.js';
import type { Endpoint } from '../endpoint.js';
import type { Message } from '../message.js';
import type { Plugin } from '../plugin.js';
import { segment } from '../utils.js';
import type { ConfigFeature } from './config.js';
import { connectEndpointInstance, disconnectEndpointInstance } from './connect-endpoint-instance.js';
import type {
  EndpointConfigRecord,
  EndpointManager,
  ProvisionContext,
} from './endpoint-manager.js';
import { adapterSupportsProvision, resolveEndpointManager } from './schema-endpoint-manager.js';

export interface EndpointLifecycleResult {
  message: string;
  config?: EndpointConfigRecord;
}

function getConfigService(root: Plugin): ConfigFeature {
  const configService = root.inject('config') as ConfigFeature | undefined;
  if (!configService?.primaryFile) {
    throw new Error('配置服务不可用');
  }
  const loader = configService.configs.get(configService.primaryFile);
  if (!loader) {
    throw new Error('配置文件未加载');
  }
  return configService;
}

function readAllEndpoints(root: Plugin): EndpointConfigRecord[] {
  const configService = getConfigService(root);
  const raw = configService.getRaw<{ endpoints?: EndpointConfigRecord[] }>(configService.primaryFile);
  return [...(raw?.endpoints ?? [])];
}

function assertUniqueName(
  endpoints: EndpointConfigRecord[],
  context: string,
  name: string,
  replaceIndex?: number,
): void {
  const conflict = endpoints.findIndex(
    (e) => e.context === context && e.name === name,
  );
  if (conflict >= 0 && conflict !== replaceIndex) {
    throw new Error(`zhin.config 中已存在 ${context}/${name}`);
  }
}

function buildProvisionContext(root: Plugin, message: Message): ProvisionContext {
  return {
    message,
    root,
    onStatusUpdate: async (status, extra) => {
      if (message.$reply) {
        let content: SendContent = status;
        if (extra?.qrcode && typeof extra.qrcode === 'string') {
          content = [segment.qrcode(extra.qrcode), segment.text(status)];
        }
        await message.$reply(content);
      }
    },
  };
}

export class EndpointLifecycleService {
  constructor(private readonly root: Plugin) {}

  resolveAdapter(adapterKey: string): Adapter {
    const adapter = this.root.inject(adapterKey);
    if (!(adapter instanceof Adapter)) {
      throw new Error(`适配器 ${adapterKey} 未安装或未就绪`);
    }
    return adapter;
  }

  resolveManager(adapterKey: string): EndpointManager {
    const adapter = this.resolveAdapter(adapterKey);
    const manager = resolveEndpointManager(adapter);
    if (!manager) {
      throw new Error(
        `适配器 ${adapterKey} 不支持运行时 Endpoint 管理（无 EndpointManager 且未声明 endpointConfigSchema）`,
      );
    }
    return manager;
  }

  listProvisionableAdapters(): string[] {
    return this.root.adapters.filter((name) => {
      try {
        const adapter = this.resolveAdapter(String(name));
        return adapterSupportsProvision(adapter);
      } catch {
        return false;
      }
    });
  }

  async persistEndpoints(endpoints: EndpointConfigRecord[]): Promise<void> {
    const configService = getConfigService(this.root);
    const loader = configService.configs.get(configService.primaryFile)!;
    loader.patchKey('endpoints', endpoints);
  }

  /** 将内存中的 endpoints 写回 zhin.config（修复运行时与磁盘不一致） */
  async syncToDisk(): Promise<EndpointLifecycleResult> {
    const configService = getConfigService(this.root);
    const loader = configService.configs.get(configService.primaryFile)!;
    const endpoints = readAllEndpoints(this.root);
    await this.persistEndpoints(endpoints);
    const configPath = formatDisplayPath(loader.resolvedPath);
    const names = endpoints.map((e) => `${e.context}/${e.name}`).join(', ') || '（无）';
    return {
      message: `✅ 已将 ${endpoints.length} 个 endpoint 写入 \`${configPath}\`：${names}`,
    };
  }

  async connectConfig(adapter: Adapter, config: EndpointConfigRecord): Promise<Endpoint> {
    const name = config.name;
    if (adapter.endpoints.has(name)) {
      throw new Error(`Endpoint ${name} 已在线，请先 /endpoint stop ${String(adapter.name)} ${name}`);
    }
    const endpoint = await connectEndpointInstance({
      plugin: this.root,
      adapter,
      config: config as Record<string, unknown>,
    });
    adapter.endpoints.set(endpoint.$id, endpoint as never);
    return endpoint;
  }

  async disconnectRuntime(adapter: Adapter, name: string): Promise<boolean> {
    const endpoint = adapter.endpoints.get(name);
    if (!endpoint) return false;
    if (endpoint.$connected) {
      await disconnectEndpointInstance(this.root, adapter, endpoint);
    }
    adapter.endpoints.delete(name);
    return true;
  }

  async add(adapterKey: string, message: Message, initialReply?: string): Promise<EndpointLifecycleResult> {
    const adapter = this.resolveAdapter(adapterKey);
    const manager = this.resolveManager(adapterKey);
    const ctx = buildProvisionContext(this.root, message);

    const config = await manager.addEndpoint(ctx);
    if (!config.context) config.context = adapterKey;
    if (!config.name?.trim()) {
      throw new Error('Endpoint 名称不能为空');
    }

    const endpoints = readAllEndpoints(this.root);
    try {
      assertUniqueName(endpoints, config.context, config.name);
    } catch (err) {
      if (err instanceof Error && err.message.includes('已存在')) {
        const online = adapter.endpoints.has(config.name);
        const hint = online
          ? '该 Endpoint 已在运行时注册，无需重复扫码；可发 /endpoints 确认。若 zhin.config.yml 未更新，请 /endpoint sync。'
          : '可用 /endpoint start 重试连接，或 /endpoint remove 后重新添加。';
        throw new Error(`${err.message}。${hint}`);
      }
      throw err;
    }
    endpoints.push(config);
    await this.persistEndpoints(endpoints);

    try {
      await this.connectConfig(adapter, config);
    } catch (err) {
      const needsRestart = adapter.getEndpointNeedsRestart?.() ??
        (adapter.constructor as typeof Adapter & { endpointNeedsRestart?: boolean }).endpointNeedsRestart;
      const hint = needsRestart
        ? '配置已写入，请重启进程后连接。'
        : `配置已写入，可用 /endpoint start ${adapterKey} ${config.name} 重试。`;
      throw new Error(
        `${err instanceof Error ? err.message : String(err)}（${hint}）`,
      );
    }

    const prefix = initialReply ? `${initialReply}\n` : '';
    return {
      message:
        `${prefix}✅ 已添加并连接 endpoint \`${config.name}\`（${adapterKey}），已写入 zhin.config。`,
      config,
    };
  }

  async edit(adapterKey: string, name: string, message: Message): Promise<EndpointLifecycleResult> {
    const adapter = this.resolveAdapter(adapterKey);
    const manager = this.resolveManager(adapterKey);
    const endpoints = readAllEndpoints(this.root);
    const index = endpoints.findIndex((e) => e.context === adapterKey && e.name === name);
    if (index < 0) {
      throw new Error(`zhin.config 中不存在 ${adapterKey}/${name}`);
    }

    if (adapter.endpoints.has(name)) {
      await this.disconnectRuntime(adapter, name);
    }

    const ctx = buildProvisionContext(this.root, message);
    const updated = await manager.editEndpoint(name, ctx);
    updated.context = adapterKey;
    updated.name = name;
    endpoints[index] = updated;
    await this.persistEndpoints(endpoints);

    try {
      await this.connectConfig(adapter, updated);
    } catch (err) {
      throw new Error(
        `配置已更新，但连接失败：${err instanceof Error ? err.message : String(err)}。` +
          `可用 /endpoint start ${adapterKey} ${name} 重试。`,
      );
    }

    return {
      message: `✅ 已更新并连接 endpoint \`${name}\`（${adapterKey}）。`,
      config: updated,
    };
  }

  async remove(adapterKey: string, name: string): Promise<EndpointLifecycleResult> {
    const adapter = this.resolveAdapter(adapterKey);
    const manager = this.resolveManager(adapterKey);

    await this.stop(adapterKey, name);

    const ok = await manager.removeEndpoint(name);
    if (!ok) {
      throw new Error(`无法移除 ${adapterKey}/${name}`);
    }

    const endpoints = readAllEndpoints(this.root);
    const next = endpoints.filter((e) => !(e.context === adapterKey && e.name === name));
    if (next.length === endpoints.length) {
      throw new Error(`zhin.config 中不存在 ${adapterKey}/${name}`);
    }
    await this.persistEndpoints(next);

    return { message: `✅ 已从配置移除 endpoint \`${name}\`（${adapterKey}）。` };
  }

  async start(adapterKey: string, name: string, message: Message): Promise<EndpointLifecycleResult> {
    const adapter = this.resolveAdapter(adapterKey);
    const manager = this.resolveManager(adapterKey);
    const endpoints = readAllEndpoints(this.root);
    const config = endpoints.find((e) => e.context === adapterKey && e.name === name);
    if (!config) {
      throw new Error(`zhin.config 中不存在 ${adapterKey}/${name}`);
    }
    if (adapter.endpoints.has(name)) {
      return { message: `Endpoint ${adapterKey}/${name} 已在线。` };
    }

    const ctx = buildProvisionContext(this.root, message);
    await manager.startEndpoint(name, ctx);
    await this.connectConfig(adapter, config);

    return { message: `✅ 已连接 endpoint \`${name}\`（${adapterKey}）。`, config };
  }

  async stop(adapterKey: string, name: string): Promise<EndpointLifecycleResult> {
    const adapter = this.resolveAdapter(adapterKey);
    const manager = this.resolveManager(adapterKey);
    const stopped = await this.disconnectRuntime(adapter, name);
    await manager.stopEndpoint(name);
    if (!stopped) {
      return { message: `Endpoint ${adapterKey}/${name} 当前未在线。` };
    }
    return { message: `✅ 已断开 endpoint \`${name}\`（${adapterKey}），配置仍保留。` };
  }

  cancelProvision(): boolean {
    for (const adapterName of this.root.adapters) {
      const adapter = this.root.inject(adapterName);
      if (!(adapter instanceof Adapter)) continue;
      const manager = resolveEndpointManager(adapter);
      if (manager?.cancelProvision?.()) return true;
    }
    return false;
  }
}

export function createEndpointLifecycleService(root: Plugin): EndpointLifecycleService {
  return new EndpointLifecycleService(root);
}
