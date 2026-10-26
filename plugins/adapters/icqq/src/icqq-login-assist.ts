import type { Locale } from 'zhin.js/i18n';
import { messages as t } from './i18n.js';
import type { LoginAssist, LoginAssistType, PendingLoginTaskPayload } from '@zhin.js/core';
import { formatCompact } from '@zhin.js/logger';

type IcqqLoginClient = {
  login(password?: string): Promise<unknown>;
  submitSlider(ticket: string): Promise<unknown>;
  sendSmsCode(): Promise<unknown>;
  submitSmsCode(code: string): Promise<unknown>;
};

type Logger = {
  info(message: string): void;
  warn(message: string): void;
};

/**
 * Drive ICQQ login challenges through LoginAssist (refresh-safe pending tasks).
 * Mirrors the classic stdin flow: qrcode/auth → login(); slider → submitSlider;
 * device → sendSmsCode then submitSmsCode.
 */
export async function runIcqqLoginAssistStep(input: {
  assist: LoginAssist;
  client: IcqqLoginClient;
  adapter: string;
  endpointKey: string;
  owner: object;
  logger: Logger;
  step: LoginAssistType;
  event: unknown;
  locale?: Locale;
}): Promise<void> {
  const { assist, client, adapter, endpointKey, owner, logger, step, event } = input;
  assist.cancelOwned(owner, `replaced_by_${step}`);

  const payload = buildPayload(step, event, input.locale);
  logger.info(formatCompact({
    op: 'login_assist_pending',
    endpoint: endpointKey,
    type: step,
    message: payload.message,
    ...(typeof payload.url === 'string' ? { url: payload.url } : {}),
  }));

  try {
    if (step === 'device') {
      try {
        await client.sendSmsCode();
      } catch (error) {
        logger.warn(formatCompact({
          op: 'login_assist_send_sms_failed',
          endpoint: endpointKey,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }

    const value = await assist.waitForInput(adapter, endpointKey, step, payload, { owner });
    const text = normalizeSubmitValue(value);

    switch (step) {
      case 'qrcode':
      case 'auth':
        await client.login();
        break;
      case 'slider':
        await client.submitSlider(text);
        break;
      case 'device':
      case 'sms':
        await client.submitSmsCode(text);
        break;
      default:
        await client.login();
        break;
    }
  } catch (error) {
    logger.warn(formatCompact({
      op: 'login_assist_failed',
      endpoint: endpointKey,
      type: step,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

function buildPayload(step: LoginAssistType, event: unknown, locale?: Locale): PendingLoginTaskPayload {
  const raw = event && typeof event === 'object' ? event as Record<string, unknown> : {};
  switch (step) {
    case 'qrcode':
      return {
        message: t(locale, 'loginQr'),
        image: bufferToDataUrl(raw.image),
      };
    case 'slider':
      return {
        message: t(locale, 'loginSlider'),
        url: typeof raw.url === 'string' ? raw.url : undefined,
      };
    case 'device':
      return {
        message: t(locale, 'loginSms'),
        url: typeof raw.url === 'string' ? raw.url : undefined,
        phone: raw.phone,
      };
    case 'auth':
      return {
        message: t(locale, 'loginAuth'),
        url: typeof raw.url === 'string' ? raw.url : undefined,
        device: raw.device,
      };
    default:
      return { message: t(locale, 'loginOther', { step }) };
  }
}

function normalizeSubmitValue(value: string | Record<string, unknown>): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value.ticket === 'string') return value.ticket.trim();
  if (typeof value.code === 'string') return value.code.trim();
  if (typeof value.value === 'string') return value.value.trim();
  return JSON.stringify(value);
}

function bufferToDataUrl(image: unknown): string | undefined {
  if (Buffer.isBuffer(image)) {
    return `data:image/png;base64,${image.toString('base64')}`;
  }
  if (image instanceof Uint8Array) {
    return `data:image/png;base64,${Buffer.from(image).toString('base64')}`;
  }
  if (typeof image === 'string' && image.trim()) return image.trim();
  return undefined;
}
