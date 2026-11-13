import type { Locale } from 'zhin.js/i18n';
import { messages as t } from './i18n.js';
import type { LoginAssist, LoginAssistEndpointIdentity, LoginAssistType, PendingLoginTaskPayload } from '@zhin.js/core';
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

/** How a login-assist step ended; the endpoint decides whether to retry from it. */
export type IcqqLoginAssistOutcome = 'submitted' | 'failed';

/**
 * Drive ICQQ login challenges through LoginAssist (refresh-safe pending tasks).
 * qrcode/auth → login(); slider → submitSlider.
 *
 * device (设备锁) offers two ways, as ICQQ does: open the URL and verify in mobile QQ, then
 * `login()` again (submit `ok`); or request an SMS code (submit `sms`) and submit it. No SMS is
 * sent unless asked for: an unrequested `sendSmsCode()` can fail the login outright.
 */
export async function runIcqqLoginAssistStep(input: {
  assist: LoginAssist;
  client: IcqqLoginClient;
  adapter: string;
  endpointKey: string;
  owner: object;
  signal?: AbortSignal;
  endpointIdentity?: LoginAssistEndpointIdentity;
  logger: Logger;
  step: LoginAssistType;
  event: unknown;
  locale?: Locale;
}): Promise<IcqqLoginAssistOutcome> {
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
    input.signal?.throwIfAborted();
    const wait = (type: LoginAssistType, body: PendingLoginTaskPayload) =>
      assist.waitForInput(adapter, endpointKey, type, body, { owner, signal: input.signal, endpointIdentity: input.endpointIdentity });

    if (step === 'device') {
      await runDeviceStep({ ...input, wait, payload });
      return 'submitted';
    }

    const value = await wait(step, payload);
    input.signal?.throwIfAborted();
    const text = normalizeSubmitValue(value);

    switch (step) {
      case 'slider':
        await client.submitSlider(text);
        break;
      case 'sms':
        await client.submitSmsCode(text);
        break;
      default:
        await client.login();
        break;
    }
    return 'submitted';
  } catch (error) {
    logger.warn(formatCompact({
      op: 'login_assist_failed',
      endpoint: endpointKey,
      type: step,
      error: error instanceof Error ? error.message : String(error),
    }));
    return 'failed';
  }
}

/** 设备锁: wait for `ok` (verified via the URL → login()) or `sms` (send a code, then submit it). */
async function runDeviceStep(input: {
  client: IcqqLoginClient;
  endpointKey: string;
  logger: Logger;
  signal?: AbortSignal;
  locale?: Locale;
  event: unknown;
  payload: PendingLoginTaskPayload;
  wait: (type: LoginAssistType, body: PendingLoginTaskPayload) => Promise<string | Record<string, unknown>>;
}): Promise<void> {
  const { client, endpointKey, logger, wait } = input;
  let prompt = input.payload;
  for (;;) {
    const choice = deviceChoice(await wait('device', prompt));
    input.signal?.throwIfAborted();
    if (choice === 'continue') {
      await client.login();
      return;
    }
    try {
      await client.sendSmsCode();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(formatCompact({ op: 'login_assist_send_sms_failed', endpoint: endpointKey, error: message }));
      prompt = { ...input.payload, message: t(input.locale, 'loginSmsSendFailed', { error: message }) };
      continue;
    }
    const raw = input.event && typeof input.event === 'object' ? input.event as Record<string, unknown> : {};
    const phone = typeof raw.phone === 'string' && raw.phone ? ` ${raw.phone}` : '';
    const code = normalizeSubmitValue(await wait('sms', { message: t(input.locale, 'loginSms', { phone }), phone: raw.phone }));
    input.signal?.throwIfAborted();
    await client.submitSmsCode(code);
    return;
  }
}

/** `sms` (or `{ action: 'sms' }`) asks for an SMS code; anything else means the URL check is done. */
export function deviceChoice(value: string | Record<string, unknown>): 'sms' | 'continue' {
  const raw = typeof value === 'string' ? value : typeof value.action === 'string' ? value.action : normalizeSubmitValue(value);
  return raw.trim().toLowerCase() === 'sms' ? 'sms' : 'continue';
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
        message: t(locale, 'loginDevice'),
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
  if (typeof value.action === 'string') return value.action.trim();
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
