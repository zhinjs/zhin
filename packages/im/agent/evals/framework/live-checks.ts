/**
 * Semantic assertions for running seed cases against a real model (#723).
 * Real answers vary, so these look at behaviour (which tools ran, what the
 * reply is about) rather than exact wording. Every case's `live.checks` must
 * also pass on its scripted run, which the PR gate verifies deterministically.
 */
import type { EvalRunRecord } from './driver.js';

export interface EvalLiveCheck {
  readonly name: string;
  readonly pass: boolean;
  readonly detail?: string;
}

function check(name: string, pass: boolean, detail?: string): EvalLiveCheck {
  return pass ? { name, pass } : { name, pass, detail };
}

const reply = (run: EvalRunRecord) => run.outbound.join('\n');

export const live = {
  /** The harness executed `tool` (after policy and approval). */
  executed(run: EvalRunRecord, tool: string): EvalLiveCheck {
    const names = run.executedTools.map((call) => call.name);
    return check(`executed ${tool}`, names.includes(tool), `executed: [${names.join(', ')}]`);
  },
  /** `tool` never ran, whatever the model attempted. */
  notExecuted(run: EvalRunRecord, tool: string): EvalLiveCheck {
    const names = run.executedTools.map((call) => call.name);
    return check(`did not execute ${tool}`, !names.includes(tool), `executed: [${names.join(', ')}]`);
  },
  /** `tool` was never offered to the model on any request (policy removed it). */
  neverOffered(run: EvalRunRecord, tool: string): EvalLiveCheck {
    const offending = run.modelRequests.filter((request) => request.offeredTools.includes(tool)).map((request) => request.index + 1);
    return check(`${tool} never offered`, offending.length === 0, `offered on request(s) #${offending.join(', #')}`);
  },
  /** Some executed call to `tool` has `arg` matching `pattern`. */
  executedWithArg(run: EvalRunRecord, tool: string, arg: string, pattern: RegExp): EvalLiveCheck {
    const values = run.executedTools.filter((call) => call.name === tool).map((call) => String(call.args[arg] ?? ''));
    return check(`${tool}.${arg} ~ ${pattern}`, values.some((value) => pattern.test(value)), `values: ${JSON.stringify(values)}`);
  },
  /** The combined reply text matches `pattern` (key fact or intent, not exact wording). */
  replyMatches(run: EvalRunRecord, pattern: RegExp, label = `reply ~ ${pattern}`): EvalLiveCheck {
    const text = reply(run);
    return check(label, pattern.test(text), `reply: ${text.slice(0, 200)}`);
  },
  /** The last reply of the case matches `pattern` (e.g. the answer to a follow-up turn). */
  lastReplyMatches(run: EvalRunRecord, pattern: RegExp, label = `last reply ~ ${pattern}`): EvalLiveCheck {
    const text = run.outbound.at(-1) ?? '';
    return check(label, pattern.test(text), `last reply: ${text.slice(0, 200)}`);
  },
  /** The combined reply text does not match `pattern`. */
  replyNotMatches(run: EvalRunRecord, pattern: RegExp, label = `reply !~ ${pattern}`): EvalLiveCheck {
    const text = reply(run);
    return check(label, !pattern.test(text), `reply: ${text.slice(0, 200)}`);
  },
  /** Every turn ended normally (no error / budget termination). */
  /** The first model request carried `count` image blocks (the image reached the real model). */
  imagesSent(run: EvalRunRecord, count: number): EvalLiveCheck {
    const seen = run.modelRequests[0]?.images ?? 0;
    return check(`first request carried ${count} image(s)`, seen === count, `images per request: [${run.modelRequests.map((r) => r.images).join(', ')}]`);
  },
  turnsCompleted(run: EvalRunRecord): EvalLiveCheck {
    const bad = run.terminals.filter((event) => event.type !== 'turn_end').map((event) => event.type);
    return check('turns completed', bad.length === 0 && run.terminals.length > 0, `terminals: [${run.terminals.map((e) => e.type).join(', ')}]`);
  },
} as const;
