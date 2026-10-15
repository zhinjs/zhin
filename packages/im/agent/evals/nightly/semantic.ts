/**
 * Semantic assertions for real-model runs. Real answers vary, so checks look
 * at structure and key facts (which tools, which arguments, required facts in
 * the text) rather than exact wording. An optional LLM judge can grade open
 * questions; it is off by default to keep the nightly budget predictable.
 */
import { assistantText, createUserMessage, type AssistantMessage, type LlmCompletionPort, type Model } from '@zhin.js/ai';

export interface ModelToolCall {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

/** What one real-model response looked like, reduced to what assertions need. */
export interface ModelObservation {
  readonly text: string;
  readonly toolCalls: readonly ModelToolCall[];
  readonly totalTokens: number;
  readonly stopReason: string;
}

export interface SemanticCheck {
  readonly name: string;
  readonly pass: boolean;
  readonly detail?: string;
}

export function observe(message: AssistantMessage): ModelObservation {
  const toolCalls: ModelToolCall[] = [];
  for (const block of message.content) {
    if (block.type === 'toolCall') toolCalls.push({ name: block.name, arguments: block.arguments ?? {} });
  }
  return {
    text: assistantText(message),
    toolCalls,
    totalTokens: message.usage?.totalTokens ?? 0,
    stopReason: message.stopReason,
  };
}

function check(name: string, pass: boolean, detail?: string): SemanticCheck {
  return pass ? { name, pass } : { name, pass, detail };
}

export const semantic = {
  /** The response calls `tool` at least `min` times (default 1). */
  calledTool(o: ModelObservation, tool: string, min = 1): SemanticCheck {
    const count = o.toolCalls.filter((call) => call.name === tool).length;
    return check(`called ${tool} ×${min}+`, count >= min, `called ${tool} ${count} time(s); calls: [${o.toolCalls.map((c) => c.name).join(', ')}]`);
  },
  /** Every call to `tool` has `arg` as a non-empty string matching `pattern`. */
  toolArgMatches(o: ModelObservation, tool: string, arg: string, pattern: RegExp): SemanticCheck {
    const calls = o.toolCalls.filter((call) => call.name === tool);
    const bad = calls.filter((call) => typeof call.arguments[arg] !== 'string' || !pattern.test(call.arguments[arg] as string));
    return check(`${tool}.${arg} ~ ${pattern}`, calls.length > 0 && bad.length === 0, `args: ${JSON.stringify(calls.map((c) => c.arguments))}`);
  },
  /** Calls to `tool` cover every expected value of `arg` (order-free). */
  toolArgsCover(o: ModelObservation, tool: string, arg: string, expected: readonly RegExp[]): SemanticCheck {
    const values = o.toolCalls.filter((call) => call.name === tool).map((call) => String(call.arguments[arg] ?? ''));
    const missing = expected.filter((pattern) => !values.some((value) => pattern.test(value)));
    return check(`${tool}.${arg} covers ${expected.length}`, missing.length === 0, `values: ${JSON.stringify(values)}; missing: ${missing.join(', ')}`);
  },
  textIncludes(o: ModelObservation, needle: string): SemanticCheck {
    return check(`text includes "${needle}"`, o.text.includes(needle), `text: ${o.text.slice(0, 200)}`);
  },
  /** The text matches `pattern` (for facts with more than one valid wording, e.g. 红 / red). */
  textMatches(o: ModelObservation, pattern: RegExp, label: string): SemanticCheck {
    return check(label, pattern.test(o.text), `text: ${o.text.slice(0, 200)}`);
  },
  /** Mostly Chinese: CJK characters dominate letters, ignoring code and numbers. */
  textIsChinese(o: ModelObservation): SemanticCheck {
    const cjk = (o.text.match(/[\u4e00-\u9fff]/g) ?? []).length;
    const latin = (o.text.match(/[A-Za-z]/g) ?? []).length;
    return check('text is Chinese', cjk > 0 && cjk >= latin * 4, `cjk=${cjk} latin=${latin}`);
  },
  /** Exactly `count` non-empty lines start with `prefix`, and no other non-empty lines exist. */
  bulletLines(o: ModelObservation, prefix: string, count: number): SemanticCheck {
    const lines = o.text.split('\n').map((line) => line.trim()).filter(Boolean);
    const bullets = lines.filter((line) => line.startsWith(prefix));
    return check(`exactly ${count} "${prefix}" lines`, bullets.length === count && lines.length === count, `lines: ${JSON.stringify(lines)}`);
  },
} as const;

/** Grades an answer against a rubric. Implementations must not reveal the rubric to the evaluated model. */
export interface LlmJudge {
  judge(input: Readonly<{ question: string; answer: string; rubric: string }>): Promise<SemanticCheck>;
}

/** A judge backed by a model; it answers PASS/FAIL on the first line. */
export function createLlmJudge(port: LlmCompletionPort, model: Model): LlmJudge {
  return {
    async judge({ question, answer, rubric }) {
      const prompt = [
        '你是严格的评测裁判。根据评分标准判断回答是否合格。',
        '第一行只输出 PASS 或 FAIL，第二行给出一句理由。',
        `问题：${question}`,
        `评分标准：${rubric}`,
        `回答：${answer}`,
      ].join('\n\n');
      const message = await port.complete(model, { systemPrompt: '', messages: [createUserMessage(prompt)] });
      const verdict = assistantText(message).trim();
      return check('llm judge', /^PASS\b/i.test(verdict), verdict.slice(0, 200));
    },
  };
}
