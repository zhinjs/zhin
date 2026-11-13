/**
 * `icqq login` recovery commands.
 *
 * They are registered by the ICQQ plugin but can be invoked from any connected
 * adapter (typically the QQ instance that delivered the outage notice), so the
 * owner can fetch the QR image and confirm/send verification codes without the
 * Console or terminal.
 */
import { LoginSubmissionError, type LoginChallenge, type LoginChallengeBlock } from '@zhin.js/core';
import { icqqLoginControls, type IcqqLoginControl } from '../../../src/icqq-login-control.js';

export { icqqLoginControls };

/** The challenge this account is waiting on (ADR 0058 login flow), with its task id. */
export function activeIcqqChallenge(control: IcqqLoginControl): { taskId: string; challenge: LoginChallenge } | undefined {
  const flow = control.flow();
  const taskId = flow?.activeTaskId;
  const challenge = taskId ? flow?.steps.find((step) => step.taskId === taskId)?.challenge : undefined;
  return taskId && challenge ? { taskId, challenge } : undefined;
}

/** Links of a challenge (link blocks first, then `media.link`), deduplicated. */
export function challengeLinks(challenge: LoginChallenge): { label: string; url: string }[] {
  const links = (challenge.blocks ?? [])
    .filter((block): block is Extract<LoginChallengeBlock, { kind: 'link' }> => block.kind === 'link')
    .map((block) => ({ label: block.label, url: block.url }));
  if (challenge.media?.link && !links.some((link) => link.url === challenge.media!.link!.url)) links.push(challenge.media.link);
  return links;
}

/** Submit through the control; an answer that does not fit the challenge returns its reason. */
export function submitIcqqAnswer(control: IcqqLoginControl, taskId: string, value: string | Record<string, unknown>):
  { ok: true } | { ok: false; error?: string } {
  try {
    return control.submit(taskId, value) ? { ok: true } : { ok: false };
  } catch (error) {
    if (error instanceof LoginSubmissionError) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * Operator = a **global** chat-role `owner` (ADR 0056 §2: the command reaches an ICQQ account from
 * any adapter, so a conversation / account owner elsewhere does not qualify), or the configured
 * outage-notify conversation id(s).
 */
export function isIcqqLoginOperator(config: unknown, input: unknown): boolean {
  const cfg = (config ?? {}) as {
    notify?: { id?: unknown };
    endpoints?: readonly { notify?: { id?: unknown } }[];
  };
  const sender = (input as { sender?: { id?: unknown; chatRole?: unknown; chatRoleLevels?: { owner?: unknown } } } | null | undefined)?.sender;
  const senderId = (typeof sender === 'object' && sender?.id) ? String(sender.id).trim() : '';
  if (!senderId) return false;
  if (sender?.chatRole === 'owner' && sender.chatRoleLevels?.owner === 'global') return true;
  const targets = new Set<string>();
  const collect = (value: unknown) => {
    if (value === undefined || value === null) return;
    const text = String(value).trim();
    if (text) targets.add(text);
  };
  collect(cfg.notify?.id);
  if (Array.isArray(cfg.endpoints)) {
    for (const endpoint of cfg.endpoints) collect(endpoint.notify?.id);
  }
  // Login control is account-sensitive: without an owner or a notify target, chat recovery is
  // refused and left to the authenticated Console page.
  return targets.has(senderId);
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
  return '仅 owner（聊天角色）或 notify 目标账号可以操作 ICQQ 登录';
}

export function pendingTaskLabel(type: string): string {
  switch (type) {
    case 'qrcode': return '二维码';
    case 'slider': return '滑块验证';
    case 'device': return '设备锁验证';
    case 'sms': return '短信验证码';
    case 'auth': return '身份验证';
    default: return '登录验证';
  }
}

/** Chat command that answers each challenge kind. */
export function challengeCommandHint(kind: string, endpointId: string): string {
  switch (kind) {
    case 'qrcode': return `二维码：\`icqq login qr ${endpointId}\`；扫码并在手机上确认后会自动继续，没有继续时回复 \`icqq login confirm ${endpointId}\`。`;
    case 'slider': return `完成滑块后回复 \`icqq login code ${endpointId} <ticket>\`（也可以粘贴整段响应 JSON）；Console 的验证码辅助页可以一键完成。`;
    case 'device': return `在手机完成验证后回复 \`icqq login confirm ${endpointId}\`；改用短信验证码回复 \`icqq login code ${endpointId} sms\`。`;
    case 'sms': return `回复 \`icqq login code ${endpointId} <6 位验证码>\`；重新发送回复 \`icqq login code ${endpointId} resend\`。`;
    case 'auth': return `身份验证需要复制设备信息到验证页，请在 Console 的 ICQQ 页面按步骤完成；完成后回复 \`icqq login confirm ${endpointId}\`。`;
    default: return `回复 \`icqq login code ${endpointId} <内容>\`。`;
  }
}
