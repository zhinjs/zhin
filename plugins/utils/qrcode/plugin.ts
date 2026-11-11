import { randomUUID } from 'node:crypto';
import {
  definePlugin,
  definePluginCapabilityGraph,
  definePluginConsoleRpc,
  PluginConsoleRpcError,
  pluginConsoleRpcToken,
  type PluginConsoleRpcInput,
} from 'zhin.js';
import { buildQrDataUrl } from './src/qrcode-lib.js';

export interface QrCodeHistoryItem {
  readonly id: string;
  readonly content: string;
  readonly size: number;
  readonly createdAt: string;
  readonly dataUrl: string;
  readonly [key: string]: string | number;
}

export interface QrCodeConsoleStatus {
  readonly recentCount: number;
  readonly history: readonly QrCodeHistoryItem[];
}

const MAX_HISTORY_ITEMS = 20;

export default definePlugin({
  name: 'qrcode',
  metadata: {
    displayName: 'QR Code',
  },
  capabilityGraph: definePluginCapabilityGraph({
    provides: [pluginConsoleRpcToken],
    features: {
      commands: ['gen', 'scan/[url]'],
      skills: ['qrcode'],
      tools: ['skill/qrcode/qrcode_generate'],
      pages: ['index'],
    },
  }),
  setup() {
    const history: QrCodeHistoryItem[] = [];

    const rpc = definePluginConsoleRpc({
      status: {
        page: 'index',
        demo: true,
        requiredPermissions: ['qrcode:read'],
        handler() {
          return {
            recentCount: history.length,
            history: [...history],
          };
        },
      },
      actions: {
        generate: {
          page: 'index',
          requiredPermissions: ['qrcode:write'],
          async handler(input: PluginConsoleRpcInput) {
            const rawText = typeof input.text === 'string' ? input.text.trim() : '';
            if (!rawText) {
              throw new PluginConsoleRpcError('invalid_input', '请输入要生成二维码的文本内容');
            }
            const rawWidth =
              input.width !== undefined && input.width !== null && input.width !== ''
                ? Number(input.width)
                : 280;
            const width =
              Number.isFinite(rawWidth) && rawWidth >= 64 && rawWidth <= 1024
                ? Math.round(rawWidth)
                : 280;
            const dataUrl = await buildQrDataUrl(rawText, width);
            const entry: QrCodeHistoryItem = {
              id: randomUUID(),
              content: rawText,
              size: width,
              createdAt: new Date().toISOString(),
              dataUrl,
            };
            history.unshift(entry);
            if (history.length > MAX_HISTORY_ITEMS) {
              history.length = MAX_HISTORY_ITEMS;
            }
            return {
              message: '二维码已生成',
              dataUrl,
              text: rawText,
            };
          },
        },
        'clear-history': {
          page: 'index',
          requiredPermissions: ['qrcode:write'],
          handler() {
            history.length = 0;
            return {
              message: '生成记录已清空',
            };
          },
        },
      },
    });

    return {
      consoleRpc: rpc,
    };
  },
});
