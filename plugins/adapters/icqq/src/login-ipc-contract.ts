/**
 * ICQQ 登录 IPC 契约（与 @icqqjs/cli / @icqqjs/icqq 对齐）
 *
 * **推送（Daemon → Client）** — 见 @icqqjs/cli `src/daemon/protocol.ts` 的 `IpcEvent`：
 * ```json
 * { "id": "*", "event": "system.login.auth", "data": { "url", "device" } }
 * ```
 * 事件名与载荷形状以 @icqqjs/icqq `EventMap` 为准（非 OneBot `post_type`）。
 *
 * **续传（Client → Daemon）** — 与 CLI `LoginFlow` / `AccountBootstrap` 对 icqq Client 的调用一致，
 * action 名为 Client 方法的 snake_case；收录于守护进程 `action-catalog` 后可通过 IPC invoke。
 *
 * @see https://github.com/icqqjs/cli/blob/master/src/daemon/protocol.ts
 * @see https://github.com/icqqjs/cli/blob/master/src/lib/account-bootstrap.ts
 * @see https://github.com/icqqjs/cli/blob/master/src/components/LoginFlow.tsx
 */

/** system.login.auth 等设备指纹（@icqqjs/icqq EventMap） */
export interface IcqqLoginDeviceInfo {
  guid?: string;
  qimei?: string;
  qimei36?: string;
  subappid?: string;
  platform?: string;
  brand?: string;
  model?: string;
  bssid?: string;
  devInfo?: string;
  sysVersion?: string;
}

/** 登录续传 IPC action（与 LoginFlow → Client 方法一一对应） */
export const LoginIpcActions = {
  /** 扫码确认 / 设备锁链接确认 / auth 237 验证完成后继续 — client.login() */
  LOGIN: 'login',
  /** 滑块 ticket — client.submitSlider(ticket) */
  SUBMIT_SLIDER: 'submit_slider',
  /** 设备锁短信验证码 — client.submitSmsCode(code) */
  SUBMIT_SMS_CODE: 'submit_sms_code',
  /** 请求发送设备锁短信 — client.sendSmsCode() */
  SEND_SMS_CODE: 'send_sms_code',
} as const;

export type LoginIpcAction = (typeof LoginIpcActions)[keyof typeof LoginIpcActions];

/** CLI LoginFlow 237 验证步骤（供 Web 控制台展示） */
export const AUTH_DEVICE_STEPS = [
  '打开上方验证链接，正常完成验证流程，直到发送完验证码，不要点击「我已发送」',
  '复制下方 JS，打开浏览器开发者工具（F12）→ Console，粘贴并回车',
  '在弹窗中粘贴设备信息 JSON 并确认（可使用下方单行 JSON）',
  '回到验证页点击「我已发送」，完成 237 验证后回到控制台点击确认',
] as const;
