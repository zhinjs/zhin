/**
 * Resolve iLink bot credentials (env / config / sidecar file / QR login).
 * No legacy Plugin / loginAssist dependency — QR URL is logged for manual scan.
 */
import { apiGetFetch, apiPostFetch } from './ilink-api.js';
import { buildBaseInfo, DEFAULT_API_BASE_URL } from './ilink-meta.js';
import { logger } from './ilink-logger.js';
import {
  loadCredentials,
  saveCredentials,
  type WeixinIlinkCredentials,
} from './credentials.js';
import type { ResolvedWeixinIlinkConfig } from './protocol.js';

const DEFAULT_ILINK_BOT_TYPE = '3';
const QR_LONG_POLL_TIMEOUT_MS = 35_000;
const LOGIN_TIMEOUT_MS = 480_000;

interface QRCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

interface StatusResponse {
  status:
    | 'wait'
    | 'scaned'
    | 'confirmed'
    | 'expired'
    | 'scaned_but_redirect'
    | 'need_verifycode'
    | 'verify_code_blocked'
    | 'binded_redirect';
  bot_token?: string;
  ilink_endpoint_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
}

function getLocalBotTokenList(): string[] {
  return [];
}

async function fetchQRCode(apiBaseUrl: string, botType: string): Promise<QRCodeResponse> {
  const rawText = await apiPostFetch({
    baseUrl: apiBaseUrl,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    body: JSON.stringify({ local_token_list: getLocalBotTokenList(), base_info: buildBaseInfo() }),
    label: 'fetchQRCode',
  });
  return JSON.parse(rawText) as QRCodeResponse;
}

async function pollQRStatus(
  apiBaseUrl: string,
  qrcode: string,
): Promise<StatusResponse> {
  try {
    const endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
    const rawText = await apiGetFetch({
      baseUrl: apiBaseUrl,
      endpoint,
      timeoutMs: QR_LONG_POLL_TIMEOUT_MS,
      label: 'pollQRStatus',
    });
    return JSON.parse(rawText) as StatusResponse;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'wait' };
    }
    logger.warn(`pollQRStatus error: ${String(err)}`);
    return { status: 'wait' };
  }
}

export async function resolveCredentials(
  config: ResolvedWeixinIlinkConfig,
): Promise<WeixinIlinkCredentials> {
  const envToken = process.env.WEIXIN_ILINK_TOKEN?.trim() || config.botToken?.trim();
  if (envToken) {
    const stored = loadCredentials(config.name);
    return {
      botToken: envToken,
      ilinkUserId: stored?.ilinkUserId,
      ilinkBotId: stored?.ilinkBotId,
      baseUrl: config.baseUrl ?? stored?.baseUrl ?? DEFAULT_API_BASE_URL,
    };
  }

  const stored = loadCredentials(config.name);
  if (stored?.botToken) {
    return {
      ...stored,
      baseUrl: config.baseUrl ?? stored.baseUrl ?? DEFAULT_API_BASE_URL,
    };
  }

  return loginWithQr(config);
}

export async function loginWithQr(
  config: ResolvedWeixinIlinkConfig,
): Promise<WeixinIlinkCredentials> {
  const apiBaseUrl = config.baseUrl ?? DEFAULT_API_BASE_URL;
  const qr = await fetchQRCode(apiBaseUrl, DEFAULT_ILINK_BOT_TYPE);
  const qrcodeUrl = qr.qrcode_img_content || qr.qrcode;

  logger.info(
    `weixin-ilink QR login for ${config.name}: scan with WeChat ClawBot entry — ${qrcodeUrl.slice(0, 120)}${qrcodeUrl.length > 120 ? '…' : ''}`,
  );

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let currentBaseUrl = apiBaseUrl;

  while (Date.now() < deadline) {
    const status = await pollQRStatus(currentBaseUrl, qr.qrcode);

    if (status.status === 'scaned_but_redirect' && status.redirect_host) {
      currentBaseUrl = status.redirect_host.startsWith('http')
        ? status.redirect_host
        : `https://${status.redirect_host}`;
    }

    if (status.status === 'confirmed' || status.status === 'binded_redirect') {
      if (!status.bot_token && status.status !== 'binded_redirect') {
        throw new Error('扫码成功但未返回 bot_token');
      }
      const creds: WeixinIlinkCredentials = {
        botToken: status.bot_token ?? loadCredentials(config.name)?.botToken ?? '',
        ilinkUserId: status.ilink_user_id,
        ilinkBotId: status.ilink_endpoint_id,
        baseUrl: status.baseurl ?? currentBaseUrl,
      };
      if (!creds.botToken) {
        throw new Error('binded_redirect 但本地无有效 bot_token');
      }
      saveCredentials(config.name, creds);
      return creds;
    }

    if (status.status === 'expired') {
      throw new Error('二维码已过期，请重启 bot 重新登录');
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error('微信扫码登录超时');
}
