import type {
  LoginAssist,
  LoginChallenge,
  LoginChallengeBlock,
  LoginFlowSnapshot,
  LoginOutcome,
  LoginStep,
} from '@zhin.js/core';
import { closeSync, openSync, writeSync } from 'node:fs';
import { formatCompact, getLogger } from '@zhin.js/logger';

const logger = getLogger('login-assist');

/** Line printed under a login challenge (whole line: the gateway forwards output line by line). */
export const LOGIN_ASSIST_PROMPT = '> 请在下方输入后回车（或在 Console 中提交）';

/** Terminal side of the consumer; lets tests drive it without a TTY. */
export interface LoginAssistTerminalIo {
  /** Writes one or more whole lines (each ends with `\n`). May be captured (logs, supervisor). */
  write(text: string): void;
  /**
   * Writes to the person's terminal only, never to captured output: under `zhin start --foreground`
   * the instance's stdout / stderr are piped into the gateway's log buffer and log files, so this is
   * the controlling terminal (`/dev/tty`) or a stderr that is itself a TTY. Absent → sensitive blocks
   * and verification links are not printed at all (the person opens the Console instead).
   */
  writePrivate?(text: string): void;
  /** Delivers each line typed by the person; returns unsubscribe. */
  onLine(listener: (line: string) => void): () => void;
}

/**
 * Interactive TTY consumer for LoginAssist (ADR 0058).
 * Non-TTY (daemon / CI) skips; Console RPC `login.submit` remains the other consumer.
 */
export function bindLoginAssistStdin(assist: LoginAssist): () => void {
  if (!process.stdin.isTTY) return () => {};
  const privateTerminal = openPrivateTerminal();
  const unbind = bindLoginAssistTerminal(assist, {
    write: (text) => { process.stderr.write(text); },
    ...(privateTerminal ? { writePrivate: privateTerminal.write } : {}),
    onLine: (listener) => {
      const onData = (chunk: Buffer | string) => {
        for (const line of chunk.toString().split(/\r?\n/u).slice(0, -1)) listener(line);
      };
      process.stdin.on('data', onData);
      return () => { process.stdin.off('data', onData); };
    },
  });
  return () => {
    unbind();
    privateTerminal?.close();
  };
}

/**
 * A sink that reaches the person's terminal without passing through captured output: stderr when it
 * is a TTY (not piped), else the controlling terminal. `undefined` when neither exists.
 */
export function openPrivateTerminal(
  stream: { readonly isTTY?: boolean; write(text: string): unknown } = process.stderr,
  ttyPath = '/dev/tty',
): { write(text: string): void; close(): void } | undefined {
  if (stream.isTTY === true) return { write: (text) => { stream.write(text); }, close: () => {} };
  if (process.platform === 'win32') return undefined;
  let fd: number;
  try {
    fd = openSync(ttyPath, 'w');
  } catch {
    return undefined;
  }
  let open = true;
  return {
    write: (text) => {
      if (!open) return;
      try { writeSync(fd, text); } catch { /* terminal went away: drop, never fall back to captured output */ }
    },
    close: () => {
      if (!open) return;
      open = false;
      try { closeSync(fd); } catch { /* already closed */ }
    },
  };
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
  const hasPrivate = typeof io.writePrivate === 'function';
  /** Writes lines in order, sending private ones to the uncaptured terminal only. */
  const writeMixed = (lines: readonly TerminalLine[]) => {
    let run: string[] = [];
    let runPrivate = false;
    const flush = () => {
      if (run.length === 0 || closed) { run = []; return; }
      const text = run.map((line) => `${line}\n`).join('');
      if (runPrivate) io.writePrivate?.(text);
      else io.write(text);
      run = [];
    };
    for (const line of lines) {
      const isPrivate = typeof line !== 'string';
      if (isPrivate !== runPrivate) { flush(); runPrivate = isPrivate; }
      run.push(typeof line === 'string' ? line : line.private);
    }
    flush();
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
      writeMixed(challengeLines(flow, active.challenge, hasPrivate));
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
    if (flow.state === 'online' || flow.state === 'failed' || flow.state === 'cancelled') {
      // A finished flow never changes again (a retry or relogin starts a new flow id); an expired
      // one may still get a refreshed challenge, so it stays.
      latest.delete(flow.id);
      printed.delete(flow.id);
      return;
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
    const menu = menuOf(challenge, hasPrivate);
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
      // Explicit request only; written to the uncaptured terminal, never to the logger or piped output.
      io.writePrivate?.([`${prefix(flow)} ${entry.label}：`, ...entry.content.split(/\r?\n/u)].map((text) => `${text}\n`).join(''));
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

/** A line for captured output (string) or for the uncaptured terminal only. */
type TerminalLine = string | { readonly private: string };

/**
 * Challenge kinds whose links carry a verification session (QQ device lock / slider `sid`, …): their
 * links are printed to the uncaptured terminal only.
 */
const PRIVATE_LINK_KINDS: ReadonlySet<LoginChallenge['kind']> = new Set(['device', 'auth', 'slider', 'link_verify']);

function linkLine(challenge: LoginChallenge, label: string, url: string, hasPrivate: boolean): TerminalLine {
  if (!PRIVATE_LINK_KINDS.has(challenge.kind)) return `${label}：${url}`;
  return hasPrivate ? { private: `${label}：${url}` } : `${label}：请在 Console 中打开（验证链接不写入日志）`;
}

function menuOf(challenge: LoginChallenge, hasPrivate: boolean): MenuEntry[] {
  const menu: MenuEntry[] = challenge.actions.map((action) => ({
    kind: 'action', id: action.id, label: action.label, requiresInput: !!action.requiresInput,
  }));
  // Revealing needs a terminal whose output is not captured (logs / gateway supervisor).
  if (!hasPrivate) return menu;
  for (const block of challenge.blocks ?? []) {
    if (block.kind === 'copy' && block.sensitive && !block.redacted && block.content) {
      menu.push({ kind: 'reveal', id: `show-${block.id}`, label: `显示${block.label}`, content: block.content });
    }
  }
  return menu;
}

function blockLines(challenge: LoginChallenge, block: LoginChallengeBlock, hasPrivate: boolean): TerminalLine[] {
  switch (block.kind) {
    case 'note':
      return [`${block.tone === 'warning' ? '⚠ ' : ''}${block.text}`];
    case 'link':
      return [linkLine(challenge, block.label, block.url, hasPrivate)];
    case 'copy':
      if (block.sensitive) {
        return [hasPrivate
          ? `${block.label}：已隐藏（选择「显示${block.label}」查看）`
          : `${block.label}：已隐藏（终端输出会写入日志，请在 Console 中查看）`];
      }
      if (block.collapsed) return [`${block.collapsedLabel ?? block.label}（内容较长，请在 Console 复制）`];
      return [`${block.label}：`, ...block.content.split(/\r?\n/u)];
  }
}

function challengeLines(flow: LoginFlowSnapshot, challenge: LoginChallenge, hasPrivate: boolean): TerminalLine[] {
  const lines: TerminalLine[] = [`${prefix(flow)} ${challenge.title}`];
  if (challenge.help?.short) lines.push(challenge.help.short);
  (challenge.help?.steps ?? []).forEach((step, index) => {
    lines.push(`  ${index + 1}. ${typeof step === 'string' ? step : step.text}`);
  });
  if (challenge.help?.warning) lines.push(`⚠ ${challenge.help.warning}`);
  for (const block of challenge.blocks ?? []) lines.push(...blockLines(challenge, block, hasPrivate));
  if (challenge.media?.link) {
    const { label, url } = challenge.media.link;
    lines.push(linkLine(challenge, label === url ? '链接' : label, url, hasPrivate));
  }
  if (challenge.media?.qrImage) lines.push('二维码请在 Console 中查看（或使用适配器打印的终端二维码）');
  if (challenge.media?.captcha) lines.push('也可以在 Console 中打开验证码辅助页一键完成，无需开发者工具');
  const menu = menuOf(challenge, hasPrivate);
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
