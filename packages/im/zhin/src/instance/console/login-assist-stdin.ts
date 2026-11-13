import type {
  LoginAssist,
  LoginChallenge,
  LoginChallengeBlock,
  LoginFlowSnapshot,
  LoginOutcome,
  LoginStep,
} from '@zhin.js/core';
import { formatCompact, getLogger } from '@zhin.js/logger';

const logger = getLogger('login-assist');

/** Line printed under a login challenge (whole line: the gateway forwards output line by line). */
export const LOGIN_ASSIST_PROMPT = '> 请在下方输入后回车（或在 Console 中提交）';

/** Terminal side of the consumer; lets tests drive it without a TTY. */
export interface LoginAssistTerminalIo {
  /** Writes one or more whole lines (each ends with `\n`). */
  write(text: string): void;
  /** Delivers each line typed by the person; returns unsubscribe. */
  onLine(listener: (line: string) => void): () => void;
}

/**
 * Interactive TTY consumer for LoginAssist (ADR 0058).
 * Non-TTY (daemon / CI) skips; Console RPC `login.submit` remains the other consumer.
 */
export function bindLoginAssistStdin(assist: LoginAssist): () => void {
  if (!process.stdin.isTTY) return () => {};
  return bindLoginAssistTerminal(assist, {
    write: (text) => { process.stderr.write(text); },
    onLine: (listener) => {
      const onData = (chunk: Buffer | string) => {
        for (const line of chunk.toString().split(/\r?\n/u).slice(0, -1)) listener(line);
      };
      process.stdin.on('data', onData);
      return () => { process.stdin.off('data', onData); };
    },
  });
}

interface PrintedFlow {
  readonly revision: number;
  readonly steps: ReadonlyMap<string, string>;
  readonly state: LoginFlowSnapshot['state'];
  readonly pendingConfirmation: boolean;
  readonly promptedTask?: string;
}

/** One menu entry of the active challenge: a real action, or a local "show sensitive block" entry. */
type MenuEntry =
  | { readonly kind: 'action'; readonly id: string; readonly label: string; readonly requiresInput: boolean }
  | { readonly kind: 'reveal'; readonly id: string; readonly label: string; readonly content: string };

/**
 * Prints one timeline line per change of every login flow and routes typed lines to the active
 * challenge of the flow that asked last (no FIFO). With an input field a plain line is the input;
 * `#2` / `/resend` choose an action. Without one, `2`, `resend` or Enter (primary) choose.
 * Submitted values and sensitive material never reach the logger.
 */
export function bindLoginAssistTerminal(assist: LoginAssist, io: LoginAssistTerminalIo): () => void {
  const printed = new Map<string, PrintedFlow>();
  let focus: LoginFlowSnapshot | undefined;
  let closed = false;

  const write = (lines: readonly string[]) => {
    if (!closed && lines.length > 0) io.write(lines.map((line) => `${line}\n`).join(''));
  };

  const activeChallenge = (flow: LoginFlowSnapshot | undefined): { step: LoginStep; challenge: LoginChallenge } | undefined => {
    if (!flow?.activeTaskId) return undefined;
    const step = flow.steps.find((item) => item.taskId === flow.activeTaskId && item.challenge);
    return step?.challenge ? { step, challenge: step.challenge } : undefined;
  };

  const latest = new Map<string, LoginFlowSnapshot>();
  const onFlow = (flow: LoginFlowSnapshot) => {
    const previous = printed.get(flow.id);
    if (previous && previous.revision >= flow.revision) return;
    write(timelineLines(flow, previous));
    const active = activeChallenge(flow);
    let promptedTask = previous?.promptedTask;
    if (active && flow.activeTaskId !== previous?.promptedTask) {
      focus = flow;
      promptedTask = flow.activeTaskId;
      write(challengeLines(flow, active.challenge));
      logger.info(formatCompact({
        op: 'login_assist_stdin',
        flow: flow.id,
        adapter: flow.adapter,
        endpoint: flow.endpointKey,
        challenge: active.challenge.kind,
        title: active.challenge.title,
      }));
    } else if (focus?.id === flow.id) {
      focus = flow;
    }
    if (!flow.activeTaskId && focus?.id === flow.id) {
      // Focus moves to another flow that still waits, if any.
      focus = [...latest.values()].find((item) => item.id !== flow.id && item.activeTaskId);
    }
    latest.set(flow.id, flow);
    printed.set(flow.id, {
      revision: flow.revision,
      steps: new Map(flow.steps.map((step) => [step.id, stepSignature(step)])),
      state: flow.state,
      pendingConfirmation: !!flow.pendingConfirmation,
      ...(promptedTask ? { promptedTask } : {}),
    });
  };

  const onLine = (raw: string) => {
    const flow = focus;
    const active = activeChallenge(flow);
    if (!flow || !active) {
      logger.debug(formatCompact({ op: 'login_assist_stdin_miss', hint: 'no active login challenge' }));
      return;
    }
    const { challenge } = active;
    const menu = menuOf(challenge);
    const line = raw.trim();
    const hasInput = !!challenge.input && challenge.input.kind !== 'none';
    const pick = (token: string): MenuEntry | undefined => {
      const index = /^\d+$/u.test(token) ? Number(token) - 1 : -1;
      return menu[index] ?? menu.find((entry) => entry.id === token);
    };
    let entry: MenuEntry | undefined;
    let input = '';
    const explicit = /^[#/](\S+)(?:\s+(.*))?$/u.exec(line);
    if (explicit) {
      entry = pick(explicit[1]!);
      input = explicit[2]?.trim() ?? '';
    } else if (hasInput) {
      entry = menu.find((item) => item.kind === 'action' && item.requiresInput) ?? menu[0];
      input = line;
    } else {
      entry = line ? pick(line) : menu.find((item) => item.kind === 'action');
    }
    if (!entry) {
      write([`${prefix(flow)} 无此操作：请输入编号或操作 id`]);
      return;
    }
    if (entry.kind === 'reveal') {
      // Explicit request only; written to the terminal, never to the logger.
      write([`${prefix(flow)} ${entry.label}：`, ...entry.content.split(/\r?\n/u)]);
      return;
    }
    try {
      const ok = assist.submit(flow.activeTaskId!, {
        action: entry.id,
        values: entry.requiresInput || (hasInput && input) ? { input } : {},
      }, flow.endpointIdentity);
      if (!ok) {
        logger.debug(formatCompact({ op: 'login_assist_stdin_miss', flow: flow.id, hint: 'challenge already answered (Console submit?)' }));
      }
    } catch (error) {
      write([`${prefix(flow)} ✗ ${error instanceof Error ? error.message : String(error)}`]);
    }
  };

  const unsubFlow = assist.subscribe('endpoint.login.flow', onFlow);
  const unsubLine = io.onLine(onLine);
  return () => {
    closed = true;
    printed.clear();
    latest.clear();
    focus = undefined;
    unsubFlow();
    unsubLine();
  };
}

function prefix(flow: LoginFlowSnapshot): string {
  return `[${flow.adapter}/${flow.endpointKey}]`;
}

function stepSignature(step: LoginStep): string {
  return `${step.status}|${step.title}|${step.outcome?.result ?? ''}|${step.outcome?.code ?? ''}`;
}

const STATUS_MARK: Readonly<Record<LoginStep['status'], string>> = {
  active: '…', done: '✓', failed: '✗', skipped: '↷',
};

const CODE_TEXT: Readonly<Record<string, string>> = {
  code_invalid: '验证码错误，请重新输入',
  rate_limited: '操作太频繁，请稍后再试',
  challenge_expired: '验证已过期',
  risk_blocked: '账号存在风险，平台拒绝登录',
  credential_invalid: '凭据无效',
  network: '网络错误',
  unknown: '登录失败',
};

function outcomeText(outcome: LoginOutcome): string {
  if (outcome.message) return outcome.message;
  if (outcome.code) return CODE_TEXT[outcome.code] ?? outcome.code;
  switch (outcome.result) {
    case 'accepted': return '已通过';
    case 'online': return '已上线';
    case 'expired': return '已过期';
    case 'needs_new_challenge': return '需要新的验证';
    default: return outcome.result;
  }
}

/** One line per changed step; a submitted challenge and its new verifying step share one line. */
function timelineLines(flow: LoginFlowSnapshot, previous: PrintedFlow | undefined): string[] {
  const lines: string[] = [];
  const total = flow.steps.length;
  const changed = (step: LoginStep) => previous?.steps.get(step.id) !== stepSignature(step);
  const attempt = flow.attempt > 1 ? `（第 ${flow.attempt} 次）` : '';
  for (let index = 0; index < flow.steps.length; index += 1) {
    const step = flow.steps[index]!;
    if (!changed(step)) continue;
    const next = flow.steps[index + 1];
    let line = `${prefix(flow)} ${index + 1}/${total} ${step.title} ${STATUS_MARK[step.status]}`;
    if (step.kind === 'challenge' && step.status === 'done' && next?.kind === 'verifying' && changed(next) && next.status === 'active') {
      lines.push(`${line} 已提交 → ${next.title}`);
      index += 1;
      continue;
    }
    if (step.kind === 'challenge' && step.status === 'skipped') line += ' 已替换';
    if (step.outcome && step.outcome.result !== 'online') line += ` ${outcomeText(step.outcome)}`;
    if (step.status === 'failed' && flow.attempt > 1) line += attempt;
    lines.push(line);
  }
  if (flow.pendingConfirmation && !previous?.pendingConfirmation) {
    lines.push(`${prefix(flow)} … 结果待确认（可能需要在手机上确认，或稍后在 Console 查看）`);
  }
  if (flow.state !== previous?.state) {
    if (flow.state === 'online') lines.push(`${prefix(flow)} ✓ 已上线`);
    else if (flow.state === 'failed') lines.push(`${prefix(flow)} ✗ 登录失败：${flow.lastOutcome ? outcomeText(flow.lastOutcome) : '未知原因'}${attempt}`);
    else if (flow.state === 'cancelled' && previous) lines.push(`${prefix(flow)} 已取消`);
    else if (flow.state === 'expired') lines.push(`${prefix(flow)} ⌛ 验证已过期`);
  }
  return lines;
}

function menuOf(challenge: LoginChallenge): MenuEntry[] {
  const menu: MenuEntry[] = challenge.actions.map((action) => ({
    kind: 'action', id: action.id, label: action.label, requiresInput: !!action.requiresInput,
  }));
  for (const block of challenge.blocks ?? []) {
    if (block.kind === 'copy' && block.sensitive && !block.redacted && block.content) {
      menu.push({ kind: 'reveal', id: `show-${block.id}`, label: `显示${block.label}`, content: block.content });
    }
  }
  return menu;
}

function blockLines(block: LoginChallengeBlock): string[] {
  switch (block.kind) {
    case 'note':
      return [`${block.tone === 'warning' ? '⚠ ' : ''}${block.text}`];
    case 'link':
      return [`${block.label}：${block.url}`];
    case 'copy':
      if (block.sensitive) return [`${block.label}：已隐藏（选择「显示${block.label}」查看）`];
      if (block.collapsed) return [`${block.collapsedLabel ?? block.label}（内容较长，请在 Console 复制）`];
      return [`${block.label}：`, ...block.content.split(/\r?\n/u)];
  }
}

function challengeLines(flow: LoginFlowSnapshot, challenge: LoginChallenge): string[] {
  const lines = [`${prefix(flow)} ${challenge.title}`];
  if (challenge.help?.short) lines.push(challenge.help.short);
  (challenge.help?.steps ?? []).forEach((step, index) => {
    lines.push(`  ${index + 1}. ${typeof step === 'string' ? step : step.text}`);
  });
  if (challenge.help?.warning) lines.push(`⚠ ${challenge.help.warning}`);
  for (const block of challenge.blocks ?? []) lines.push(...blockLines(block));
  if (challenge.media?.link) lines.push(`${challenge.media.link.label === challenge.media.link.url ? '链接' : challenge.media.link.label}：${challenge.media.link.url}`);
  if (challenge.media?.qrImage) lines.push('二维码请在 Console 中查看（或使用适配器打印的终端二维码）');
  if (challenge.media?.captcha) lines.push('也可以在 Console 中打开验证码辅助页一键完成，无需开发者工具');
  const menu = menuOf(challenge);
  const hasInput = !!challenge.input && challenge.input.kind !== 'none';
  if (menu.length > 1 || !hasInput) {
    lines.push(`操作：${menu.map((entry, index) => `${index + 1}) ${entry.label}`).join('  ')}`);
  }
  if (hasInput) {
    const hint = challenge.input!.patternHint ? `（${challenge.input!.patternHint}）` : '';
    lines.push(`请输入${challenge.input!.label}${hint}后回车${menu.length > 1 ? '；#编号 选择其它操作' : ''}${challenge.input!.secret ? '（输入内容不会写入日志）' : ''}`);
  } else {
    lines.push('输入编号或操作 id 后回车；直接回车选择第一个操作');
  }
  lines.push(LOGIN_ASSIST_PROMPT);
  return lines;
}
