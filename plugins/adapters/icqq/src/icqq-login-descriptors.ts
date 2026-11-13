/**
 * Challenge descriptors of the ICQQ login flow (ADR 0058 §2–3).
 *
 * The guidance text lives here (not in the SDK): the Console, the terminal and the QQ-chat
 * commands all render these descriptors. Copy blocks with device data are `sensitive`; the helper
 * script is static text and never contains device or user data.
 */
import type { Locale } from 'zhin.js/i18n';
import type { LoginChallengeDescriptor, LoginHelpStep } from '@zhin.js/core';
import { messages as t } from './i18n.js';

/** Challenge ids are stable per kind so the Console can keep UI state across re-opened challenges. */
export const ICQQ_CHALLENGE_IDS = Object.freeze({
  qrcode: 'icqq-qrcode', slider: 'icqq-slider', device: 'icqq-device', sms: 'icqq-sms', auth: 'icqq-auth',
});

/** SMS resend cooldown (QQ refuses a second code within a minute). */
export const ICQQ_SMS_COOLDOWN_MS = 60_000;

/** Page the `auth` helper script runs on (QQ's "send verification code" page). */
export const ICQQ_AUTH_SCRIPT_HOST = 'accounts.qq.com';
export const ICQQ_AUTH_SCRIPT_PATH = '/login/attack';

export function qrcodeDescriptor(input: { image?: string }, locale?: Locale): LoginChallengeDescriptor {
  return {
    id: ICQQ_CHALLENGE_IDS.qrcode,
    kind: 'qrcode',
    title: t(locale, 'qrTitle'),
    help: {
      short: t(locale, 'qrShort'),
      steps: [t(locale, 'qrStepScan'), t(locale, 'qrStepConfirm'), t(locale, 'qrStepContinue')],
    },
    media: { ...(input.image ? { qrImage: input.image } : {}), refreshable: true },
    actions: [{ id: 'confirm', label: t(locale, 'qrConfirm'), variant: 'primary' }],
  };
}

export function sliderDescriptor(url: string | undefined, locale?: Locale): LoginChallengeDescriptor {
  const query = url ? sliderCaptchaQuery(url) : undefined;
  return {
    id: ICQQ_CHALLENGE_IDS.slider,
    kind: 'slider',
    title: t(locale, 'sliderTitle'),
    help: {
      short: t(locale, 'sliderShort'),
      steps: [
        { text: t(locale, 'sliderStepOpen'), ...(url ? { blockId: 'slider-link', doneWhen: 'opened' as const } : {}) },
        t(locale, 'sliderStepDevtools'),
        t(locale, 'sliderStepCopy'),
      ],
    },
    ...(url ? { blocks: [{ kind: 'link' as const, id: 'slider-link', label: t(locale, 'sliderLink'), url }] } : {}),
    ...(query ? { media: { captcha: { provider: 'tencent' as const, query } } } : {}),
    input: { kind: 'ticket', label: t(locale, 'sliderInput'), extract: 'ticket-json-or-url' },
    actions: [{ id: 'submit', label: t(locale, 'loginSubmit'), variant: 'primary', requiresInput: true }],
  };
}

export function deviceDescriptor(input: { url?: string; phone?: string }, locale?: Locale): LoginChallengeDescriptor {
  const steps: LoginHelpStep[] = [
    input.url ? { text: t(locale, 'deviceStepScan'), blockId: 'verify-link', doneWhen: 'opened' } : t(locale, 'deviceStepNoLink'),
    t(locale, 'deviceStepVerify'),
    t(locale, 'deviceStepContinue'),
  ];
  if (input.phone) steps.push(t(locale, 'deviceStepSms'));
  return {
    id: ICQQ_CHALLENGE_IDS.device,
    kind: 'device',
    title: t(locale, 'deviceTitle'),
    help: { short: t(locale, 'deviceShort'), steps },
    ...(input.url ? { blocks: [{ kind: 'link' as const, id: 'verify-link', label: t(locale, 'deviceLink'), url: input.url, showQr: true }] } : {}),
    actions: [
      { id: 'continue', label: t(locale, 'deviceContinue'), variant: 'primary' },
      // The SDK only reports a phone when SMS verification is possible for this lock.
      ...(input.phone ? [{ id: 'sms', label: t(locale, 'deviceSms'), variant: 'secondary' as const }] : []),
    ],
  };
}

export function smsDescriptor(input: { phone?: string }, locale?: Locale): LoginChallengeDescriptor {
  return {
    id: ICQQ_CHALLENGE_IDS.sms,
    kind: 'sms',
    title: t(locale, 'smsTitle'),
    help: { short: t(locale, 'smsShort', { phone: input.phone || t(locale, 'smsPhoneFallback') }) },
    input: { kind: 'code', label: t(locale, 'smsInput'), length: 6, pattern: '^\\d{6}$', patternHint: t(locale, 'smsHint') },
    actions: [
      { id: 'submit', label: t(locale, 'loginSubmit'), variant: 'primary', requiresInput: true },
      { id: 'resend', label: t(locale, 'smsResend'), variant: 'secondary', cooldownMs: ICQQ_SMS_COOLDOWN_MS },
    ],
  };
}

export function authDescriptor(input: { url?: string; device?: unknown }, locale?: Locale): LoginChallengeDescriptor {
  const deviceJson = formatDeviceJson(input.device);
  const hasLink = !!input.url;
  const steps: LoginHelpStep[] = [];
  if (deviceJson) steps.push({ text: t(locale, 'authStepCopy'), blockId: 'device-json', doneWhen: 'copied' });
  steps.push(hasLink ? { text: t(locale, 'authStepOpen'), blockId: 'verify-link', doneWhen: 'opened' } : t(locale, 'authStepOpen'));
  steps.push(deviceJson ? { text: t(locale, 'authStepScript'), blockId: 'helper-script', doneWhen: 'copied' } : t(locale, 'authStepVerify'));
  steps.push({ text: t(locale, 'authStepContinue'), doneWhen: 'manual' });
  return {
    id: ICQQ_CHALLENGE_IDS.auth,
    kind: 'auth',
    title: t(locale, 'authTitle'),
    help: { short: t(locale, 'authShort'), steps, ...(deviceJson ? { warning: t(locale, 'authWarning') } : {}) },
    blocks: [
      ...(deviceJson ? [{
        kind: 'copy' as const, id: 'device-json', label: t(locale, 'authJson'), content: deviceJson, format: 'json' as const,
        sensitive: true, ...(hasLink ? { thenOpen: 'verify-link' } : {}),
      }] : []),
      ...(hasLink ? [{ kind: 'link' as const, id: 'verify-link', label: t(locale, 'authLink'), url: input.url!, showQr: true }] : []),
      ...(deviceJson ? [{
        kind: 'copy' as const, id: 'helper-script', label: t(locale, 'authScript'), content: icqqAuthHelperScript(locale),
        format: 'script' as const, collapsed: true, collapsedLabel: t(locale, 'authScriptCollapsed'), bookmarklet: true,
      }] : []),
    ],
    actions: [{ id: 'continue', label: t(locale, 'authContinue'), variant: 'primary' }],
  };
}

/** Query string of the slider URL (for the hosted captcha helper), or undefined for a non-http URL. */
export function sliderCaptchaQuery(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    const query = parsed.search.replace(/^\?/u, '');
    return query || undefined;
  } catch {
    return undefined;
  }
}

/** Device information of `system.login.auth` as pretty JSON (string fields only), or undefined. */
export function formatDeviceJson(device: unknown): string | undefined {
  if (!device || typeof device !== 'object' || Array.isArray(device)) return undefined;
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(device as Record<string, unknown>)) {
    if (typeof value === 'string') fields[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) fields[key] = String(value);
  }
  if (typeof fields.guid !== 'string' || !fields.guid) return undefined;
  return JSON.stringify(fields, null, 2);
}

const SCRIPT_TEXT = {
  'zh-CN': {
    wrongPage: '请在 accounts.qq.com/login/attack（发送验证码的页面）运行这段脚本',
    prompt: '粘贴从 Zhin 复制的设备 JSON',
    badJson: '设备 JSON 格式不正确，请重新复制',
    noGuid: '设备 JSON 缺少 guid，请重新复制',
    notReady: '页面还没有加载完成，请刷新后再运行',
    done: '设备信息已写入。请在页面上继续完成验证，完成后回到 Zhin 点「已完成，继续登录」',
  },
  en: {
    wrongPage: 'Run this script on accounts.qq.com/login/attack (the page that sends the verification code)',
    prompt: 'Paste the device JSON copied from Zhin',
    badJson: 'The device JSON is not valid. Copy it again',
    noGuid: 'The device JSON has no guid. Copy it again',
    notReady: 'The page has not finished loading. Reload it and run the script again',
    done: 'Device information set. Finish the verification on the page, then choose “Done, continue logging in” in Zhin',
  },
} as const;

/**
 * Static helper script for the `auth` challenge. It runs only on the QQ verification page, asks for
 * the device JSON with `prompt()`, checks it, sets `window.__INITIAL_STATE__.deviceInfo` and reports
 * the result. It never submits anything and contains no device or user data. No `//` comments: the
 * same text becomes a one-line bookmarklet.
 */
export function icqqAuthHelperScript(locale?: Locale): string {
  const text = SCRIPT_TEXT[locale === 'en' ? 'en' : 'zh-CN'];
  const s = (value: string) => JSON.stringify(value);
  return [
    '(function () {',
    `  if (location.hostname !== ${s(ICQQ_AUTH_SCRIPT_HOST)} || location.pathname !== ${s(ICQQ_AUTH_SCRIPT_PATH)}) {`,
    `    alert(${s(text.wrongPage)});`,
    '    return;',
    '  }',
    `  var raw = prompt(${s(text.prompt)});`,
    '  if (!raw) return;',
    '  var info;',
    '  try { info = JSON.parse(raw); } catch (error) {',
    `    alert(${s(text.badJson)});`,
    '    return;',
    '  }',
    "  if (!info || typeof info !== 'object' || typeof info.guid !== 'string' || !info.guid) {",
    `    alert(${s(text.noGuid)});`,
    '    return;',
    '  }',
    '  var state = window.__INITIAL_STATE__;',
    "  if (!state || typeof state !== 'object') {",
    `    alert(${s(text.notReady)});`,
    '    return;',
    '  }',
    '  state.deviceInfo = info;',
    `  alert(${s(text.done)});`,
    '})();',
  ].join('\n');
}
