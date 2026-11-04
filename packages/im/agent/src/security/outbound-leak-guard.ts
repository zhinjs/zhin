import type { AgentOutputElement } from '../outbound/agent-output.js';
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

import type { DeliveryOutcome, ReplyAnswerContext, ReplyPort } from '../turn/turn-ingress.js';
import type { ReplyStreamSnapshot } from '@zhin.js/core/runtime';

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

  /** Cumulative source for one string; uncertain suffixes stay private until their boundary. */
  inspectPrefix(text: string, complete = false): LeakInspection {
    if (complete) return this.inspect(text);
    const literals = [...this.#secretValues, ...this.#promptLines, ...this.#memoryLines];
    let end = text.length;
    for (const literal of literals) end = Math.min(end, pendingLiteralStart(text, literal));
    for (const marker of SECRET_MARKERS) {
      const candidate = marker.insensitive ? text.replace(/[A-Z]/g, character => character.toLowerCase()) : text;
      const start = pendingLiteralStart(candidate, marker.text);
      if (start < text.length && (!marker.word || start === 0 || !/\w/.test(text[start - 1]!))) end = Math.min(end, start);
    }
    for (const pattern of PENDING_SECRET_TAILS) {
      const match = pattern.exec(text);
      if (match) end = Math.min(end, match.index);
    }
    for (const header of text.matchAll(/-----BEGIN [A-Z ]*PRIVATE KEY-----/g)) {
      if (!/-----END [A-Z ]*PRIVATE KEY-----/.test(text.slice(header.index + header[0].length))) {
        end = Math.min(end, header.index);
      }
    }
    // Cutting inside an already recognised secret would expose an unmasked fragment.
    let previous: number;
    do {
      previous = end;
      for (const literal of literals) {
        const start = text.lastIndexOf(literal, end - 1);
        if (start >= 0 && start < end && start + literal.length > end) end = start;
      }
      for (const pattern of SECRET_PATTERNS) {
        for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
          if (match.index >= end) break;
          if (match.index + match[0].length > end) end = match.index;
        }
      }
    } while (end < previous);
    return this.inspect(text.slice(0, end));
  }

  /** Inspects the text elements of an outbound message. */
  inspectOutput(output: readonly AgentOutputElement[]): Readonly<{ output: readonly AgentOutputElement[]; findings: readonly LeakFinding[] }> {
    const findings: LeakFinding[] = [];
    const next = output.map((element) => {
      if (element.type === 'message') {
        // Inspect nested strings too: share titles/URLs and media references
        // are model-controlled content just like text segments.
        const inspectValue = (value: unknown): unknown => {
          if (typeof value === 'string') {
            const inspection = this.inspect(value);
            findings.push(...inspection.findings);
            return inspection.text;
          }
          if (Array.isArray(value)) return value.map(inspectValue);
          if (value && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, inspectValue(item)]));
          }
          return value;
        };
        const segments = element.segments.map(segment => ({
          ...segment, data: inspectValue(segment.data) as typeof segment.data,
        }));
        return { ...element, segments };
      }
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
  const inspectSnapshot = (snapshot: ReplyStreamSnapshot): ReplyStreamSnapshot => ({
    ...snapshot,
    messages: snapshot.messages.map(message => ({
      ...message,
      segments: message.segments.map(part => {
        const value = part.value;
        if (value.type === 'text' || value.type === 'markdown') {
          const key = value.type === 'text' ? 'text' : 'content';
          const data: Readonly<Record<string, unknown>> = value.data;
          const inspected = inspector.inspectPrefix(String(data[key] ?? ''), part.complete);
          if (inspected.findings.length) onFindings?.(inspected.findings);
          return { ...part, value: { ...value, data: { ...value.data, [key]: inspected.text } } };
        }
        if (!part.complete) return part;
        const inspected = inspector.inspectOutput([{ type: 'message', segments: [value] }]);
        if (inspected.findings.length) onFindings?.(inspected.findings);
        const element = inspected.output[0];
        return element?.type === 'message' ? { ...part, value: element.segments[0]! } : part;
      }),
    })),
  });
  return Object.freeze({
    segments: port.segments,
    ...(port.openStream ? { openStream: (context?: Pick<ReplyAnswerContext, 'phaseId'>) => {
      const stream = context ? port.openStream!(context) : port.openStream!();
      if (!stream) return undefined;
      return Object.freeze({
        get receipt() { return stream.receipt; },
        get confirmed() { return stream.confirmed; },
        get minIntervalMs() { return stream.minIntervalMs; },
        update: (snapshot: ReplyStreamSnapshot) => stream.update(inspectSnapshot(snapshot)),
        finish: (snapshot: ReplyStreamSnapshot) => stream.finish(inspectSnapshot(snapshot)),
        cancel: () => stream.cancel(),
      });
    } } : {}),
    async send(output: readonly AgentOutputElement[], context?: ReplyAnswerContext): Promise<DeliveryOutcome> {
      const inspected = inspector.inspectOutput(output);
      if (inspected.findings.length > 0) onFindings?.(inspected.findings);
      return context ? port.send(inspected.output, context) : port.send(inspected.output);
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

const SECRET_MARKERS = [
  ...['sk-', 'pk-', 'rk-', 'ghp_', 'gho_', 'ghs_', 'ghu_', 'github_pat_', 'xoxa-', 'xoxb-', 'xoxp-', 'xoxr-', 'AKIA', 'AIza']
    .map(text => ({ text, word: true, insensitive: false })),
  { text: 'bearer', word: true, insensitive: true },
  { text: '-----BEGIN ', word: false, insensitive: false },
];

const PENDING_SECRET_TAILS = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]*$/,
  /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]*$/,
  /\bxox[abpr]-[A-Za-z0-9-]*$/,
  /\bAKIA[0-9A-Z]{0,16}$/,
  /\bAIza[0-9A-Za-z_-]{0,35}$/,
  /\bbearer(?:\s+[A-Za-z0-9._~+/=-]*)?$/i,
  /-----BEGIN [A-Z ]*$/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-{0,4}$/,
];

/** Linear-time longest suffix that can still grow into a protected literal. */
function pendingLiteralStart(text: string, literal: string): number {
  if (!literal) return text.length;
  const fallback = new Uint32Array(literal.length);
  for (let i = 1, matched = 0; i < literal.length; i++) {
    while (matched > 0 && literal[i] !== literal[matched]) matched = fallback[matched - 1]!;
    if (literal[i] === literal[matched]) matched++;
    fallback[i] = matched;
  }
  let matched = 0;
  for (let i = Math.max(0, text.length - literal.length + 1); i < text.length; i++) {
    while (matched > 0 && text[i] !== literal[matched]) matched = fallback[matched - 1]!;
    if (text[i] === literal[matched]) matched++;
  }
  return text.length - matched;
}
