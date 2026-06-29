import type {
  EndpointConfigRecord,
  EndpointManager,
  ProvisionContext,
} from 'zhin.js';
import type { QQAdapter } from './adapter.js';
import type { QQEndpointConfig, ReceiverMode } from './types.js';
import { ReceiverMode as QQReceiverMode } from './types.js';
import { startQqBindFlow } from './qq-bind-flow.js';
import { persistQqCredentialsToEnv } from './qq-bind-persist.js';

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

function clonePlainConfig<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function resolveQqEndpointTemplate(root: ProvisionContext['root']): Partial<QQEndpointConfig<ReceiverMode>> {
  const configService = root.inject('config') as {
    getRaw?: (f: string) => { endpoints?: Array<Record<string, unknown>> };
    primaryFile?: string;
  } | undefined;
  const raw = configService?.primaryFile && configService.getRaw
    ? configService.getRaw(configService.primaryFile)
    : undefined;
  const existing = raw?.endpoints?.find((e) => e.context === 'qq');
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
  return clonePlainConfig(rest) as Partial<QQEndpointConfig<ReceiverMode>>;
}

function resolveBindOperatorId(
  userOpenId: string | undefined,
  ctx: ProvisionContext,
): string {
  const fromApi = userOpenId?.trim();
  if (fromApi) return fromApi;
  return ctx.message.$sender?.id?.trim() ?? '';
}

function applyBindOwnership(
  template: Partial<QQEndpointConfig<ReceiverMode>>,
  operatorId: string,
): Partial<QQEndpointConfig<ReceiverMode>> {
  const { master: _m, aiAccess, ...rest } = template as Record<string, unknown>;
  if (!operatorId) {
    return rest as Partial<QQEndpointConfig<ReceiverMode>>;
  }
  const prior = aiAccess as {
    mode?: string;
    groups?: string[];
    denyMessage?: string;
  } | undefined;
  return {
    ...rest,
    master: operatorId,
    aiAccess: {
      mode: prior?.mode ?? 'whitelist',
      users: [operatorId],
      groups: Array.isArray(prior?.groups) ? [...prior.groups] : [],
      denyMessage:
        typeof prior?.denyMessage === 'string'
          ? prior.denyMessage
          : '当前用户尚未开放 AI 功能，请联系开启。',
    },
  } as Partial<QQEndpointConfig<ReceiverMode>>;
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
            await ctx.onStatusUpdate('请用手机 QQ 扫描二维码完成机器人绑定。', {
              qrcode: url,
            });
          },
          onQrExpired: async () => {
            await ctx.onStatusUpdate('二维码已过期，正在刷新，请扫描新二维码…');
          },
          onSuccess: async (credentials) => {
            activeStopFlow = null;
            const [{ appId, appSecret, userOpenId }] = credentials;
            const name = endpointName?.trim() || appId;
            await ctx.onStatusUpdate(
              '凭据绑定成功，正在写入配置…',
            );
            const envKeys = persistQqCredentialsToEnv(name, appId, appSecret);
            const template = resolveQqEndpointTemplate(ctx.root);
            const operatorId = resolveBindOperatorId(userOpenId, ctx);
            const owned = applyBindOwnership(template, operatorId);
            resolve({
              context: 'qq',
              name,
              appid: envKeys.appidRef,
              secret: envKeys.secretRef,
              ...owned,
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
