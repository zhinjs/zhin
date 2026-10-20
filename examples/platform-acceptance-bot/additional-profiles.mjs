/** Network acceptance profiles; never loads or writes environment files. */
export const additionalPlatforms = Object.freeze(['discord', 'slack', 'kook', 'email', 'lark', 'dingtalk', 'line']);
export const ADDITIONAL_PLATFORMS = additionalPlatforms;
const variable = name => '${' + name + '}';
function required(environment, name) {
  if (typeof environment[name] !== 'string' || !environment[name].trim()) throw new Error(`缺少 ${name}`);
  return variable(name);
}
function integer(environment, name, fallback, minimum, maximum) {
  const raw = environment[name];
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) throw new Error(`${name} 必须为整数`);
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} 超出范围`);
  return value;
}
function boolean(environment, name, fallback) {
  if (environment[name] === undefined) return fallback;
  const value = environment[name]?.trim();
  if (value !== 'true' && value !== 'false') throw new Error(`${name} 必须为 true 或 false`);
  return value === 'true';
}

export function buildAdditionalProfile(platform, environment) {
  const endpoint = { id: 'test-bot' };
  let mode;
  let defaultKind = 'channel';
  switch (platform) {
    case 'line':
      mode = 'webhook';
      defaultKind = 'private';
      Object.assign(endpoint, { channelSecret: required(environment, 'LINE_CHANNEL_SECRET'), channelAccessToken: required(environment, 'LINE_CHANNEL_ACCESS_TOKEN'), webhookPath: environment.LINE_WEBHOOK_PATH?.trim() || '/line/webhook' });
      break;
    case 'lark':
      if (environment.LARK_WEB_API_PROXY_PORT?.trim()) Object.assign(endpoint, { webApiProxy: { port: integer(environment, 'LARK_WEB_API_PROXY_PORT', 0, 1, 65535) } });
      if (environment.LARK_STREAM_PROXY_PORT?.trim() || environment.LARK_STREAM_PROXY_SERVER_NAME?.trim()) {
        required(environment, 'LARK_STREAM_PROXY_PORT');
        Object.assign(endpoint, { streamProxy: { port: integer(environment, 'LARK_STREAM_PROXY_PORT', 0, 1, 65535), serverName: required(environment, 'LARK_STREAM_PROXY_SERVER_NAME') } });
      }
      mode = environment.LARK_MODE?.trim() || 'websocket';
      if (!['webhook', 'websocket'].includes(mode)) throw new Error('LARK_MODE 只能填写 webhook、websocket');
      defaultKind = 'private';
      Object.assign(endpoint, { appId: required(environment, 'LARK_APP_ID'), appSecret: required(environment, 'LARK_APP_SECRET'),
        mode, ...(mode === 'webhook' ? { verificationToken: required(environment, 'LARK_VERIFY_TOKEN'), webhookPath: environment.LARK_WEBHOOK_PATH?.trim() || '/lark/webhook' } : {}), isFeishu: true });
      break;
    case 'dingtalk':
      if (environment.DINGTALK_STREAM_PROXY_PORT?.trim() || environment.DINGTALK_STREAM_PROXY_SERVER_NAME?.trim()) {
        required(environment, 'DINGTALK_STREAM_PROXY_PORT');
        Object.assign(endpoint, { streamProxy: { port: integer(environment, 'DINGTALK_STREAM_PROXY_PORT', 0, 1, 65535), serverName: required(environment, 'DINGTALK_STREAM_PROXY_SERVER_NAME') } });
      }
      mode = environment.DINGTALK_MODE?.trim() || 'stream';
      if (!['webhook', 'stream'].includes(mode)) throw new Error('DINGTALK_MODE 只能填写 webhook、stream');
      defaultKind = 'private';
      Object.assign(endpoint, { appKey: required(environment, 'DINGTALK_APP_KEY'), appSecret: required(environment, 'DINGTALK_APP_SECRET'),
        mode, ...(mode === 'webhook' ? { webhookPath: environment.DINGTALK_WEBHOOK_PATH?.trim() || '/dingtalk/webhook' } : {}),
        ...(environment.DINGTALK_ROBOT_CODE?.trim() ? { robotCode: required(environment, 'DINGTALK_ROBOT_CODE') } : {}),
        ...(environment.DINGTALK_CARD_TEMPLATE_ID?.trim() ? { cardTemplateId: required(environment, 'DINGTALK_CARD_TEMPLATE_ID') } : {}),
        ...(environment.DINGTALK_CARD_BUTTON_COUNT !== undefined ? { cardButtonCount: integer(environment, 'DINGTALK_CARD_BUTTON_COUNT', 2, 1, 5) } : {}) });
      break;
    case 'discord':
      if (environment.DISCORD_REST_API_PROXY_PORT?.trim()) {
        Object.assign(endpoint, { restApiProxy: { port: integer(environment, 'DISCORD_REST_API_PROXY_PORT', 0, 1, 65535) } });
      }
      mode = 'gateway';
      if (environment.DISCORD_GATEWAY_FAULT_PROXY_URL?.trim()) {
        Object.assign(endpoint, { gatewayFaultProxyUrl: required(environment, 'DISCORD_GATEWAY_FAULT_PROXY_URL') });
      }
      Object.assign(endpoint, { token: required(environment, 'DISCORD_BOT_TOKEN'), connection: mode,
        // Minimal message probe intents: Guilds, GuildMessages, DirectMessages, MessageContent.
        intents: [1, 512, 4096, 32768], enableSlashCommands: false });
      break;
    case 'slack':
      if (environment.SLACK_WEB_API_PROXY_PORT?.trim()) {
        Object.assign(endpoint, { webApiProxy: { port: integer(environment, 'SLACK_WEB_API_PROXY_PORT', 0, 1, 65535) } });
      }
      if (environment.SLACK_STREAM_PROXY_PORT?.trim() || environment.SLACK_STREAM_PROXY_SERVER_NAME?.trim()) {
        required(environment, 'SLACK_STREAM_PROXY_PORT');
        Object.assign(endpoint, { streamProxy: { port: integer(environment, 'SLACK_STREAM_PROXY_PORT', 0, 1, 65535), serverName: required(environment, 'SLACK_STREAM_PROXY_SERVER_NAME') } });
      }
      mode = 'socket';
      defaultKind = 'group';
      Object.assign(endpoint, { token: required(environment, 'SLACK_BOT_TOKEN'), appToken: required(environment, 'SLACK_APP_TOKEN'), socketMode: true });
      break;
    case 'kook':
      if (environment.KOOK_API_PROXY_PORT?.trim()) {
        Object.assign(endpoint, { apiProxy: { port: integer(environment, 'KOOK_API_PROXY_PORT', 0, 1, 65535) } });
      }
      if (environment.KOOK_STREAM_PROXY_PORT?.trim() || environment.KOOK_STREAM_PROXY_SERVER_NAME?.trim()) {
        required(environment, 'KOOK_STREAM_PROXY_PORT');
        Object.assign(endpoint, { streamProxy: { port: integer(environment, 'KOOK_STREAM_PROXY_PORT', 0, 1, 65535), serverName: required(environment, 'KOOK_STREAM_PROXY_SERVER_NAME') } });
      }
      mode = 'websocket';
      Object.assign(endpoint, { token: required(environment, 'KOOK_BOT_TOKEN'), connection: mode });
      break;
    case 'email':
      mode = 'smtp-imap';
      defaultKind = 'private';
      Object.assign(endpoint, {
        smtp: { host: required(environment, 'EMAIL_SMTP_HOST'),
          ...(environment.EMAIL_SMTP_SERVER_NAME?.trim() ? { serverName: required(environment, 'EMAIL_SMTP_SERVER_NAME') } : {}),
          port: integer(environment, 'EMAIL_SMTP_PORT', 465, 1, 65535),
          secure: boolean(environment, 'EMAIL_SMTP_SECURE', true),
          auth: { user: required(environment, 'EMAIL_SMTP_USER'), pass: required(environment, 'EMAIL_SMTP_PASSWORD') } },
        imap: { host: required(environment, 'EMAIL_IMAP_HOST'),
          ...(environment.EMAIL_IMAP_SERVER_NAME?.trim() ? { serverName: required(environment, 'EMAIL_IMAP_SERVER_NAME') } : {}),
          port: integer(environment, 'EMAIL_IMAP_PORT', 993, 1, 65535),
          tls: boolean(environment, 'EMAIL_IMAP_TLS', true),
          user: required(environment, 'EMAIL_IMAP_USER'), password: required(environment, 'EMAIL_IMAP_PASSWORD') },
      });
      break;
    default: throw new Error(`平台必须为 ${additionalPlatforms.join('、')}`);
  }
  if (mode === 'webhook' && (!endpoint.webhookPath.startsWith('/') || /[?#]/.test(endpoint.webhookPath))) throw new Error(`${platform.toUpperCase()}_WEBHOOK_PATH 必须为不含查询参数的绝对路径`);
  return { instance: { commandPrefix: '/', endpoints: [endpoint] }, mode, defaultKind };
}
