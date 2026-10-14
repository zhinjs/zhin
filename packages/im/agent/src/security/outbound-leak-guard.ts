/**
 * Outbound leak check (#727, M3.4).
 *
 * Runs on everything the agent sends — final replies, progress updates and
 * the text arguments of outbound tools — as a step in the existing send
 * chain: the guarded ReplyPort masks findings and then hands the message to
 * the real port, so delivery, rendering and before.sendMessage middleware
 * stay exactly as they were.
 *
 * Three kinds of leak are masked:
 * - system_prompt:        verbatim lines from the persona, bootstrap context
 *                         or prompt sections the model was given;
 * - secret:               credential-shaped strings and the values of
 *                         secret-looking environment variables;
 * - other_session_memory: lines read from another session's memory files
 *                         during this turn.
 */
import type { OutputElement } from '@zhin.js/ai';
import type { DeliveryOutcome, ReplyPort } from '../turn/turn-ingress.js';

export type LeakKind = 'system_prompt' | 'secret' | 'other_session_memory';

export interface LeakFinding {
  readonly kind: LeakKind;
  /** How many occurrences were masked. */
  readonly count: number;
}

export interface LeakInspection {
  readonly text: string;
  readonly findings: readonly LeakFinding[];
}

const MASKS: Readonly<Record<LeakKind, string>> = Object.freeze({
  system_prompt: '[已隐藏：系统提示内容]',
  secret: '[已隐藏：密钥]',
  other_session_memory: '[已隐藏：其他会话的记忆]',
});

/** Prompt lines shorter than this are too generic to count as a leak. */
const MIN_PROMPT_LINE = 24;
/** Memory lines shorter than this are too generic to count as a leak. */
const MIN_MEMORY_LINE = 12;
/** Environment values shorter than this are not treated as secrets. */
const MIN_SECRET_VALUE = 12;

const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,
  /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\b(?:bearer)\s+[A-Za-z0-9._~+/=-]{20,}/gi,
];

const LINE_NUMBER_PREFIX = /^\s*\d+\s*(?:→|\||:|\t)\s?/;

const MARKDOWN_PREFIX = /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+|>\s+|\d+\.\s+)/;

const SECRET_ENV_NAME = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i;

/** Values of secret-looking environment variables, for exact-match masking. */
export function collectEnvironmentSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.entries(env)
    .filter(([name, value]) => SECRET_ENV_NAME.test(name) && typeof value === 'string' && value.length >= MIN_SECRET_VALUE)
    .map(([, value]) => value as string);
}

export interface OutboundLeakInspectorOptions {
  /** Persona, bootstrap context and prompt sections the model saw this turn. */
  readonly promptTexts?: readonly string[];
  /** Exact secret values (defaults to secret-looking environment variables). */
  readonly secretValues?: readonly string[];
}

/** Per-turn inspector; other-session memory lines are added as the turn reads them. */
export class OutboundLeakInspector {
  readonly #promptLines: readonly string[];
  readonly #secretValues: readonly string[];
  readonly #memoryLines = new Set<string>();

  constructor(options: OutboundLeakInspectorOptions = {}) {
    this.#promptLines = uniqueLines(options.promptTexts ?? [], MIN_PROMPT_LINE);
    this.#secretValues = [...new Set(options.secretValues ?? collectEnvironmentSecrets())]
      .filter((value) => value.length >= MIN_SECRET_VALUE)
      .sort((left, right) => right.length - left.length);
  }

  /** Marks text read from another session's memory as private to that session. */
  protectOtherSessionMemory(text: string): void {
    // File tools prefix lines with numbers ("12 | ") and notes use list markers; the model echoes the text only.
    const plain = text
      .split(/\r?\n/)
      .map((line) => line.replace(LINE_NUMBER_PREFIX, '').replace(MARKDOWN_PREFIX, ''))
      .join('\n');
    for (const line of uniqueLines([plain], MIN_MEMORY_LINE)) this.#memoryLines.add(line);
  }

  inspect(text: string): LeakInspection {
    const findings: LeakFinding[] = [];
    let result = text;
    const mask = (kind: LeakKind, apply: (current: string) => [string, number]) => {
      const [next, count] = apply(result);
      if (count > 0) findings.push(Object.freeze({ kind, count }));
      result = next;
    };
    mask('secret', (current) => {
      let count = 0;
      let next = current;
      for (const value of this.#secretValues) [next, count] = replaceLiteral(next, value, MASKS.secret, count);
      for (const pattern of SECRET_PATTERNS) {
        next = next.replace(pattern, () => {
          count += 1;
          return MASKS.secret;
        });
      }
      return [next, count];
    });
    mask('system_prompt', (current) => replaceLines(current, this.#promptLines, MASKS.system_prompt));
    mask('other_session_memory', (current) => replaceLines(current, [...this.#memoryLines], MASKS.other_session_memory));
    return Object.freeze({ text: result, findings: Object.freeze(findings) });
  }

  /** Inspects the text elements of an outbound message. */
  inspectOutput(output: readonly OutputElement[]): Readonly<{ output: readonly OutputElement[]; findings: readonly LeakFinding[] }> {
    const findings: LeakFinding[] = [];
    const next = output.map((element) => {
      if (element.type !== 'text') return element;
      const inspection = this.inspect(element.content);
      if (inspection.findings.length === 0) return element;
      findings.push(...inspection.findings);
      return { ...element, content: inspection.text };
    });
    return Object.freeze({ output: findings.length > 0 ? Object.freeze(next) : output, findings: Object.freeze(findings) });
  }

  /** Inspects the string arguments of an outbound tool call. */
  inspectArguments(input: Readonly<Record<string, unknown>>): Readonly<{ input: Readonly<Record<string, unknown>>; findings: readonly LeakFinding[] }> {
    const findings: LeakFinding[] = [];
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (typeof value !== 'string') {
        next[key] = value;
        continue;
      }
      const inspection = this.inspect(value);
      findings.push(...inspection.findings);
      next[key] = inspection.text;
    }
    return Object.freeze({ input: findings.length > 0 ? Object.freeze(next) : input, findings: Object.freeze(findings) });
  }
}

/**
 * Send-chain step for the turn's ReplyPort: masks leaks, reports them, then
 * delegates to the real port unchanged.
 */
export function guardReplyPort(
  port: ReplyPort,
  inspector: OutboundLeakInspector,
  onFindings?: (findings: readonly LeakFinding[]) => void,
): ReplyPort {
  return Object.freeze({
    async send(output: readonly OutputElement[]): Promise<DeliveryOutcome> {
      const inspected = inspector.inspectOutput(output);
      if (inspected.findings.length > 0) onFindings?.(inspected.findings);
      return port.send(inspected.output);
    },
  });
}

function uniqueLines(texts: readonly string[], minLength: number): string[] {
  const lines = new Set<string>();
  for (const text of texts) {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.length >= minLength) lines.add(line);
    }
  }
  return [...lines].sort((left, right) => right.length - left.length);
}

function replaceLines(text: string, lines: readonly string[], replacement: string): [string, number] {
  let count = 0;
  let next = text;
  for (const line of lines) [next, count] = replaceLiteral(next, line, replacement, count);
  return [next, count];
}

function replaceLiteral(text: string, needle: string, replacement: string, count: number): [string, number] {
  if (!needle || !text.includes(needle)) return [text, count];
  const parts = text.split(needle);
  return [parts.join(replacement), count + parts.length - 1];
}
