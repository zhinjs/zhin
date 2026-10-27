/**
 * Assertion DSL: turns a case's `expect` block into a list of readable
 * failures against an EvalRunRecord. An empty list means the case passed.
 */
import { formatTurnTrace } from '../../src/trace/turn-trace-format.js';
import type { EvalCase, EvalExpectations } from './fixture.js';
import type { EvalRunRecord } from './driver.js';

export interface EvalFailure {
  readonly assertion: string;
  readonly message: string;
}

/** Raw tool output shorter than this is too generic to count as a leak. */
const MIN_LEAK_LENGTH = 24;

export function evaluateExpectations(definition: EvalCase, run: EvalRunRecord): EvalFailure[] {
  const expect: EvalExpectations = definition.expect;
  const failures: EvalFailure[] = [];
  const fail = (assertion: string, message: string) => failures.push({ assertion, message });
  const executed = run.executedTools.map((tool) => tool.name);
  const outboundText = run.outbound.join('\n');

  for (const name of expect.toolsCalled ?? []) {
    if (!executed.includes(name)) fail('toolsCalled', `expected tool "${name}" to run; ran [${list(executed)}]`);
  }
  for (const name of expect.toolsNotCalled ?? []) {
    if (executed.includes(name)) fail('toolsNotCalled', `expected tool "${name}" not to run, but it ran`);
  }
  for (const needle of expect.outboundContains ?? []) {
    if (!outboundText.includes(needle)) fail('outboundContains', `outbound text is missing "${needle}"`);
  }
  for (const needle of expect.outboundNotContains ?? []) {
    if (outboundText.includes(needle)) fail('outboundNotContains', `outbound text must not contain "${needle}"`);
  }
  if (expect.noRawToolOutput) {
    for (const raw of run.rawToolOutputs) {
      const sample = raw.trim();
      if (sample.length >= MIN_LEAK_LENGTH && outboundText.includes(sample)) {
        fail('noRawToolOutput', `outbound text echoes raw tool output ${quote(sample)}`);
      }
    }
  }
  if (expect.approvalRequested !== undefined) {
    const requested = run.approvalRequests;
    if (expect.approvalRequested === true && requested.length === 0) {
      fail('approvalRequested', 'expected an approval request, but none was made');
    } else if (expect.approvalRequested === false && requested.length > 0) {
      fail('approvalRequested', `expected no approval request; got [${list(requested)}]`);
    } else if (Array.isArray(expect.approvalRequested)) {
      for (const name of expect.approvalRequested) {
        if (!requested.includes(name)) fail('approvalRequested', `expected approval for "${name}"; got [${list(requested)}]`);
      }
    }
  }
  if (expect.approvalRequestCount !== undefined && run.approvalRequests.length !== expect.approvalRequestCount) {
    fail('approvalRequestCount', `expected ${expect.approvalRequestCount} approval request(s); got ${run.approvalRequests.length} [${list(run.approvalRequests)}]`);
  }
  for (const needle of expect.approvalQuestionContains ?? []) {
    if (!run.approvalQuestions.some((question) => question.includes(needle))) {
      fail('approvalQuestionContains', `no approval question contained "${needle}"`);
    }
  }
  if (expect.stableSystemPrompt && run.modelRequests.some(request => request.systemPrompt !== run.modelRequests[0]?.systemPrompt)) {
    fail('stableSystemPrompt', 'the system prefix changed during the conversation');
  }
  const modelInput = run.modelRequests.map((request) => request.inputText).join('\n');
  for (const needle of expect.modelInputContains ?? []) {
    if (!modelInput.includes(needle)) fail('modelInputContains', `the model never received "${needle}"`);
  }
  for (const [needle, max] of Object.entries(expect.maxInputOccurrences ?? {})) {
    for (const request of run.modelRequests) {
      const count = request.inputText.split(needle).length - 1;
      if (count > max) fail('maxInputOccurrences', `request ${request.index + 1}: "${needle}" appeared ${count} times (max ${max})`);
    }
  }
  for (const [number, needles] of Object.entries(expect.requestInputContains ?? {})) {
    const request = run.modelRequests[Number(number) - 1];
    for (const needle of needles) {
      if (!request) fail('requestInputContains', `there was no model request ${number}`);
      else if (!request.inputText.includes(needle)) fail('requestInputContains', `model request ${number} did not receive "${needle}"`);
    }
  }
  for (const needle of expect.systemPromptContains ?? []) {
    const missing = run.modelRequests.findIndex((request) => !request.systemPrompt.includes(needle));
    if (missing >= 0) fail('systemPromptContains', `model request ${missing + 1} had no "${needle}" in its system prompt`);
  }
  for (const needle of expect.systemPromptNotContains ?? []) {
    const leaked = run.modelRequests.findIndex((request) => request.systemPrompt.includes(needle));
    if (leaked >= 0) fail('systemPromptNotContains', `model request ${leaked + 1} had "${needle}" in its system prompt`);
  }
  for (const needle of expect.anySystemPromptContains ?? []) {
    if (!run.modelRequests.some((request) => request.systemPrompt.includes(needle))) {
      fail('anySystemPromptContains', `no model request had "${needle}" in its system prompt`);
    }
  }
  if (expect.contextBudget) {
    const budget = run.traces[0]?.context_budget;
    const bounds = expect.contextBudget;
    if (!budget) {
      fail('contextBudget', 'the first turn recorded no context budget');
    } else {
      if (bounds.maxFixedTokens !== undefined && budget.fixed_tokens > bounds.maxFixedTokens) {
        fail('contextBudget', `fixed context ~${budget.fixed_tokens} tokens exceeds ${bounds.maxFixedTokens}`);
      }
      for (const [segment, max] of Object.entries(bounds.maxSegmentTokens ?? {})) {
        const actual = budget.segments[segment as keyof typeof budget.segments];
        if (max !== undefined && actual > max) fail('contextBudget', `${segment} ~${actual} tokens exceeds ${max}`);
      }
      if (bounds.loadedTools !== undefined && budget.tools.loaded !== bounds.loadedTools) {
        fail('contextBudget', `expected ${bounds.loadedTools} tools loaded up front, got ${budget.tools.loaded}`);
      }
    }
  }
  if (expect.modelImages) {
    const seen = run.modelRequests.map((request) => request.images);
    if (JSON.stringify(seen) !== JSON.stringify(expect.modelImages)) {
      fail('modelImages', `images per model request: expected [${expect.modelImages.join(', ')}], got [${seen.join(', ')}]`);
    }
  }
  for (const needle of expect.modelInputNotContains ?? []) {
    if (modelInput.includes(needle)) fail('modelInputNotContains', `the model received "${needle}"`);
  }
  if (expect.streamToolEvents !== undefined) {
    const seen = run.events
      .filter((event) => event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'tool_denied')
      .map((event) => `${event.type}:${(event as { toolName: string }).toolName}`);
    if (seen.join(',') !== expect.streamToolEvents.join(',')) {
      fail('streamToolEvents', `expected stream tool events [${expect.streamToolEvents.join(', ')}], got [${seen.join(', ')}]`);
    }
  }
  if (expect.outboundMessages !== undefined && run.outbound.length !== expect.outboundMessages) {
    fail('outboundMessages', `expected ${expect.outboundMessages} outbound message(s), got ${run.outbound.length}`);
  }
  const expectedTermination = expect.termination ?? 'turn_end';
  const terminal = run.terminals.at(-1);
  if (terminal?.type !== expectedTermination) {
    const detail = terminal?.type === 'error' ? ` (${terminal.error.message})` : '';
    fail('termination', `expected termination "${expectedTermination}", got "${terminal?.type ?? 'none'}"${detail}`);
  }
  const steps = run.modelRequests.length;
  if (expect.modelSteps !== undefined && steps !== expect.modelSteps) {
    fail('modelSteps', `expected ${expect.modelSteps} model requests, got ${steps}`);
  }
  if (expect.modelIds !== undefined) {
    const actual = run.modelRequests.map((request) => request.model);
    if (actual.join(',') !== expect.modelIds.join(',')) {
      fail('modelIds', `expected requests to go to [${expect.modelIds.join(', ')}], got [${actual.join(', ')}]`);
    }
  }
  for (const mismatch of run.modelMismatches) fail('model', mismatch);
  if (expect.maxModelSteps !== undefined && steps > expect.maxModelSteps) {
    fail('maxModelSteps', `expected at most ${expect.maxModelSteps} model requests, got ${steps}`);
  }
  if (!definition.allowUnusedSteps && run.unusedScriptSteps > 0) {
    fail('script', `${run.unusedScriptSteps} scripted step(s) were never requested by the harness`);
  }
  if (run.extraModelRequests > 0) {
    fail('script', `the harness made ${run.extraModelRequests} model request(s) after the ${definition.script.length}-step script ran out`);
  }
  for (const call of run.unexpectedlyOfferedToolCalls) {
    fail('notOffered', `${call} was expected to be withheld from the model, but the harness offered it`);
  }
  for (const call of run.unofferedToolCalls) {
    fail('script', `scripted call to ${call} names a tool the harness did not offer`);
  }
  return failures;
}

/** Multi-line report: failures first, then the trace needed to debug them. */
export function formatEvalReport(
  definition: EvalCase,
  run: EvalRunRecord,
  failures: readonly EvalFailure[],
  /** "Open this trace" lines from {@link persistEvalTraces} (#728). */
  traceLinks: readonly string[] = [],
): string {
  const lines = [`eval "${definition.id}" failed: ${definition.description}`];
  for (const failure of failures) lines.push(`  ✗ [${failure.assertion}] ${failure.message}`);
  for (const link of traceLinks) lines.push(`  ↪ ${link}`);
  lines.push('  trace:');
  lines.push(`    model requests: ${run.modelRequests.length}`);
  for (const request of run.modelRequests) {
    lines.push(`      #${request.index + 1} model=${request.model} offered=[${list(request.offeredTools)}] called=[${list(request.toolCalls)}] user=${quote(request.lastUserText)}`);
  }
  lines.push(`    attempted tools: [${list(run.attemptedTools)}]`);
  lines.push(`    executed tools: [${list(run.executedTools.map((tool) => tool.name))}]`);
  lines.push(`    approvals: [${list(run.approvalRequests)}]`);
  lines.push(`    terminals: [${list(run.terminals.map((event) => event.type))}]`);
  for (const text of run.outbound) lines.push(`    outbound: ${quote(text)}`);
  for (const trace of run.traces) {
    lines.push('  turn trace:');
    lines.push(formatTurnTrace(trace).split('\n').map((line) => `    ${line}`).join('\n'));
  }
  if (process.env.EVAL_VERBOSE) {
    for (const request of run.modelRequests) {
      lines.push(`    --- model input #${request.index + 1} ---`, request.inputText);
    }
  }
  return lines.join('\n');
}

function list(values: readonly string[]): string {
  return values.join(', ');
}

function quote(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return JSON.stringify(flat.length > max ? `${flat.slice(0, max)}…` : flat);
}
