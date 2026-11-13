/**
 * ICQQ login flow driver (ADR 0058 Login Assist v2).
 *
 * One LoginFlow per login attempt: connect → challenge(s) → verifying → online / failed. The SDK's
 * `system.login.*` events open challenges; the person's answer drives the SDK call; the SDK's next
 * event (a new challenge, `system.login.error` or `system.online`) is the result.
 *
 * - qrcode: polls the scan state while the QR code is shown (scanned → info step; confirmed →
 *   continues by itself); "I confirmed" checks the state before logging in.
 * - slider: hosted captcha helper (`media.captcha`) or a pasted ticket / JSON / URL; the NT login
 *   path needs `ticket,randstr`, the legacy wtlogin path the ticket alone.
 * - device: confirm on the phone, or ask for an SMS code (sent only on request).
 * - auth: device JSON + static helper script + verification link, then log in again.
 */
import type { Locale } from 'zhin.js/i18n';
import {
  LoginChallengeReplacedError,
  type LoginAssist,
  type LoginAssistEndpointIdentity,
  type LoginChallengeAnswer,
  type LoginChallengeDescriptor,
  type LoginErrorCode,
  type LoginFlow,
  type LoginNextAction,
  type LoginOutcome,
} from '@zhin.js/core';
import { formatCompact } from '@zhin.js/logger';
import { messages as t } from './i18n.js';
import {
  authDescriptor,
  deviceDescriptor,
  ICQQ_SMS_COOLDOWN_MS,
  qrcodeDescriptor,
  sliderDescriptor,
  smsDescriptor,
} from './icqq-login-descriptors.js';
import {
  classifyIcqqSmsFailure,
  mapIcqqLoginError,
  sanitizeIcqqLoginMessage,
  type IcqqLoginErrorMapping,
} from './icqq-login-errors.js';

/** The SDK surface the driver uses (the Endpoint is the SDK Client). */
export interface IcqqLoginClient {
  login(): Promise<unknown>;
  submitSlider(ticket: string): Promise<unknown>;
  sendSmsCode(): Promise<unknown>;
  submitSmsCode(code: string): Promise<unknown>;
  /** QR scan state; absent on SDK builds without QR login. */
  queryQrcodeResult?(): Promise<{ retcode: number }>;
  qrcodeLogin?(): Promise<unknown>;
  fetchQrcode?(): Promise<unknown>;
  readonly sig?: unknown;
}

type Logger = { info(message: string): void; warn(message: string): void };

export type IcqqChallengeKind = 'qrcode' | 'slider' | 'device' | 'sms' | 'auth';

/** `QrcodeResult` of the SDK. */
export const ICQQ_QR_RESULT = Object.freeze({ ok: 0, timeout: 17, waitingForScan: 48, waitingForConfirm: 53, canceled: 54 });
export const ICQQ_QR_POLL_INTERVAL_MS = 2_000;
/** Expired QR codes replaced without being asked, per flow; then the flow waits for the person. */
export const ICQQ_QR_AUTO_REFRESH_LIMIT = 2;

export interface IcqqLoginDriverOptions {
  readonly assist: LoginAssist;
  readonly client: IcqqLoginClient;
  readonly endpointKey: string;
  readonly owner: object;
  readonly signal?: AbortSignal;
  readonly endpointIdentity?: LoginAssistEndpointIdentity;
  readonly logger: Logger;
  readonly locale?: Locale;
  readonly qrPollIntervalMs?: number;
}

export interface IcqqLoginErrorResult {
  readonly mapping: IcqqLoginErrorMapping;
  /** The attempt had raised a challenge (the error is a verification result). */
  readonly hadChallenge: boolean;
  /** `code_invalid` on a challenge that takes another answer: the challenge was opened again. */
  readonly retrying: boolean;
}

export class IcqqLoginDriver {
  readonly #o: IcqqLoginDriverOptions;
  #flow?: LoginFlow;
  /** Invalidates the running challenge step when a newer event takes over. */
  #token = 0;
  #running = false;
  #last?: { kind: IcqqChallengeKind; event: Record<string, unknown> };
  #qrAutoRefreshes = 0;
  #pollTimer?: ReturnType<typeof setTimeout>;
  #smsSentAt = 0;

  constructor(options: IcqqLoginDriverOptions) {
    this.#o = options;
  }

  /** The live flow of this attempt, if any. */
  get flow(): LoginFlow | undefined {
    return this.#flow && isLive(this.#flow) ? this.#flow : undefined;
  }

  /** Kind of the last challenge this attempt raised. */
  get lastChallenge(): IcqqChallengeKind | undefined {
    return this.#last?.kind;
  }

  /**
   * A person is (or is about to be) answering a challenge of this account: automatic relogin
   * must wait. Covers the step being driven and any active challenge of this Endpoint key.
   */
  get busy(): boolean {
    return this.#running || this.#o.assist.hasActiveChallenge(this.#o.endpointKey, 'icqq');
  }

  /** The attempt ended in a state that waits for the person: failed, or an expired challenge. */
  get awaitingPerson(): boolean {
    const state = this.#flow?.snapshot().state;
    return state === 'failed' || state === 'expired';
  }

  /** Start a new attempt (supersedes the previous flow of this Endpoint instance). */
  begin(title: string | null = t(this.#o.locale, 'loginConnecting')): LoginFlow | undefined {
    this.invalidate();
    if (this.#o.signal?.aborted) return undefined;
    try {
      this.#flow = this.#o.assist.beginFlow({
        adapter: 'icqq', endpointKey: this.#o.endpointKey, owner: this.#o.owner,
        ...(this.#o.signal ? { signal: this.#o.signal } : {}),
        ...(this.#o.endpointIdentity ? { endpointIdentity: this.#o.endpointIdentity } : {}),
      });
    } catch {
      return undefined;
    }
    this.#last = undefined;
    this.#qrAutoRefreshes = 0;
    this.#smsSentAt = 0;
    if (title) this.#flow.step('connect', title);
    return this.#flow;
  }

  /** Another login call inside the current attempt (automatic retry); begins one when none is live. */
  connect(title: string): void {
    const flow = this.flow;
    if (flow) flow.step('connect', title);
    else this.begin(title);
  }

  /** Timeline mark (e.g. a scheduled retry); begins an attempt when none is live. */
  info(text: string): void {
    (this.flow ?? this.begin(null))?.step('info', text);
  }

  outcome(outcome: LoginOutcome): void {
    (this.flow ?? this.begin(null))?.outcome(outcome);
  }

  fail(code: LoginErrorCode, message?: string, next?: LoginNextAction): void {
    this.invalidate();
    (this.flow ?? this.begin(null))?.fail(code, message, next);
  }

  online(): void {
    this.invalidate();
    this.#flow?.online();
    this.#last = undefined;
  }

  /** Stop driving the current step (a newer event, online, error or stop took over). */
  invalidate(): void {
    this.#token += 1;
    this.#running = false;
    this.#stopPoll();
  }

  dispose(): void {
    this.invalidate();
    this.#flow = undefined;
  }

  /** Open a challenge for an SDK event and drive it. */
  challenge(kind: IcqqChallengeKind, event: Record<string, unknown>): void {
    if (this.#o.signal?.aborted) return;
    const flow = this.flow ?? this.begin(null);
    if (!flow) return;
    this.invalidate();
    const token = this.#token;
    this.#running = true;
    this.#last = { kind, event };
    this.#o.logger.info(formatCompact({
      op: 'login_assist_challenge',
      endpoint: this.#o.endpointKey,
      type: kind,
      ...(typeof event.url === 'string' && event.url ? { url: event.url } : {}),
    }));
    void this.#drive(kind, event, token).catch((error: unknown) => {
      if (token !== this.#token) return;
      const message = error instanceof Error ? error.message : String(error);
      this.#o.logger.warn(formatCompact({ op: 'login_assist_failed', endpoint: this.#o.endpointKey, type: kind, error: message }));
      const mapped = mapIcqqLoginError({ message }, this.#o.locale);
      this.#flow?.fail(mapped.code, t(this.#o.locale, 'loginSdkCallFailed', { error: sanitizeIcqqLoginMessage(message) }), mapped.next);
    }).finally(() => {
      if (token === this.#token) this.#running = false;
    });
  }

  /**
   * `system.login.error`: a wrong code / ticket re-opens the same challenge (`retry_input`);
   * otherwise the caller decides between failing the flow and an automatic retry.
   */
  loginError(event: unknown): IcqqLoginErrorResult {
    const mapping = mapIcqqLoginError(event, this.#o.locale);
    const last = this.#last;
    this.invalidate();
    if (mapping.code === 'code_invalid' && last && (last.kind === 'sms' || last.kind === 'slider')) {
      this.outcome({ result: 'rejected', code: 'code_invalid', message: mapping.message, next: 'retry_input' });
      this.challenge(last.kind, last.event);
      return { mapping, hadChallenge: true, retrying: true };
    }
    return { mapping, hadChallenge: !!last, retrying: false };
  }

  /**
   * Refresh the current challenge. Only a QR code can be refreshed in place (a new QR code from the
   * SDK); returns false when the caller should log in again instead.
   */
  async refresh(): Promise<boolean> {
    const client = this.#o.client;
    if (this.#last?.kind !== 'qrcode' || !this.flow || typeof client.fetchQrcode !== 'function') return false;
    this.#flow!.step('info', t(this.#o.locale, 'qrRefreshing'));
    await client.fetchQrcode();
    return true;
  }

  // --------------------------------------------------------------------------

  async #drive(kind: IcqqChallengeKind, event: Record<string, unknown>, token: number): Promise<void> {
    switch (kind) {
      case 'qrcode': return this.#driveQr(event, token);
      case 'slider': return this.#driveSlider(event, token);
      case 'device': return this.#driveDevice(event, token);
      case 'sms': return this.#driveSms(event, token);
      case 'auth': return this.#driveAuth(event, token);
    }
  }

  /** Open a challenge; undefined when it was replaced, cancelled, expired or the Endpoint retired. */
  async #ask(
    token: number,
    descriptor: LoginChallengeDescriptor,
    onOpen?: (taskId: string) => void,
  ): Promise<LoginChallengeAnswer | undefined> {
    const flow = this.#flow;
    if (!flow || token !== this.#token || this.#o.signal?.aborted) return undefined;
    const pending = flow.challenge(descriptor);
    const taskId = flow.snapshot().activeTaskId;
    if (taskId) onOpen?.(taskId);
    try {
      const answer = await pending;
      if (token !== this.#token || this.#o.signal?.aborted) return undefined;
      return answer;
    } catch (error) {
      if (!(error instanceof LoginChallengeReplacedError) && token === this.#token) {
        this.#o.logger.info(formatCompact({
          op: 'login_assist_challenge_ended',
          endpoint: this.#o.endpointKey,
          type: descriptor.kind,
          reason: error instanceof Error ? error.message : String(error),
        }));
      }
      return undefined;
    } finally {
      // A newer challenge owns the poll timer once the token moved on.
      if (token === this.#token) this.#stopPoll();
    }
  }

  #current(token: number): LoginFlow | undefined {
    return token === this.#token && !this.#o.signal?.aborted ? this.#flow : undefined;
  }

  // --- qrcode ---------------------------------------------------------------

  async #driveQr(event: Record<string, unknown>, token: number): Promise<void> {
    let scanned = false;
    const answer = await this.#ask(token, qrcodeDescriptor({ image: bufferToDataUrl(event.image) }, this.#o.locale),
      (taskId) => this.#startQrPoll(token, taskId, () => { scanned = true; }));
    if (!answer) return;
    const client = this.#o.client;
    const canQuery = typeof client.queryQrcodeResult === 'function' && typeof client.qrcodeLogin === 'function';
    if (canQuery && !scanned) {
      let retcode: number;
      try {
        retcode = (await client.queryQrcodeResult!()).retcode;
      } catch {
        retcode = -1;
      }
      const flow = this.#current(token);
      if (!flow) return;
      if (retcode === ICQQ_QR_RESULT.waitingForScan || retcode === ICQQ_QR_RESULT.waitingForConfirm || retcode < 0) {
        const message = retcode === ICQQ_QR_RESULT.waitingForScan ? t(this.#o.locale, 'qrNotScanned')
          : retcode === ICQQ_QR_RESULT.waitingForConfirm ? t(this.#o.locale, 'qrScanned')
            : t(this.#o.locale, 'loginErrorNetwork');
        flow.outcome({ result: 'rejected', ...(retcode < 0 ? { code: 'network' as const } : {}), message, next: 'retry_input' });
        return this.#driveQr(event, token);
      }
      if (retcode !== ICQQ_QR_RESULT.ok) {
        flow.outcome({ result: 'expired', code: 'challenge_expired', message: t(this.#o.locale, 'qrExpired'), next: 'refresh_challenge' });
        await this.#newQr();
        return;
      }
    }
    if (!this.#current(token)) return;
    this.#flow!.verifying(t(this.#o.locale, 'loginVerifying'));
    if (canQuery) await client.qrcodeLogin!();
    else await client.login();
  }

  async #newQr(): Promise<void> {
    const client = this.#o.client;
    if (typeof client.fetchQrcode === 'function') await client.fetchQrcode();
    else await client.login();
  }

  /** Follow the scan while the QR code is shown: scanned → info step; confirmed → continue. */
  #startQrPoll(token: number, taskId: string, confirmed: () => void): void {
    const client = this.#o.client;
    if (typeof client.queryQrcodeResult !== 'function' || typeof client.qrcodeLogin !== 'function') return;
    this.#stopPoll();
    let announced = false;
    const active = () => token === this.#token && !this.#o.signal?.aborted && this.#flow?.snapshot().activeTaskId === taskId;
    const schedule = () => {
      this.#pollTimer = setTimeout(() => { void tick(); }, this.#o.qrPollIntervalMs ?? ICQQ_QR_POLL_INTERVAL_MS);
      this.#pollTimer.unref?.();
    };
    const tick = async () => {
      this.#pollTimer = undefined;
      if (!active()) return;
      let retcode: number | undefined;
      try {
        retcode = (await client.queryQrcodeResult!()).retcode;
      } catch {
        retcode = undefined;
      }
      if (!active()) return;
      const flow = this.#flow!;
      if (retcode === ICQQ_QR_RESULT.ok) {
        confirmed();
        try {
          this.#o.assist.submit(taskId, { action: 'confirm', values: {} }, this.#o.endpointIdentity);
        } catch { /* the challenge ended meanwhile */ }
        return;
      }
      if (retcode === ICQQ_QR_RESULT.waitingForConfirm && !announced) {
        announced = true;
        flow.step('info', t(this.#o.locale, 'qrScanned'));
      }
      if (retcode === ICQQ_QR_RESULT.timeout || retcode === ICQQ_QR_RESULT.canceled) {
        if (this.#qrAutoRefreshes < ICQQ_QR_AUTO_REFRESH_LIMIT) {
          this.#qrAutoRefreshes += 1;
          flow.step('info', t(this.#o.locale, 'qrExpiredRefreshing'));
          void this.#newQr().catch((error: unknown) => {
            this.#o.logger.warn(formatCompact({ op: 'login_assist_qr_refresh_failed', endpoint: this.#o.endpointKey, error: error instanceof Error ? error.message : String(error) }));
          });
          return;
        }
        flow.outcome({ result: 'expired', code: 'challenge_expired', message: t(this.#o.locale, 'qrExpired'), next: 'refresh_challenge' });
        flow.end('expired');
        return;
      }
      schedule();
    };
    schedule();
  }

  #stopPoll(): void {
    if (this.#pollTimer) clearTimeout(this.#pollTimer);
    this.#pollTimer = undefined;
  }

  // --- slider ---------------------------------------------------------------

  async #driveSlider(event: Record<string, unknown>, token: number): Promise<void> {
    const url = typeof event.url === 'string' && event.url ? event.url : undefined;
    // Captured now: the SDK clears its NT captcha state once a ticket was submitted.
    const nt = isNtCaptcha(this.#o.client, url);
    for (;;) {
      const answer = await this.#ask(token, sliderDescriptor(url, this.#o.locale));
      if (!answer) return;
      const flow = this.#flow!;
      const ticket = answer.values.input?.trim();
      const randstr = answer.values.randstr?.trim();
      if (!ticket || (nt && !randstr)) {
        flow.outcome({
          result: 'rejected', code: 'code_invalid', next: 'retry_input',
          message: t(this.#o.locale, ticket ? 'sliderRandstrMissing' : 'loginErrorCodeInvalid'),
        });
        continue;
      }
      flow.verifying(t(this.#o.locale, 'loginVerifyingSlider'));
      await this.#o.client.submitSlider(icqqSliderSubmission({ ticket, randstr }, nt));
      return;
    }
  }

  // --- device / sms ---------------------------------------------------------

  async #driveDevice(event: Record<string, unknown>, token: number): Promise<void> {
    const url = typeof event.url === 'string' && event.url ? event.url : undefined;
    const phone = typeof event.phone === 'string' && event.phone ? event.phone : undefined;
    for (;;) {
      const answer = await this.#ask(token, deviceDescriptor({ url, phone }, this.#o.locale));
      if (!answer) return;
      if (answer.actionId === 'sms') {
        if (!await this.#sendSms(token)) continue;
        if (!this.#current(token)) return;
        this.#last = { kind: 'sms', event };
        return this.#driveSms(event, token);
      }
      this.#flow!.verifying(t(this.#o.locale, 'loginVerifyingDevice'));
      await this.#o.client.login();
      return;
    }
  }

  async #driveSms(event: Record<string, unknown>, token: number): Promise<void> {
    const phone = typeof event.phone === 'string' && event.phone ? event.phone : undefined;
    for (;;) {
      const answer = await this.#ask(token, smsDescriptor({ phone }, this.#o.locale));
      if (!answer) return;
      if (answer.actionId === 'resend') {
        if (await this.#sendSms(token)) this.#current(token)?.step('info', t(this.#o.locale, 'smsResent'));
        continue;
      }
      this.#flow!.verifying(t(this.#o.locale, 'loginVerifyingSms'));
      await this.#o.client.submitSmsCode((answer.values.input ?? '').trim());
      return;
    }
  }

  /** Request an SMS code; a failure (or the cooldown) is reported on the step and returns false. */
  async #sendSms(token: number): Promise<boolean> {
    const waitMs = this.#smsSentAt + ICQQ_SMS_COOLDOWN_MS - Date.now();
    if (this.#smsSentAt > 0 && waitMs > 0) {
      this.#flow?.outcome({
        result: 'rejected', code: 'rate_limited', next: 'wait', retryAfterMs: waitMs,
        message: t(this.#o.locale, 'loginErrorRateLimited'),
      });
      return false;
    }
    try {
      await this.#o.client.sendSmsCode();
      this.#smsSentAt = Date.now();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#o.logger.warn(formatCompact({ op: 'login_assist_send_sms_failed', endpoint: this.#o.endpointKey, error: message }));
      const code = classifyIcqqSmsFailure(error);
      this.#current(token)?.outcome({
        result: 'rejected', code, next: code === 'rate_limited' ? 'wait' : 'retry_input',
        message: t(this.#o.locale, 'smsSendFailed', { error: sanitizeIcqqLoginMessage(message) || t(this.#o.locale, 'loginErrorUnknown') }),
      });
      return false;
    }
  }

  // --- auth -----------------------------------------------------------------

  async #driveAuth(event: Record<string, unknown>, token: number): Promise<void> {
    const url = typeof event.url === 'string' && event.url ? event.url : undefined;
    const answer = await this.#ask(token, authDescriptor({ url, device: event.device }, this.#o.locale));
    if (!answer) return;
    this.#flow!.verifying(t(this.#o.locale, 'loginVerifyingAuth'));
    await this.#o.client.login();
  }
}

function isLive(flow: LoginFlow): boolean {
  const state = flow.snapshot().state;
  return state === 'active' || state === 'expired';
}

/**
 * NT login captcha (`sig.nt_captcha` set for this slider URL): the SDK splits `ticket,randstr`.
 * The legacy wtlogin path puts the raw text into TLV 0x193, so it must get the ticket alone.
 */
export function isNtCaptcha(client: Pick<IcqqLoginClient, 'sig'>, url?: string): boolean {
  const sig = client.sig;
  if (!sig || typeof sig !== 'object') return false;
  const captcha = (sig as { nt_captcha?: unknown }).nt_captcha;
  if (!captcha || typeof captcha !== 'object') return false;
  const captchaUrl = (captcha as { url?: unknown }).url;
  return typeof captchaUrl !== 'string' || !url || captchaUrl === url;
}

/** What `submitSlider` receives: `ticket,randstr` on the NT path, the ticket alone otherwise. */
export function icqqSliderSubmission(value: { ticket: string; randstr?: string }, nt: boolean): string {
  return nt && value.randstr ? `${value.ticket},${value.randstr}` : value.ticket;
}

export function bufferToDataUrl(image: unknown): string | undefined {
  if (Buffer.isBuffer(image)) return `data:image/png;base64,${image.toString('base64')}`;
  if (image instanceof Uint8Array) return `data:image/png;base64,${Buffer.from(image).toString('base64')}`;
  if (typeof image === 'string' && image.trim()) return image.trim();
  return undefined;
}
