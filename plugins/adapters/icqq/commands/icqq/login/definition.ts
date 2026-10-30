/**
 * `icqq login` recovery commands.
 *
 * They are registered by the ICQQ plugin but can be invoked from any connected
 * adapter (typically the QQ instance that delivered the outage notice), so the
 * master can fetch the QR image and confirm/send verification codes without the
 * Console or terminal.
 */
import type { IcqqLoginControl } from '../../../src/icqq-login-control.js';

/** Master = framework master(s), or the configured outage-notify conversation id(s). */
export function isIcqqLoginOperator(config: unknown, input: unknown): boolean {
  const cfg = (config ?? {}) as {
    master?: unknown;
    notify?: { id?: unknown };
    endpoints?: readonly { master?: unknown; notify?: { id?: unknown } }[];
  };
  const masters = new Set<string>();
  const collect = (value: unknown) => {
    if (value === undefined || value === null) return;
    const text = String(value).trim();
    if (text) masters.add(text);
  };
  collect(cfg.master);
  collect(cfg.notify?.id);
  if (Array.isArray(cfg.endpoints)) {
    for (const endpoint of cfg.endpoints) {
      collect(endpoint.master);
      collect(endpoint.notify?.id);
    }
  }
  // Login control is account-sensitive: without an explicit master/notify target,
  // refuse chat recovery and leave it to the authenticated Console page.
  if (masters.size === 0) return false;
  const senderRaw = (input as { sender?: { id?: unknown } } | null | undefined)?.sender;
  const senderId = (typeof senderRaw === 'object' && senderRaw?.id) ? String(senderRaw.id).trim() : '';
  return senderId !== '' && masters.has(senderId);
}

export function pickIcqqLoginControl(
  controls: ReadonlyMap<string, IcqqLoginControl>,
  requested?: string,
): { control?: IcqqLoginControl; text?: string } {
  const wanted = requested?.trim();
  if (wanted) {
    const control = controls.get(wanted);
    return control ? { control } : { text: `找不到 ICQQ endpoint「${wanted}」` };
  }
  if (controls.size === 0) return { text: 'ICQQ 适配器还没有启动' };
  if (controls.size === 1) {
    const control = [...controls.values()][0];
    return control ? { control } : { text: 'ICQQ 适配器还没有启动' };
  }
  return { text: `有多个 ICQQ endpoint，请指定 QQ 号：${[...controls.keys()].join('、')}` };
}

export function icqqLoginForbidden(): string {
  return '仅 master 或 notify 目标账号可以操作 ICQQ 登录';
}

export function pendingTaskLabel(type: string): string {
  switch (type) {
    case 'qrcode': return '二维码';
    case 'slider': return '滑块验证';
    case 'device': return '设备确认';
    case 'sms': return '短信验证';
    case 'auth': return '登录确认';
    default: return '登录验证';
  }
}
