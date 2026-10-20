/**
 * 微信 iLink（ClawBot）扫码登录流程 — 向导内联实现。
 * 协议与 plugins/adapters/weixin-ilink/src/login.ts 一致（SSOT），
 * 此处复制最小 HTTP 面，避免向导在适配器包安装前产生依赖。
 */

export interface IlinkQrLoginResult {
  readonly botToken: string;
  readonly ilinkUserId?: string;
  readonly ilinkBotId?: string;
  readonly baseUrl: string;
}

interface QrCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

type QrStatus =
  | 'wait'
  | 'scaned'
  | 'confirmed'
  | 'expired'
  | 'scaned_but_redirect'
  | 'need_verifycode'
  | 'verify_code_blocked'
  | 'binded_redirect';

interface StatusResponse {
  status: QrStatus;
  bot_token?: string;
  ilink_endpoint_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
}

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
const DEFAULT_BOT_TYPE = '3';
const POLL_INTERVAL_MS = 500;
const QR_LONG_POLL_TIMEOUT_MS = 35_000;

export interface IlinkQrLoginOptions {
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /** 拿到二维码内容（URL）后回调，由调用方负责展示（终端 QR / 链接）。 */
  readonly onQrCode: (url: string) => void | Promise<void>;
  /** 扫码状态变化提示（scaned → 已扫码待确认）。 */
  readonly onStatus?: (status: QrStatus) => void;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

export class IlinkQrLoginError extends Error {
  constructor(
    message: string,
    readonly reason: 'expired' | 'timeout' | 'network' | 'protocol',
  ) {
    super(message);
    this.name = 'IlinkQrLoginError';
  }
}

/** 与 adapter login.ts 的 buildBaseInfo 对齐的最小结构。 */
function buildBaseInfo(): Record<string, string> {
  return { channel_version: '0.0.0', bot_agent: 'Zhin.js' };
}

/**
 * 微信 iLink 扫码登录：获取二维码 → 展示 → 长轮询直至 confirmed。
 * 成功返回 bot_token 等凭证；过期/超时/网络失败抛 IlinkQrLoginError。
 */
export async function loginWithIlinkQr(options: IlinkQrLoginOptions): Promise<IlinkQrLoginResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const apiBaseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = options.timeoutMs ?? 480_000;

  let qr: QrCodeResponse;
  try {
    const res = await fetchImpl(
      `${apiBaseUrl}/ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(DEFAULT_BOT_TYPE)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ local_token_list: [], base_info: buildBaseInfo() }),
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    qr = await res.json() as QrCodeResponse;
  } catch (error) {
    throw new IlinkQrLoginError(
      `获取登录二维码失败：${error instanceof Error ? error.message : String(error)}`,
      'network',
    );
  }

  const qrcodeUrl = qr.qrcode_img_content || qr.qrcode;
  await options.onQrCode(qrcodeUrl);

  const deadline = Date.now() + timeoutMs;
  let currentBaseUrl = apiBaseUrl;
  let lastStatus: QrStatus | undefined;

  while (Date.now() < deadline) {
    let status: StatusResponse;
    try {
      const res = await fetchImpl(
        `${currentBaseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qr.qrcode)}`,
        { signal: AbortSignal.timeout(QR_LONG_POLL_TIMEOUT_MS) },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      status = await res.json() as StatusResponse;
    } catch {
      // 长轮询超时/瞬断视为继续等待
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (status.status !== lastStatus) {
      lastStatus = status.status;
      options.onStatus?.(status.status);
    }

    if (status.status === 'scaned_but_redirect' && status.redirect_host) {
      currentBaseUrl = status.redirect_host.startsWith('http')
        ? status.redirect_host
        : `https://${status.redirect_host}`;
    }

    if (status.status === 'confirmed' || status.status === 'binded_redirect') {
      if (!status.bot_token) {
        throw new IlinkQrLoginError('扫码成功但未返回 bot_token，请重试或改用手动输入', 'protocol');
      }
      return {
        botToken: status.bot_token,
        ...(status.ilink_user_id ? { ilinkUserId: status.ilink_user_id } : {}),
        ...(status.ilink_endpoint_id ? { ilinkBotId: status.ilink_endpoint_id } : {}),
        baseUrl: status.baseurl ?? currentBaseUrl,
      };
    }

    if (status.status === 'expired') {
      throw new IlinkQrLoginError('二维码已过期', 'expired');
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new IlinkQrLoginError('微信扫码登录超时', 'timeout');
}
