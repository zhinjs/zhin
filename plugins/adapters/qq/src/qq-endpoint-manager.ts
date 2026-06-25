import type {
  EndpointConfigRecord,
  EndpointManager,
  ProvisionContext,
} from 'zhin.js';
import type { QQAdapter } from './adapter.js';
import type { QQEndpointConfig, ReceiverMode } from './types.js';
import { ReceiverMode as QQReceiverMode } from './types.js';
import { startQqBindFlow } from './qq-bind-flow.js';

const DEFAULT_INTENTS = [
  'GUILDS',
  'GUILD_MEMBERS',
  'GUILD_MESSAGE_REACTIONS',
  'DIRECT_MESSAGE',
  'GROUP_AND_C2C_EVENT',
  'INTERACTION',
  'MESSAGE_AUDIT',
  'AUDIO_ACTION',
  'PUBLIC_GUILD_MESSAGES',
] as const;

function resolveQqEndpointTemplate(root: ProvisionContext['root']): Partial<QQEndpointConfig<ReceiverMode>> {
  const configService = root.inject('config') as { getPrimary?: () => { endpoints?: Array<Record<string, unknown>> } } | undefined;
  const doc = configService?.getPrimary?.();
  const existing = doc?.endpoints?.find((e) => e.context === 'qq');
  if (!existing) {
    return {
      mode: QQReceiverMode.WEBSOCKET,
      sandbox: false,
      timeout: 10_000,
      data_dir: './data',
      intents: [...DEFAULT_INTENTS],
    };
  }
  const { name: _n, appid: _a, secret: _s, context: _c, ...rest } = existing;
  return rest as Partial<QQEndpointConfig<ReceiverMode>>;
}

function readQqConfigs(root: ProvisionContext['root']): EndpointConfigRecord[] {
  const configService = root.inject('config') as { getRaw?: (f: string) => { endpoints?: EndpointConfigRecord[] } ; primaryFile?: string } | undefined;
  if (!configService?.primaryFile || !configService.getRaw) return [];
  const raw = configService.getRaw(configService.primaryFile);
  return (raw?.endpoints ?? []).filter((e) => e.context === 'qq');
}

/** 全局单例：同一时间只允许一个 QQ 扫码绑定 */
let activeStopFlow: (() => void) | null = null;

export class QqEndpointManager implements EndpointManager {
  constructor(private readonly adapter: QQAdapter) {}

  supportsProvision(): boolean {
    return true;
  }

  listEndpoints(): EndpointConfigRecord[] {
    return readQqConfigs(this.adapter.plugin.root);
  }

  cancelProvision(): boolean {
    if (!activeStopFlow) return false;
    activeStopFlow();
    activeStopFlow = null;
    return true;
  }

  async addEndpoint(ctx: ProvisionContext): Promise<EndpointConfigRecord> {
    if (activeStopFlow) {
      throw new Error('已有进行中的 QQ 机器人绑定，请先 /endpoint cancel');
    }

    let endpointName: string | undefined;
    const nameMatch = ctx.message.$raw?.match(/\/endpoint\s+add\s+qq\s+(\S+)/);
    if (nameMatch?.[1]) {
      endpointName = nameMatch[1];
    }

    return new Promise<EndpointConfigRecord>((resolve, reject) => {
      const stopFlow = startQqBindFlow(
        {
          onQrDisplayed: async (url) => {
            await ctx.onStatusUpdate('请用手机 QQ 扫描下方二维码完成机器人绑定（source=zhin）。', {
              qrcode: url,
            });
          },
          onQrExpired: async () => {
            await ctx.onStatusUpdate('二维码已过期，正在刷新，请扫描新二维码…');
          },
          onSuccess: async (credentials) => {
            activeStopFlow = null;
            const [{ appId, appSecret }] = credentials;
            const name = endpointName?.trim() || appId;
            const template = resolveQqEndpointTemplate(ctx.root);
            resolve({
              context: 'qq',
              name,
              appid: appId,
              secret: appSecret,
              ...template,
            } as EndpointConfigRecord);
          },
          onFailure: async (error) => {
            activeStopFlow = null;
            reject(error);
          },
        },
        { source: 'zhin' },
      );
      activeStopFlow = stopFlow;
    });
  }

  async editEndpoint(name: string, ctx: ProvisionContext): Promise<EndpointConfigRecord> {
    const existing = this.listEndpoints().find((e) => e.name === name);
    if (!existing) {
      throw new Error(`配置中不存在 qq/${name}`);
    }
    await ctx.onStatusUpdate(
      `QQ 官方机器人暂不支持在线改凭据，请 /endpoint remove qq ${name} 后重新 /endpoint add qq。`,
    );
    return existing;
  }

  async removeEndpoint(name: string): Promise<boolean> {
    return this.listEndpoints().some((e) => e.name === name);
  }

  async startEndpoint(name: string, ctx: ProvisionContext): Promise<void> {
    if (!this.listEndpoints().some((e) => e.name === name)) {
      throw new Error(`配置中不存在 qq/${name}`);
    }
    await ctx.onStatusUpdate(`正在连接 qq/${name}…`);
  }

  async stopEndpoint(name: string): Promise<boolean> {
    return this.adapter.endpoints.has(name);
  }
}

export function disposeQqEndpointProvision(): void {
  if (activeStopFlow) {
    activeStopFlow();
    activeStopFlow = null;
  }
}
