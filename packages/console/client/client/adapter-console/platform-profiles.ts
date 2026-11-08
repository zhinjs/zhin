import type { AdapterConsoleLocale } from './messages.js';
import type { AdapterConsoleFieldOptionView, AdapterConsoleFieldView } from './types.js';

export interface PlatformConnectionMode {
  readonly key: string;
  readonly label: string;
  readonly labelEn?: string;
  readonly badge?: string;
  readonly description: string;
  readonly descriptionEn?: string;
  /** Preset field values applied when switching to this connection mode. */
  readonly presetValues: Readonly<Record<string, string>>;
  /** Keys of fields that are primary/highlighted in this mode. */
  readonly primaryFields?: readonly string[];
  /** Live callback URL template (e.g. `ws://{host}{path}` or `https://{origin}{webhookPath}`). */
  readonly callbackUrlTemplate?: {
    readonly protocol: 'ws' | 'http';
    readonly pathField: string;
    readonly fallbackPath: string;
    readonly label: string;
  };
}

export interface PlatformOnboardingPreset {
  readonly key: string;
  readonly label: string;
  readonly labelEn?: string;
  readonly badge?: string;
  readonly description?: string;
  readonly values: Readonly<Record<string, string>>;
}

export interface PlatformFieldOverride {
  readonly label: string;
  readonly labelEn?: string;
  readonly placeholder?: string;
  readonly hint?: string;
  readonly group?: string;
  readonly options?: readonly AdapterConsoleFieldOptionView[];
}

export interface PlatformAdapterProfile {
  readonly adapterKey: string;
  readonly categoryBadge: string;
  readonly categoryBadgeEn?: string;
  readonly brandMark: string;
  readonly accentColor?: string;
  readonly idLabel?: string;
  readonly idPlaceholder?: string;
  readonly onboardingTitle?: string;
  readonly onboardingSteps: readonly string[];
  readonly connectionModes?: readonly PlatformConnectionMode[];
  readonly presets?: readonly PlatformOnboardingPreset[];
  readonly fieldOverrides?: Readonly<Record<string, PlatformFieldOverride>>;
  readonly supportsEmailSync?: boolean;
  readonly supportsQqOfficialWorkbench?: boolean;
}

export const PLATFORM_PROFILES: Readonly<Record<string, PlatformAdapterProfile>> = {
  icqq: {
    adapterKey: 'icqq',
    categoryBadge: 'QQ 协议端 (ICQQ / QQNT)',
    categoryBadgeEn: 'QQ Protocol (ICQQ / QQNT)',
    brandMark: 'QQ',
    idLabel: 'QQ 号码 (UIN)',
    idPlaceholder: '例如 123456789',
    onboardingTitle: 'QQ 协议端登录与签名配置向导',
    onboardingSteps: [
      '1. 选择协议预设（推荐 iPad 协议 + QQNT 或 Android 手表协议），填写 QQ 号码',
      '2. 填写连接配置（扫码免密登录可将密码留空）',
      '3. 在上方「安全验证工作台」使用手机 QQ 扫码或提交滑块 Ticket / 短信验证码',
    ],
    connectionModes: [
      {
        key: 'qrcode',
        label: '扫码免密登录 · 推荐',
        labelEn: 'QR Code Login (Recommended)',
        badge: '免密扫码',
        description: '启动账号后直接用手机 QQ 扫描工作台二维码确认登录，密码可留空。',
        presetValues: { platform: '5', qqnt: 'true', ntLogin: 'true', autoReconnect: 'true', autoServer: 'true' },
        primaryFields: ['platform', 'signApiAddr', 'qqnt', 'ntLogin'],
      },
      {
        key: 'password',
        label: '密码 + 滑块/短信辅助登录',
        labelEn: 'Password + Slider/SMS Login',
        badge: '账密登录',
        description: '使用 QQ 登录密码配合 QSign 签名服务登录，首次异地登录在工作台完成滑块或设备锁验证。',
        presetValues: { platform: '5', qqnt: 'true', autoReconnect: 'true', autoServer: 'true' },
        primaryFields: ['password', 'platform', 'signApiAddr', 'ver'],
      },
    ],
    presets: [
      {
        key: 'ipad-qqnt',
        label: 'iPad 协议 + QQNT (推荐)',
        badge: '稳定首选',
        description: 'platform=5, 开启 QQNT 与 ntLogin',
        values: { platform: '5', qqnt: 'true', ntLogin: 'true', autoReconnect: 'true', autoServer: 'true' },
      },
      {
        key: 'watch',
        label: 'Android 手表协议 (轻量免滑块)',
        badge: '轻量',
        description: 'platform=3, 适合扫码快速登录',
        values: { platform: '3', qqnt: 'false', ntLogin: 'false', autoReconnect: 'true', autoServer: 'true' },
      },
      {
        key: 'macos',
        label: 'macOS 桌面协议',
        description: 'platform=4, macOS QQNT 协议',
        values: { platform: '4', qqnt: 'true', autoReconnect: 'true', autoServer: 'true' },
      },
      {
        key: 'android',
        label: 'Android 手机协议',
        description: 'platform=1, 需稳定 QSign 签名地址',
        values: { platform: '1', autoReconnect: 'true', autoServer: 'true' },
      },
    ],
    fieldOverrides: {
      password: {
        label: 'QQ 登录密码（扫码登录可留空）',
        placeholder: '留空则默认走手机 QQ 扫码登录',
        group: '登录与协议',
      },
      platform: {
        label: '登录设备协议 (platform)',
        group: '登录与协议',
        options: [
          { value: '5', label: '5: iPad 平板 (推荐)' },
          { value: '3', label: '3: Android 手表' },
          { value: '4', label: '4: macOS 桌面' },
          { value: '1', label: '1: Android 手机' },
          { value: '2', label: '2: aPad 平板' },
          { value: '6', label: '6: Android Pad' },
        ],
      },
      signApiAddr: {
        label: 'QSign 签名服务地址 (signApiAddr)',
        placeholder: 'https://your-qsign.example.com/sign?key=...',
        group: '签名与会话存储',
      },
      ver: {
        label: '协议版本号 (ver)',
        placeholder: '例如 9.0.90（留空自动匹配）',
        group: '签名与会话存储',
      },
      dataDir: {
        label: '设备与 Token 缓存目录 (dataDir)',
        placeholder: './data/icqq',
        group: '签名与会话存储',
      },
      qqnt: { label: '启用 QQNT 核心 (qqnt)', group: '登录与协议' },
      ntLogin: { label: '启用 NT 登录流程 (ntLogin)', group: '登录与协议' },
      autoReconnect: { label: '断线自动重连 (autoReconnect)', group: '登录与协议' },
      autoServer: { label: '自动优选 MSF 服务器 (autoServer)', group: '登录与协议' },
    },
  },

  qq: {
    adapterKey: 'qq',
    categoryBadge: '腾讯官方开放平台',
    categoryBadgeEn: 'Tencent Official Open Platform',
    brandMark: '企Q',
    idLabel: '机器人账号标识 / AppID',
    idPlaceholder: '例如 102030405',
    onboardingTitle: 'QQ 官方机器人双轨接入工作台',
    onboardingSteps: [
      '方式 A（极速扫码）：直接点击「手机 QQ 扫码一键创建/绑定」，扫码后选择「公域机器人」或「私域机器人」即可自动落盘并启动',
      '方式 B（手动凭证）：填写开放平台 AppID 与 AppSecret，推荐使用 WebSocket 长连接模式（无需公网域名）',
    ],
    supportsQqOfficialWorkbench: true,
    connectionModes: [
      {
        key: 'websocket',
        label: 'WebSocket 长连接 · 推荐',
        badge: '免公网',
        description: '主动连接 QQ 官方网关，无需配置公网 Webhook 与 SSL 证书。',
        presetValues: { mode: 'websocket', botKind: 'public', sandbox: 'false', streaming: 'true' },
        primaryFields: ['appid', 'secret', 'mode', 'botKind', 'sandbox', 'streaming'],
      },
      {
        key: 'sandbox',
        label: '沙箱测试环境 (Sandbox)',
        badge: '开发调试',
        description: '连接官方沙箱测试频道与测试群，适合开发阶段验证指令。',
        presetValues: { mode: 'websocket', botKind: 'private', sandbox: 'true', streaming: 'true' },
        primaryFields: ['appid', 'secret', 'sandbox', 'botKind'],
      },
      {
        key: 'webhook',
        label: 'Webhook 公网回调模式',
        badge: '公网回调',
        description: '通过 HTTP Webhook 接收事件推送，需公网 HTTPS 地址。',
        presetValues: { mode: 'webhook', webhookPath: '/qq/webhook', botKind: 'public', sandbox: 'false' },
        primaryFields: ['appid', 'secret', 'mode', 'webhookPath', 'botKind'],
        callbackUrlTemplate: {
          protocol: 'http',
          pathField: 'webhookPath',
          fallbackPath: '/qq/webhook',
          label: 'QQ 开放平台 Webhook 回调地址',
        },
      },
    ],
    fieldOverrides: {
      appid: { label: '机器人 AppID', placeholder: '例如 102030405', group: '开放平台凭证' },
      secret: { label: '机器人 AppSecret', placeholder: '开放平台生成的 Client Secret', group: '开放平台凭证' },
      token: { label: '机器人 Token (可选)', placeholder: '开放平台 Token', group: '开放平台凭证' },
      mode: {
        label: '连接模式 (mode)',
        group: '连接与事件订阅',
        options: [
          { value: 'websocket', label: 'websocket (WebSocket 长连接 · 推荐)' },
          { value: 'webhook', label: 'webhook (HTTP Webhook 回调)' },
          { value: 'middleware', label: 'middleware (中间件挂载)' },
        ],
      },
      botKind: {
        label: '机器人类型 (botKind)',
        group: '连接与事件订阅',
        options: [
          { value: 'public', label: 'public (公域机器人 · 群/C2C/公域频道)' },
          { value: 'private', label: 'private (私域机器人 · 全量频道事件)' },
        ],
      },
      sandbox: { label: '启用沙箱环境 (sandbox)', group: '连接与事件订阅' },
      streaming: { label: '启用流式消息回复 (streaming)', group: '连接与事件订阅' },
      webhookPath: { label: 'Webhook 回调路径 (webhookPath)', placeholder: '/qq/webhook', group: '连接与事件订阅' },
    },
  },

  napcat: {
    adapterKey: 'napcat',
    categoryBadge: 'OneBot 11 / NapCat 协议端',
    categoryBadgeEn: 'OneBot 11 / NapCat Protocol',
    brandMark: 'NC',
    idLabel: 'NapCat 节点标识 / QQ 号',
    idPlaceholder: '例如 napcat-main 或 QQ 号',
    onboardingTitle: 'NapCat 连接模式与 Access Token 配置',
    onboardingSteps: [
      '1. 选择与 NapCat WebUI 对应的网络模式（正向 WS / 反向 WS / HTTP）',
      '2. 若使用反向 WS，复制下方生成的回调地址填入 NapCat WebUI 的「反向 WebSocket 地址」',
      '3. 确保两边 Access Token 完全一致（可点击「🎲 生成随机密钥」一键生成）',
    ],
    connectionModes: [
      {
        key: 'ws',
        label: '正向 WebSocket · Zhin 主动连 NapCat',
        badge: '正向 WS',
        description: 'NapCat 开启 WebSocket Server（默认 3001 端口），Zhin 主动发起连接。',
        presetValues: { url: 'ws://127.0.0.1:3001', path: '', http_url: '', post_path: '' },
        primaryFields: ['url', 'access_token'],
      },
      {
        key: 'wss',
        label: '反向 WebSocket · NapCat 主动连 Zhin',
        badge: '反向 WS · 推荐',
        description: 'Zhin 暴露 WebSocket 路径（如 /napcat），在 NapCat WebUI 中添加反向 WS 客户端指向 Zhin。',
        presetValues: { path: '/napcat', url: '', http_url: '', post_path: '' },
        primaryFields: ['path', 'access_token'],
        callbackUrlTemplate: {
          protocol: 'ws',
          pathField: 'path',
          fallbackPath: '/napcat',
          label: '填入 NapCat WebUI 的反向 WS 地址',
        },
      },
      {
        key: 'http',
        label: 'HTTP API + 事件上报',
        badge: 'HTTP',
        description: '通过 HTTP 请求调用 NapCat API，并接收 HTTP POST 事件上报。',
        presetValues: { http_url: 'http://127.0.0.1:3000', post_path: '/napcat/event', url: '', path: '' },
        primaryFields: ['http_url', 'post_path', 'access_token'],
        callbackUrlTemplate: {
          protocol: 'http',
          pathField: 'post_path',
          fallbackPath: '/napcat/event',
          label: '填入 NapCat WebUI 的 HTTP 事件上报地址',
        },
      },
    ],
    fieldOverrides: {
      url: { label: '正向 WS 服务端地址 (url)', placeholder: 'ws://127.0.0.1:3001' },
      path: { label: '反向 WS 监听路径 (path)', placeholder: '/napcat' },
      http_url: { label: 'HTTP API 地址 (http_url)', placeholder: 'http://127.0.0.1:3000' },
      post_path: { label: 'HTTP 事件上报路径 (post_path)', placeholder: '/napcat/event' },
      access_token: { label: 'Access Token 鉴权密钥', placeholder: '与 NapCat WebUI 保持一致' },
    },
  },

  onebot11: {
    adapterKey: 'onebot11',
    categoryBadge: 'OneBot V11 标准协议',
    categoryBadgeEn: 'OneBot V11 Standard',
    brandMark: 'OB11',
    idLabel: 'OneBot11 实例标识',
    idPlaceholder: '例如 ob11-bot',
    onboardingTitle: 'OneBot V11 协议端接入向导 (LLOneBot / Lagrange / Shamrock)',
    onboardingSteps: [
      '1. 选择正向 WebSocket（主动连接协议端）或反向 WebSocket（协议端连接 Zhin）',
      '2. 配置 Access Token 并点击「测试连接」确认握手状态',
    ],
    connectionModes: [
      {
        key: 'ws',
        label: '正向 WebSocket · 连接协议端',
        badge: '正向 WS',
        description: 'Zhin 主动连接 LLOneBot / Lagrange 开启的 WS 端口（如 ws://127.0.0.1:3001）。',
        presetValues: { url: 'ws://127.0.0.1:3001', path: '' },
        primaryFields: ['url', 'access_token'],
      },
      {
        key: 'wss',
        label: '反向 WebSocket · 监听协议端连接',
        badge: '反向 WS',
        description: 'Zhin 在指定路径监听，协议端配置反向 WS 地址连入。',
        presetValues: { path: '/onebot/v11/ws', url: '' },
        primaryFields: ['path', 'access_token'],
        callbackUrlTemplate: {
          protocol: 'ws',
          pathField: 'path',
          fallbackPath: '/onebot/v11/ws',
          label: 'OneBot 11 反向 WebSocket 地址',
        },
      },
    ],
    fieldOverrides: {
      url: { label: '正向 WS 地址 (url)', placeholder: 'ws://127.0.0.1:3001' },
      path: { label: '反向 WS 路径 (path)', placeholder: '/onebot/v11/ws' },
      access_token: { label: 'Access Token 密钥', placeholder: '与协议端配置一致' },
    },
  },

  onebot12: {
    adapterKey: 'onebot12',
    categoryBadge: 'OneBot V12 跨平台标准协议',
    categoryBadgeEn: 'OneBot V12 Standard',
    brandMark: 'OB12',
    idLabel: 'OneBot12 实例标识',
    idPlaceholder: '例如 ob12-main',
    onboardingTitle: 'OneBot V12 协议接入向导',
    onboardingSteps: [
      '1. 选择正向 WS 或反向 WS / Webhook 模式，填写 platform 与 userId',
      '2. 核对 access_token 后保存并启动',
    ],
    connectionModes: [
      {
        key: 'ws',
        label: '正向 WebSocket',
        badge: '正向 WS',
        description: '主动连接 OneBot 12 实现端的 WebSocket 地址。',
        presetValues: { url: 'ws://127.0.0.1:6700', platform: 'qq', path: '', api_url: '' },
        primaryFields: ['platform', 'userId', 'url', 'access_token'],
      },
      {
        key: 'webhook',
        label: '反向 WS / Webhook 监听',
        badge: '反向/回调',
        description: '在 Zhin 侧暴露路径接收 OneBot 12 事件。',
        presetValues: { path: '/onebot/v12', platform: 'qq', url: '' },
        primaryFields: ['platform', 'userId', 'path', 'api_url', 'access_token'],
        callbackUrlTemplate: {
          protocol: 'ws',
          pathField: 'path',
          fallbackPath: '/onebot/v12',
          label: 'OneBot 12 反向连接地址',
        },
      },
    ],
  },

  satori: {
    adapterKey: 'satori',
    categoryBadge: 'Satori 通用机器人协议',
    categoryBadgeEn: 'Satori Universal Protocol',
    brandMark: 'SA',
    idLabel: 'Satori 节点标识',
    idPlaceholder: '例如 satori-chronocat',
    onboardingSteps: [
      '1. 填写 Satori 服务端 baseUrl（例如 http://127.0.0.1:5500/v1）与平台名称',
      '2. 若服务端启用了鉴权，填写 token 后启动连接',
    ],
    presets: [
      {
        key: 'chronocat',
        label: 'Chronocat 默认端点',
        badge: '5500 端口',
        values: { platform: 'chronocat', baseUrl: 'http://127.0.0.1:5500/v1' },
      },
      {
        key: 'koishi-satori',
        label: 'Satori Server 标准端点',
        values: { platform: 'qq', baseUrl: 'http://127.0.0.1:5140/satori/v1' },
      },
    ],
  },

  milky: {
    adapterKey: 'milky',
    categoryBadge: 'Milky 协议适配器',
    categoryBadgeEn: 'Milky Protocol Adapter',
    brandMark: 'MK',
    idLabel: 'Milky 实例标识',
    idPlaceholder: '例如 milky-bot',
    onboardingSteps: [
      '1. 配置 Milky 服务端 baseUrl 与回调监听路径 path',
      '2. 配置 access_token 后保存并启动',
    ],
    presets: [
      {
        key: 'local-milky',
        label: '本地 Milky 默认配置',
        values: { baseUrl: 'http://127.0.0.1:3000', path: '/milky/webhook' },
      },
    ],
  },

  telegram: {
    adapterKey: 'telegram',
    categoryBadge: '国际即时通讯 (Telegram Bot API)',
    categoryBadgeEn: 'Telegram Bot API',
    brandMark: 'TG',
    idLabel: 'Bot 标识名',
    idPlaceholder: '例如 my-tg-bot',
    onboardingTitle: 'Telegram Bot (@BotFather) 接入向导',
    onboardingSteps: [
      '1. 在 Telegram 向 @BotFather 发送 /newbot 获取形如 123456789:AAH... 的 Bot Token',
      '2. 选择连接方式：本地/内网环境推荐「长轮询 Polling」，公网服务器可选「Webhook 模式」',
    ],
    connectionModes: [
      {
        key: 'polling',
        label: '长轮询 Polling · 免公网推荐',
        badge: '零配置推荐',
        description: '主动向 Telegram API 拉取消息更新，无需公网域名或 SSL 证书。',
        presetValues: { polling: 'true', streaming: 'true' },
        primaryFields: ['token', 'polling', 'streaming'],
      },
      {
        key: 'webhook',
        label: 'Webhook 公网回调模式',
        badge: '低延迟高并发',
        description: '由 Telegram 服务器主动推送更新到公网 HTTPS 域名。',
        presetValues: { polling: 'false', 'webhook.path': '/telegram/webhook', streaming: 'true' },
        primaryFields: ['token', 'polling', 'webhook.domain', 'webhook.path', 'webhook.secretToken'],
        callbackUrlTemplate: {
          protocol: 'http',
          pathField: 'webhook.path',
          fallbackPath: '/telegram/webhook',
          label: 'Telegram Webhook 路径预览',
        },
      },
    ],
    fieldOverrides: {
      token: {
        label: 'Bot Token (@BotFather)',
        placeholder: '123456789:AAHfiqksKZ8WmR2z...',
        hint: '在 Telegram 私聊 @BotFather 发送 /newbot 或 /token 获取',
      },
      polling: { label: '启用长轮询模式 (polling)' },
      streaming: { label: '启用流式消息编辑输出 (streaming)' },
      'webhook.domain': { label: 'Webhook 公网域名 (webhook.domain)', placeholder: 'https://bot.example.com' },
      'webhook.path': { label: 'Webhook 回调路径 (webhook.path)', placeholder: '/telegram/webhook' },
      'webhook.secretToken': { label: 'Webhook 安全校验密钥 (webhook.secretToken)' },
    },
  },

  discord: {
    adapterKey: 'discord',
    categoryBadge: '国际社区 IM (Discord Bot)',
    categoryBadgeEn: 'Discord Developer Portal',
    brandMark: 'DC',
    idLabel: 'Discord Bot 标识',
    idPlaceholder: '例如 discord-main',
    onboardingTitle: 'Discord Bot 接入向导',
    onboardingSteps: [
      '1. 在 Discord Developer Portal -> Bot 页面开启 Message Content Intent 并复制 Bot Token',
      '2. 推荐使用「Gateway WebSocket 模式」（免公网），或切换为「HTTP Interactions 模式」',
    ],
    connectionModes: [
      {
        key: 'gateway',
        label: 'Gateway WebSocket 模式 · 推荐',
        badge: '免公网',
        description: '通过 Discord Gateway WebSocket 接收频道与私聊事件，支持自定义在线状态。',
        presetValues: { connection: 'gateway', 'defaultActivity.type': 'PLAYING' },
        primaryFields: ['token', 'connection', 'applicationId', 'defaultActivity.type', 'defaultActivity.name'],
      },
      {
        key: 'interactions',
        label: 'HTTP Interactions 端点模式',
        badge: 'Webhook',
        description: '通过公网 HTTP 端点接收 Slash Commands 交互，需填写 Public Key。',
        presetValues: { connection: 'interactions', interactionsPath: '/discord/interactions' },
        primaryFields: ['token', 'connection', 'applicationId', 'publicKey', 'interactionsPath'],
        callbackUrlTemplate: {
          protocol: 'http',
          pathField: 'interactionsPath',
          fallbackPath: '/discord/interactions',
          label: 'Discord Interactions Endpoint URL',
        },
      },
    ],
    fieldOverrides: {
      token: { label: 'Discord Bot Token', placeholder: 'MTIzNDU2Nzg5MDEyMzQ1Njc4...' },
      applicationId: { label: 'Application ID (客户端 ID)', placeholder: '123456789012345678' },
      connection: {
        label: '连接方式 (connection)',
        options: [
          { value: 'gateway', label: 'gateway (Gateway WebSocket · 推荐)' },
          { value: 'interactions', label: 'interactions (HTTP Interactions 回调)' },
        ],
      },
      'defaultActivity.type': {
        label: '机器人状态类型 (defaultActivity.type)',
        options: [
          { value: 'PLAYING', label: 'PLAYING (正在玩)' },
          { value: 'WATCHING', label: 'WATCHING (正在看)' },
          { value: 'LISTENING', label: 'LISTENING (正在听)' },
          { value: 'COMPETING', label: 'COMPETING (正在参与)' },
        ],
      },
    },
  },

  slack: {
    adapterKey: 'slack',
    categoryBadge: '企业协作 IM (Slack App)',
    categoryBadgeEn: 'Slack Workspace App',
    brandMark: 'SL',
    idLabel: 'Slack 应用标识',
    idPlaceholder: '例如 slack-workspace',
    onboardingTitle: 'Slack App 接入向导',
    onboardingSteps: [
      '1. 推荐使用 Socket Mode：在 Slack App 后台开启 Socket Mode 获取 xapp- 开头的 App Token，以及 xoxb- 开头的 Bot Token',
      '2. 若使用 HTTP Events 回调，关闭 Socket Mode 并填写 Signing Secret 与回调路径',
    ],
    connectionModes: [
      {
        key: 'socket',
        label: 'Socket Mode 长连接 · 免公网推荐',
        badge: '免公网',
        description: '使用 WebSocket 接收事件，无需暴露公网 HTTP 回调地址。',
        presetValues: { socketMode: 'true', streaming: 'true' },
        primaryFields: ['token', 'appToken', 'socketMode', 'streaming'],
      },
      {
        key: 'events',
        label: 'HTTP Events 回调模式',
        badge: 'Webhook',
        description: '通过公网 HTTP 路径接收 Slack Event Subscriptions 推送。',
        presetValues: { socketMode: 'false', webhookPath: '/slack/events', streaming: 'true' },
        primaryFields: ['token', 'signingSecret', 'socketMode', 'webhookPath'],
        callbackUrlTemplate: {
          protocol: 'http',
          pathField: 'webhookPath',
          fallbackPath: '/slack/events',
          label: 'Slack Event Subscriptions Request URL',
        },
      },
    ],
    fieldOverrides: {
      token: { label: 'Bot User OAuth Token (xoxb-...)', placeholder: 'xoxb-...' },
      appToken: { label: 'App-Level Token (xapp-... · Socket Mode 必填)', placeholder: 'xapp-1-...' },
      signingSecret: { label: 'Signing Secret (签名密钥)', placeholder: 'Slack App Basic Information 中的 Signing Secret' },
      socketMode: { label: '启用 Socket Mode (socketMode)' },
    },
  },

  kook: {
    adapterKey: 'kook',
    categoryBadge: '游戏语音社区 (KOOK 开发者平台)',
    categoryBadgeEn: 'KOOK Developer Platform',
    brandMark: 'KK',
    idLabel: 'KOOK 机器人标识',
    idPlaceholder: '例如 kook-bot',
    onboardingSteps: [
      '1. 在 KOOK 开发者中心创建机器人，选择 WebSocket 模式（推荐）或 Webhook 模式',
      '2. 粘贴 Bot Token 后保存并启动',
    ],
    connectionModes: [
      {
        key: 'websocket',
        label: 'WebSocket 网关模式 · 推荐',
        badge: '免公网',
        description: '连接 KOOK WebSocket 网关，无需公网服务器。',
        presetValues: { connection: 'websocket', ignore: 'bot' },
        primaryFields: ['token', 'connection', 'ignore'],
      },
      {
        key: 'webhook',
        label: 'Webhook 回调模式',
        badge: 'Webhook',
        description: '通过 HTTP Webhook 接收事件，需配置 verify_token 与 encrypt_key。',
        presetValues: { connection: 'webhook', webhookPath: '/kook/webhook', ignore: 'bot' },
        primaryFields: ['token', 'connection', 'verify_token', 'encrypt_key', 'webhookPath'],
        callbackUrlTemplate: {
          protocol: 'http',
          pathField: 'webhookPath',
          fallbackPath: '/kook/webhook',
          label: 'KOOK Webhook 回调地址',
        },
      },
    ],
  },

  lark: {
    adapterKey: 'lark',
    categoryBadge: '企业协作 IM (飞书 / Lark 开放平台)',
    categoryBadgeEn: 'Feishu / Lark Open Platform',
    brandMark: '飞书',
    idLabel: '飞书应用标识',
    idPlaceholder: '例如 feishu-bot',
    onboardingTitle: '飞书 / Lark 企业自建应用接入向导',
    onboardingSteps: [
      '1. 在飞书开放平台获取 App ID (cli_...) 与 App Secret',
      '2. 将下方生成的事件订阅回调地址填入飞书后台「事件与回调 -> 请求地址」，并配置 Verification Token / Encrypt Key',
    ],
    connectionModes: [
      {
        key: 'feishu',
        label: '飞书 / Lark 事件订阅回调',
        badge: '推荐',
        description: '连接飞书或 Lark 开放平台 API，支持流式卡片回复。',
        presetValues: { streaming: 'true' },
        primaryFields: ['appId', 'appSecret', 'verificationToken', 'encryptKey', 'streaming'],
        callbackUrlTemplate: {
          protocol: 'http',
          pathField: 'webhookPath',
          fallbackPath: '/lark/webhook',
          label: '飞书事件订阅请求地址 (Request URL)',
        },
      },
    ],
    fieldOverrides: {
      appId: { label: '飞书 App ID', placeholder: 'cli_a1b2c3d4e5f6...', group: '应用凭证 AppID/Secret' },
      appSecret: { label: '飞书 App Secret', placeholder: '应用密钥', group: '应用凭证 AppID/Secret' },
      encryptKey: { label: '事件加密密钥 (Encrypt Key)', group: '回调加解密与安全验证' },
      verificationToken: { label: '验证令牌 (Verification Token)', group: '回调加解密与安全验证' },
      streaming: { label: '启用流式卡片输出 (streaming)', group: '流式回复体验' },
    },
  },

  dingtalk: {
    adapterKey: 'dingtalk',
    categoryBadge: '企业协作 IM (钉钉开放平台)',
    categoryBadgeEn: 'DingTalk Open Platform',
    brandMark: '钉钉',
    idLabel: '钉钉机器人标识',
    idPlaceholder: '例如 dingtalk-bot',
    onboardingTitle: '钉钉企业内部机器人接入向导',
    onboardingSteps: [
      '1. 在钉钉开发者后台获取应用的 AppKey (Client ID) 与 AppSecret (Client Secret)',
      '2. 配置 Webhook 接收路径并填入钉钉后台消息接收地址',
    ],
    connectionModes: [
      {
        key: 'webhook',
        label: 'HTTP Webhook 回调模式',
        badge: '企业机器人',
        description: '接收钉钉开放平台 HTTP 消息推送。',
        presetValues: {},
        primaryFields: ['appKey', 'appSecret', 'webhookSecret'],
        callbackUrlTemplate: {
          protocol: 'http',
          pathField: 'webhookPath',
          fallbackPath: '/dingtalk/webhook',
          label: '钉钉机器人消息接收地址',
        },
      },
    ],
    fieldOverrides: {
      appKey: { label: '钉钉 AppKey (Client ID)', placeholder: 'ding...' },
      appSecret: { label: '钉钉 AppSecret (Client Secret)' },
      webhookSecret: { label: 'Webhook 签名校验密钥 (webhookSecret)' },
    },
  },

  wecom: {
    adapterKey: 'wecom',
    categoryBadge: '企业协作 IM (企业微信自建应用)',
    categoryBadgeEn: 'WeCom Enterprise App',
    brandMark: '企微',
    idLabel: '企微应用标识',
    idPlaceholder: '例如 wecom-app',
    onboardingTitle: '企业微信自建应用接入向导',
    onboardingSteps: [
      '1. 在企业微信管理后台获取企业 ID (corpId)、应用 AgentId 与 Secret (agentSecret)',
      '2. 在「接收消息 -> 设置 API 接收」配置 Token 与 EncodingAESKey，并将下方回调地址填入 URL',
    ],
    connectionModes: [
      {
        key: 'webhook',
        label: 'API 接收消息回调模式',
        badge: '企业自建应用',
        description: '通过企业微信加解密回调验证并收发企业内部消息。',
        presetValues: {},
        primaryFields: ['corpId', 'agentSecret', 'agentId', 'token', 'encodingAESKey'],
        callbackUrlTemplate: {
          protocol: 'http',
          pathField: 'webhookPath',
          fallbackPath: '/wecom/webhook',
          label: '企业微信 API 接收消息 URL',
        },
      },
    ],
    fieldOverrides: {
      corpId: { label: '企业 ID (corpId)', placeholder: 'ww...', group: '应用凭证 AppID/Secret' },
      agentSecret: { label: '应用 Secret (agentSecret)', group: '应用凭证 AppID/Secret' },
      agentId: { label: '应用 AgentId', placeholder: '1000002', group: '应用凭证 AppID/Secret' },
      token: { label: '回调 Token', group: '回调加解密与安全验证' },
      encodingAESKey: { label: '消息加解密密钥 (43位 EncodingAESKey)', group: '回调加解密与安全验证' },
    },
  },

  'wechat-mp': {
    adapterKey: 'wechat-mp',
    categoryBadge: '微信公众平台 (公众号 / 服务号)',
    categoryBadgeEn: 'WeChat Official Account',
    brandMark: '公众号',
    idLabel: '公众号标识',
    idPlaceholder: '例如 mp-official',
    onboardingSteps: [
      '1. 在微信公众平台「基本配置」获取 AppID、AppSecret 与服务器配置 Token',
      '2. 将下方回调地址填入公众号「服务器地址 (URL)」，启动账号后在微信后台点击提交验证',
    ],
    connectionModes: [
      {
        key: 'webhook',
        label: '公众号服务器回调模式',
        badge: '被动回复 + 客服消息',
        description: '接收微信公众平台 XML 消息推送，支持明文与安全加密模式。',
        presetValues: {},
        primaryFields: ['appId', 'appSecret', 'token', 'encodingAESKey'],
        callbackUrlTemplate: {
          protocol: 'http',
          pathField: 'path',
          fallbackPath: '/wechat',
          label: '微信公众平台服务器地址 (URL)',
        },
      },
    ],
  },

  'weixin-ilink': {
    adapterKey: 'weixin-ilink',
    categoryBadge: '微信 iLink 开放终端',
    categoryBadgeEn: 'WeChat iLink Terminal',
    brandMark: '微信',
    idLabel: '微信终端标识',
    idPlaceholder: '例如 wx-ilink',
    onboardingSteps: [
      '1. 添加账号（若尚未获取 botToken 可留空）',
      '2. 在「安全验证工作台」扫描微信二维码完成授权绑定',
    ],
  },

  line: {
    adapterKey: 'line',
    categoryBadge: '国际即时通讯 (LINE Messaging API)',
    categoryBadgeEn: 'LINE Messaging API',
    brandMark: 'LINE',
    idLabel: 'LINE Channel 标识',
    idPlaceholder: '例如 line-official',
    onboardingSteps: [
      '1. 在 LINE Developers Console 获取 Channel Access Token 与 Channel Secret',
      '2. 将 Webhook URL 指向下方回调地址并在 LINE 后台开启 Use webhook',
    ],
    connectionModes: [
      {
        key: 'webhook',
        label: 'LINE Webhook 模式',
        badge: 'Messaging API',
        description: '通过 HMAC-SHA256 签名校验接收 LINE 平台消息推送。',
        presetValues: {},
        primaryFields: ['channelAccessToken', 'channelSecret'],
        callbackUrlTemplate: {
          protocol: 'http',
          pathField: 'webhookPath',
          fallbackPath: '/line/webhook',
          label: 'LINE Messaging API Webhook URL',
        },
      },
    ],
  },

  email: {
    adapterKey: 'email',
    categoryBadge: '邮件收发协议 (IMAP / SMTP)',
    categoryBadgeEn: 'Email Protocol (IMAP / SMTP)',
    brandMark: '郵',
    idLabel: '邮箱配置标识',
    idPlaceholder: '例如 support-mail',
    onboardingTitle: '邮箱服务商一键预设与 IMAP/SMTP 配置向导',
    onboardingSteps: [
      '1. 点击下方邮箱服务商预设卡片（QQ 邮箱 / 腾讯企业邮 / 163 / Gmail / Outlook / 阿里企业邮）自动填充服务器与端口',
      '2. 填写发件邮箱地址与客户端专用授权码（非网页登录密码），可点击「将发件账号同步至收件账号」一键复用',
    ],
    supportsEmailSync: true,
    presets: [
      {
        key: 'qq-mail',
        label: 'QQ 邮箱',
        badge: '常用推荐',
        description: 'smtp.qq.com:465 / imap.qq.com:993 (需开启 IMAP/SMTP 获取 16 位授权码)',
        values: {
          'smtp.host': 'smtp.qq.com',
          'smtp.port': '465',
          'smtp.secure': 'true',
          'imap.host': 'imap.qq.com',
          'imap.port': '993',
          'imap.tls': 'true',
          'imap.mailbox': 'INBOX',
          'imap.markSeen': 'true',
        },
      },
      {
        key: 'exmail-qq',
        label: '腾讯企业邮箱',
        badge: '企业邮',
        description: 'smtp.exmail.qq.com:465 / imap.exmail.qq.com:993',
        values: {
          'smtp.host': 'smtp.exmail.qq.com',
          'smtp.port': '465',
          'smtp.secure': 'true',
          'imap.host': 'imap.exmail.qq.com',
          'imap.port': '993',
          'imap.tls': 'true',
          'imap.mailbox': 'INBOX',
          'imap.markSeen': 'true',
        },
      },
      {
        key: 'netease-163',
        label: '163 网易邮箱',
        description: 'smtp.163.com:465 / imap.163.com:993',
        values: {
          'smtp.host': 'smtp.163.com',
          'smtp.port': '465',
          'smtp.secure': 'true',
          'imap.host': 'imap.163.com',
          'imap.port': '993',
          'imap.tls': 'true',
          'imap.mailbox': 'INBOX',
          'imap.markSeen': 'true',
        },
      },
      {
        key: 'gmail',
        label: 'Gmail',
        description: 'smtp.gmail.com:465 / imap.gmail.com:993 (需 Google 应用专用密码)',
        values: {
          'smtp.host': 'smtp.gmail.com',
          'smtp.port': '465',
          'smtp.secure': 'true',
          'imap.host': 'imap.gmail.com',
          'imap.port': '993',
          'imap.tls': 'true',
          'imap.mailbox': 'INBOX',
          'imap.markSeen': 'true',
        },
      },
      {
        key: 'outlook',
        label: 'Outlook / Microsoft 365',
        description: 'smtp.office365.com:587 / outlook.office365.com:993',
        values: {
          'smtp.host': 'smtp.office365.com',
          'smtp.port': '587',
          'smtp.secure': 'false',
          'imap.host': 'outlook.office365.com',
          'imap.port': '993',
          'imap.tls': 'true',
          'imap.mailbox': 'INBOX',
          'imap.markSeen': 'true',
        },
      },
      {
        key: 'ali-mail',
        label: '阿里企业邮箱',
        description: 'smtp.mxhichina.com:465 / imap.mxhichina.com:993',
        values: {
          'smtp.host': 'smtp.mxhichina.com',
          'smtp.port': '465',
          'smtp.secure': 'true',
          'imap.host': 'imap.mxhichina.com',
          'imap.port': '993',
          'imap.tls': 'true',
          'imap.mailbox': 'INBOX',
          'imap.markSeen': 'true',
        },
      },
    ],
    fieldOverrides: {
      'smtp.auth.user': { label: 'SMTP 发件邮箱账号 (smtp.auth.user)', placeholder: 'bot@example.com', group: '邮箱认证凭据' },
      'smtp.auth.pass': { label: 'SMTP 授权码 / 密码 (smtp.auth.pass)', placeholder: '客户端专用授权码', group: '邮箱认证凭据' },
      'imap.user': { label: 'IMAP 收件邮箱账号 (imap.user)', placeholder: 'bot@example.com', group: '邮箱认证凭据' },
      'imap.password': { label: 'IMAP 授权码 / 密码 (imap.password)', placeholder: '客户端专用授权码', group: '邮箱认证凭据' },
      'smtp.host': { label: 'SMTP 服务器地址 (smtp.host)', placeholder: 'smtp.qq.com', group: 'SMTP 发件服务器' },
      'smtp.port': { label: 'SMTP 端口 (smtp.port)', placeholder: '465', group: 'SMTP 发件服务器' },
      'smtp.secure': { label: '启用 SSL/TLS 加密 (smtp.secure)', group: 'SMTP 发件服务器' },
      'smtp.fromName': { label: '发件人显示名称 (smtp.fromName)', placeholder: 'Zhin Assistant', group: 'SMTP 发件服务器' },
      'imap.host': { label: 'IMAP 服务器地址 (imap.host)', placeholder: 'imap.qq.com', group: 'IMAP 收件服务器' },
      'imap.port': { label: 'IMAP 端口 (imap.port)', placeholder: '993', group: 'IMAP 收件服务器' },
      'imap.tls': { label: '启用 IMAP TLS (imap.tls)', group: 'IMAP 收件服务器' },
      'imap.mailbox': { label: '监听收件箱文件夹 (imap.mailbox)', placeholder: 'INBOX', group: '轮询与附件策略' },
      'imap.checkInterval': { label: '邮件轮询间隔 ms (imap.checkInterval)', placeholder: '30000', group: '轮询与附件策略' },
      'imap.markSeen': { label: '处理后标记已读 (imap.markSeen)', group: '轮询与附件策略' },
    },
  },

  github: {
    adapterKey: 'github',
    categoryBadge: '开发者协作平台 (GitHub Webhook & API)',
    categoryBadgeEn: 'GitHub Webhook & REST API',
    brandMark: 'GH',
    idLabel: 'GitHub 机器人标识',
    idPlaceholder: '例如 github-bot',
    onboardingSteps: [
      '1. 在 GitHub Settings -> Developer settings 配置 GitHub App (app_id / private_key)',
      '2. 在仓库或组织 Settings -> Webhooks 填入下方回调地址与 Webhook Secret (webhook_secret)',
    ],
    connectionModes: [
      {
        key: 'webhook',
        label: 'Webhook 实时事件 + API 互动',
        badge: '推荐',
        description: '接收 Issue / PR / Push / Discussion 实时事件并自动评论或打标签。',
        presetValues: {},
        primaryFields: ['app_id', 'private_key', 'webhook_secret'],
        callbackUrlTemplate: {
          protocol: 'http',
          pathField: 'webhook_path',
          fallbackPath: '/github/webhook',
          label: 'GitHub Webhook Payload URL',
        },
      },
    ],
    fieldOverrides: {
      app_id: { label: 'GitHub App ID (app_id)', placeholder: '例如 123456' },
      private_key: { label: 'GitHub App 私钥 (private_key)' },
      webhook_secret: { label: 'Webhook 签名密钥 (webhook_secret)' },
    },
  },

  'bilibili-live': {
    adapterKey: 'bilibili-live',
    categoryBadge: '直播弹幕互动 (Bilibili Live)',
    categoryBadgeEn: 'Bilibili Live Danmaku',
    brandMark: 'B站',
    idLabel: '直播间连接标识',
    idPlaceholder: '例如 room-main',
    onboardingSteps: [
      '1. 填写 B 站直播间房间号 (roomId)',
      '2. 若需更高抗风控能力或发送弹幕回复，填写 B 站 Cookie 中的 SESSDATA 与 biliJct (CSRF)',
    ],
    connectionModes: [
      {
        key: 'guest',
        label: '游客免密弹幕监听',
        badge: '只读监听',
        description: '仅需填写直播间号即可监听弹幕、礼物、上舰与醒目留言 (SC)。',
        presetValues: {},
        primaryFields: ['roomId', 'uid'],
      },
      {
        key: 'auth',
        label: '登录态双向弹幕互动',
        badge: '可发弹幕',
        description: '配置 SESSDATA 与 biliJct，支持在直播间发送弹幕回复。',
        presetValues: {},
        primaryFields: ['roomId', 'uid', 'sessdata', 'biliJct', 'buvid3'],
      },
    ],
    fieldOverrides: {
      roomId: { label: 'B 站直播间房间号 (roomId)', placeholder: '例如 21452505' },
      uid: { label: '主播或机器人 UID (可选)', placeholder: '例如 123456' },
      sessdata: { label: '登录态 Cookie SESSDATA (发弹幕必填)' },
      biliJct: { label: 'CSRF Token biliJct (发弹幕必填)' },
      buvid3: { label: '设备标识 buvid3 (可选防风控)' },
    },
  },
};

export function getPlatformProfile(adapterKey: string): PlatformAdapterProfile {
  return (
    PLATFORM_PROFILES[adapterKey] ?? {
      adapterKey,
      categoryBadge: `IM 平台适配器 (${adapterKey})`,
      categoryBadgeEn: `IM Platform Adapter (${adapterKey})`,
      brandMark: adapterKey.slice(0, 2).toUpperCase(),
      onboardingSteps: [
        '1. 填写账号唯一标识与平台连接凭证',
        '2. 保存并启动账号，点击「测试连接」验证连通性',
      ],
    }
  );
}

export function resolveFieldDisplay(
  adapterKey: string,
  field: AdapterConsoleFieldView,
  locale: AdapterConsoleLocale,
): {
  readonly displayLabel: string;
  readonly placeholder?: string;
  readonly hint?: string;
  readonly group?: string;
  readonly quickOptions?: readonly AdapterConsoleFieldOptionView[];
} {
  const profile = PLATFORM_PROFILES[adapterKey];
  const override = profile?.fieldOverrides?.[field.key];
  const baseLabel =
    locale === 'en'
      ? (field.labelI18n?.en ?? override?.labelEn ?? field.label ?? field.key)
      : (field.label ?? override?.label ?? field.key);
  const placeholder =
    (locale === 'en' ? field.placeholderI18n?.en : undefined) ??
    field.placeholder ??
    override?.placeholder;
  const desc =
    locale === 'en'
      ? (field.descriptionI18n?.en ?? field.description)
      : (field.description ?? override?.hint);
  const group =
    (locale === 'en' ? field.groupI18n?.en : undefined) ??
    field.group ??
    override?.group;
  const quickOptions = field.options ?? override?.options;
  return {
    displayLabel: baseLabel,
    placeholder,
    hint: desc,
    group,
    quickOptions,
  };
}

const RANDOM_SECRET_KEYS = new Set([
  'access_token',
  'token',
  'secretToken',
  'webhook.secretToken',
  'webhook_secret',
  'webhookSecret',
  'verify_token',
  'verificationToken',
  'encryptKey',
  'encrypt_key',
  'encodingAESKey',
]);

export function isRandomSecretField(fieldKey: string): boolean {
  return RANDOM_SECRET_KEYS.has(fieldKey);
}

export function generateRandomSecret(fieldKey: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const length = fieldKey === 'encodingAESKey' ? 43 : 32;
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Smart extraction for ICQQ / QQ slider tickets:
 * supports raw ticket string, JSON response (`{"ticket":"t03..."}`), or callback URL query param (`?ticket=...`).
 */
export function extractSliderTicket(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof parsed.ticket === 'string' && parsed.ticket.trim()) return parsed.ticket.trim();
      if (parsed.data && typeof parsed.data === 'object') {
        const inner = (parsed.data as Record<string, unknown>).ticket;
        if (typeof inner === 'string' && inner.trim()) return inner.trim();
      }
    } catch {
      // fall through
    }
  }
  const urlMatch = /[?&]ticket=([^&#\s]+)/iu.exec(trimmed);
  if (urlMatch?.[1]) {
    try {
      return decodeURIComponent(urlMatch[1]);
    } catch {
      return urlMatch[1];
    }
  }
  return trimmed;
}

const ICQQ_PLATFORM_NAMES: Readonly<Record<string, string>> = {
  '1': 'Android 手机',
  '2': 'aPad 平板',
  '3': 'Android 手表',
  '4': 'macOS 桌面',
  '5': 'iPad 协议',
  '6': 'Android Pad',
};

export function inferAccountProtocolPills(
  adapterKey: string,
  values: Readonly<Record<string, string>> | undefined,
  runningMode?: string,
): readonly { readonly label: string; readonly tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'info' }[] {
  const pills: { label: string; tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'info' }[] = [];
  if (runningMode) {
    pills.push({ label: runningMode, tone: 'info' });
  }
  if (!values) return pills;

  if (adapterKey === 'icqq') {
    const pf = values.platform;
    if (pf && ICQQ_PLATFORM_NAMES[pf]) {
      pills.push({ label: ICQQ_PLATFORM_NAMES[pf]!, tone: 'primary' });
    }
    if (values.qqnt === 'true') pills.push({ label: 'QQNT', tone: 'info' });
    if (values.ntLogin === 'true') pills.push({ label: 'NTLogin', tone: 'neutral' });
    if (values.signApiAddr) pills.push({ label: '已配签名服务', tone: 'success' });
  } else if (adapterKey === 'qq') {
    if (values.mode) pills.push({ label: values.mode === 'websocket' ? 'WebSocket 长连接' : values.mode, tone: 'primary' });
    if (values.botKind === 'public') pills.push({ label: '公域机器人', tone: 'info' });
    if (values.botKind === 'private') pills.push({ label: '私域机器人', tone: 'neutral' });
    if (values.sandbox === 'true') pills.push({ label: '沙箱环境', tone: 'warning' });
  } else if (adapterKey === 'napcat' || adapterKey === 'onebot11' || adapterKey === 'onebot12') {
    const t = values.type;
    if (t === 'ws') pills.push({ label: '正向 WS', tone: 'primary' });
    else if (t === 'wss') pills.push({ label: '反向 WS', tone: 'info' });
    else if (t === 'http') pills.push({ label: 'HTTP 模式', tone: 'neutral' });
    if (values.url) pills.push({ label: values.url, tone: 'neutral' });
    else if (values.path) pills.push({ label: values.path, tone: 'neutral' });
  } else if (adapterKey === 'telegram') {
    if (values.polling === 'false' || values['webhook.domain']) {
      pills.push({ label: 'Webhook 模式', tone: 'info' });
    } else {
      pills.push({ label: 'Polling 长轮询', tone: 'primary' });
    }
  } else if (adapterKey === 'discord') {
    if (values.connection === 'interactions') pills.push({ label: 'HTTP Interactions', tone: 'info' });
    else pills.push({ label: 'Gateway WS', tone: 'primary' });
  } else if (adapterKey === 'slack') {
    if (values.socketMode === 'false') pills.push({ label: 'HTTP Events', tone: 'info' });
    else pills.push({ label: 'Socket Mode', tone: 'primary' });
  } else if (adapterKey === 'email') {
    const host = values['smtp.host'] ?? '';
    if (host.includes('exmail.qq.com')) pills.push({ label: '腾讯企业邮', tone: 'primary' });
    else if (host.includes('qq.com')) pills.push({ label: 'QQ 邮箱', tone: 'primary' });
    else if (host.includes('163.com')) pills.push({ label: '163 邮箱', tone: 'primary' });
    else if (host.includes('gmail.com')) pills.push({ label: 'Gmail', tone: 'primary' });
    else if (host.includes('office365.com')) pills.push({ label: 'Outlook', tone: 'primary' });
    else if (host) pills.push({ label: host, tone: 'neutral' });
    if (values['smtp.auth.user']) pills.push({ label: values['smtp.auth.user'], tone: 'info' });
  } else if (adapterKey === 'bilibili-live') {
    if (values.roomId) pills.push({ label: `房间 #${values.roomId}`, tone: 'primary' });
    if (values.sessdata) pills.push({ label: '已配登录态', tone: 'success' });
  }
  return pills;
}
