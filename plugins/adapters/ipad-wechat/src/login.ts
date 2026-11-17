/**
 * Reports the SDK's login progress to Zhin LoginAssist (Console "登录" panel).
 *
 * The SDK drives the whole login itself (QR polling, NewInit, restore), so the
 * challenges opened here only show material; nobody's answer is needed and the
 * answer promise is ignored. Without a LoginAssist (tests, plain CLI) every call
 * is a no-op and the QR code is still written to disk by the Client.
 */
import type { LoginAssist, LoginAssistEndpointIdentity, LoginErrorCode, LoginFlow } from '@zhin.js/core';
import { ADAPTER_KEY } from './protocol.js';

export interface IpadWechatLoginReporterOptions {
  readonly assist?: LoginAssist;
  readonly endpointKey: string;
  readonly signal?: AbortSignal;
  readonly endpointIdentity?: LoginAssistEndpointIdentity;
}

export class IpadWechatLoginReporter {
  readonly #options: IpadWechatLoginReporterOptions;
  readonly #owner = Object.freeze({});
  #flow?: LoginFlow;

  constructor(options: IpadWechatLoginReporterOptions) { this.#options = options; }

  #current(): LoginFlow | undefined {
    const { assist, signal } = this.#options;
    if (!assist || signal?.aborted) return undefined;
    this.#flow ??= assist.beginFlow({
      adapter: ADAPTER_KEY, endpointKey: this.#options.endpointKey, owner: this.#owner,
      ...(signal ? { signal } : {}),
      ...(this.#options.endpointIdentity ? { endpointIdentity: this.#options.endpointIdentity } : {}),
    });
    return this.#flow;
  }

  connecting(): void { this.#current()?.step('connect', '正在连接微信'); }

  qrCode(png: Uint8Array): void {
    const flow = this.#current();
    if (!flow) return;
    const image = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
    void flow.challenge({
      kind: 'qrcode',
      title: '微信扫码登录',
      help: {
        short: '用手机微信扫描二维码，并在手机上确认登录。',
        steps: ['打开手机微信，扫描二维码', '在手机上点「登录」确认', '确认后会自动继续，无需在此操作'],
      },
      media: { qrImage: image },
      actions: [],
    }, { timeoutMs: 0 }).catch(() => undefined);
  }

  qrStatus(phase: string): void {
    if (phase === 'scanned') this.#current()?.step('info', '已扫码，请在手机上确认登录');
    else if (phase === 'confirmed') this.#current()?.verifying('已确认，正在登录');
  }

  verification(url: string): void {
    const flow = this.#current();
    if (!flow) return;
    void flow.challenge({
      kind: 'link_verify',
      title: '微信设备验证',
      help: {
        short: '微信要求验证这台新设备。用手机打开验证页面并按提示完成。',
        steps: [{ text: '用手机打开验证页面（可扫下方二维码）', blockId: 'verify-link', doneWhen: 'opened' }, '按页面提示完成滑块或人脸验证', '完成后会自动继续登录'],
        warning: '验证链接只属于本次登录，不要转发给他人。',
      },
      blocks: [{ kind: 'link', id: 'verify-link', label: '打开验证页面', url, showQr: true }],
      actions: [],
    }, { timeoutMs: 0 }).catch(() => undefined);
  }

  online(): void {
    this.#flow?.online();
    this.#flow = undefined;
  }

  fail(code: LoginErrorCode, message: string): void {
    const flow = this.#flow ?? this.#current();
    flow?.fail(code, message);
    this.#flow = undefined;
  }

  dispose(): void {
    this.#options.assist?.cancelOwned(this.#owner, 'endpoint_stopped');
    this.#flow = undefined;
  }
}

/** LoginAssist error code for a finite SDK login status. */
export function loginErrorCode(status: string): LoginErrorCode {
  switch (status) {
    case 'expired': case 'timeout': return 'challenge_expired';
    case 'risk': return 'risk_blocked';
    case 'rejected': case 'qr_rejected': case 'trust_rejected': case 'init_rejected': return 'credential_invalid';
    default: return 'unknown';
  }
}
