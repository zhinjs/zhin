---
title: Schedule outcome and retry safety
sidebar: false
---

# Schedule outcome and retry safety

## Status and boundary

Proposal for review, not permission to change scheduled execution. The user chose a separate queue
repair plan while prompt work continues. The current queue, retry budgets, timeouts, concurrency,
notification destinations and installed user configuration remain unchanged. This document does
not claim that prompt-policy consolidation fixes end-to-end replay safety.

The required invariant is: a failed attempt must not replay already committed or potentially
submitted effects merely because its final result is unsuccessful. Unknown is different from
rejected, not submitted, or confirmed completed. A timeout is not proof that nothing happened.

## Reproduction and causal path

Baseline: `feat/endpoint-self-profile`, HEAD `dd54db646` plus existing uncommitted work.

The local synthetic experiment imported the actual `assistant/job-worker.ts`, which constructs the
actual `schedule-domain/schedule-execution-queue.ts`. Only its executor was a stub. The worker was
created with a test-only `queue: { maxRetries: 1 }`. No product configuration was modified.

```ts
let submittedEffects = 0;
const executor = {
  execute: async () => {
    submittedEffects += 1; // synthetic counter, no external action
    return submittedEffects === 1
      ? { success: false, error: 'synthetic failure after the recorded effect' }
      : { success: true, output: 'synthetic completion after replay' };
  },
};
const worker = new JobWorker({ executor, queue: { maxRetries: 1 } });
await worker.run(syntheticJob);
await worker.stop();
// Observed: submittedEffects === 2; final result success === true.
```

The same two-invocation result was observed with unchanged queue defaults after a first failed
result or thrown exception. This establishes executor replay after recorded execution, not a real
platform incident or the behavior of any particular SDK.

```text
JobWorker.run
  queue.enqueueAndWait(execute)
    TaskExecutor.execute
      ScheduleExecutionDomain.execute -> Agent turn -> possible tool effects
      output delivery via deliverScheduleToAdapter -> NotificationRouter
    unsuccessful result -> JobWorker throws a new generic Error
  ScheduleExecutionQueue.#run catches un-aborted errors
  retry budget remains -> rerun the entire execute callback
```

The root cause is loss of replay evidence at the attempt boundary. `ScheduleExecutionResult` carries
`success`, text, tools used and audit information, but no trustworthy aggregate effect outcome.
JobWorker converts unsuccessful results to generic errors. The queue checks abort/disposal and
budget, not committed or uncertain effects. A task can also complete work and then fail while
delivering its final notification; TaskExecutor propagates the delivery error through the same
whole-job retry boundary.

This is separate from three mechanisms: model completion transport retries; a tool or platform SDK's
own internal retries; and the Agent deciding to invoke a second tool. `TurnToolRuntime` invoking a
tool only once cannot prove that the scheduled executor will not be run twice.

## Preserve outcomes at their real owner

Existing evidence should be retained rather than inferred from incidental metadata:

- Endpoint operations already distinguish `EndpointDeliveryError.disposition` as `not_sent`,
  `rejected`, or `unknown`; delivery receipts can include completed parts and `deliveryUnknown`.
- Self-profile mutation ports distinguish `updated`, `rejected`, and `unknown`. Cancellation after
  SDK submission cannot imply rollback. A later reread failure must not erase an earlier write ACK.
- Policy/approval denial before tool execution is evidence that this particular call did not run;
  it says nothing about effects from earlier calls in the same attempt.
- A concrete read-only execution contract can establish that an operation has no write effect.
  A generic tool success string, a model's claim, `toolsUsed.length`, risk-name heuristics, exception
  text, or a timeout cannot establish that a whole attempt is safe to replay.
- The current notification seam exposes `sendIm: Promise<void>` and a boolean delivery result.
  It cannot fabricate richer transport certainty. Preserve actual receipts where available;
  otherwise a submitted delivery with no confirmed result remains unclassified/unknown.

Aggregate evidence belongs to the current scheduled attempt and its existing execution ID, tool
calls and delivery boundary. It must not be stored in a module-level singleton or borrowed from
the latest account/client. Real account, destination, generation and cancellation scope remain fixed.
Logging or telemetry failure must not decide whether an operation was submitted.

## Minimal interface candidate

The proposed seam is the existing result/error passed from TaskExecutor through JobWorker to the
queue. Add explicit replay evidence to that attempt result, preserving it on exceptions. Names below
are illustrative; they are not a new published API commitment.

```ts
type AttemptReplayEvidence =
  | { disposition: 'safe'; reason: 'read_only' | 'not_submitted' }
  | { disposition: 'committed'; operations: readonly EffectReference[] }
  | { disposition: 'unknown'; operations: readonly EffectReference[] };

interface ScheduleAttemptFailure {
  error: Error;
  replay: AttemptReplayEvidence;
}

// Existing execution owner, carrying receipts from actual effects:
const attempt = beginScheduledAttempt(existingExecutionId);
try {
  const result = await executeTurn({ onEffect: attempt.observe });
  // Observe notification effects separately; never rerun the turn to retry a notification.
  await deliverResult(result, { onEffect: attempt.observe });
  return { ...result, replay: attempt.evidence() };
} catch (error) {
  throw scheduleAttemptFailure(error, attempt.evidence());
}

// Existing queue; same timeout, retry budget and concurrency:
catch (error) {
  if (aborted || disposed) stop(error);
  else if (attemptEvidence(error).disposition !== 'safe') stop(error);
  else if (retryBudgetAvailable) retryWholeAttempt();
  else stop(error);
}
```

`onEffect` represents wiring through existing operation/turn boundaries, not a parallel global
manager. Reuse actual structured results and the current execution journal correlation. Persisted
effect receipts are useful for review and recovery, but this proposal does not make best-effort
telemetry a business admission gate. Do not treat an absent receipt as proof of no effect.

The minimum honest fallback for an invoked plugin operation without a read-only or outcome contract
is “replay safety not established.” Choosing to stop automatic retry for that class can reduce
existing retries and therefore requires confirmation. Calling it safe to preserve current behavior
would not satisfy the required invariant. A local queue-only guard cannot reconstruct evidence
already discarded by the execution and notification seams.

## Handling later failures

| Attempt evidence when a later stage fails | Candidate behavior | What must remain distinct |
| --- | --- | --- |
| Only validated read-only work, or every possible mutation proven not submitted | Existing bounded retry remains available | Safe-to-replay does not guarantee success or waive authorization |
| A submitted mutation has unknown outcome | Stop whole-job replay; report incomplete execution with unknown effect | Do not report rollback, definitive failure, or success; do not retry through another tool |
| A mutation is confirmed committed, then a later read/model/formatting step fails | Stop whole-job replay and retain the confirmed effect | The write succeeded even though the overall job did not finish |
| Turn completed, then notification outcome becomes unknown | Retain turn result and delivery uncertainty; stop whole-job replay | Content production, tool effects and delivery are separate outcomes |
| One operation rejected after an earlier committed/unknown operation | Stop whole-job replay | A rejection does not erase previous effects |
| Cancellation after submission | Preserve operation certainty independently; do not retry the attempt | Logical cancellation does not undo a remote operation |

An optional targeted verification/read or retry of only a proven-safe remaining delivery stage
would require a separate resume contract. This plan does not add automatic compensation, remote
rollback, provider idempotency keys, checkpoint resume, new notifications or human approval flows.

## Impact, recovery and decisions to confirm

Affected code would be the existing scheduled execution result, tool/effect evidence propagation,
TaskExecutor delivery boundary, JobWorker error preservation and queue admission of another attempt.
The standalone queue still owns concurrency, timing and drain; business evidence comes from its
caller. Retry counts and other queue configuration stay unchanged.

Before implementation, confirm:

1. Adopt explicit “safe only” replay, including stopping automatic retries when an invoked plugin's
   replay safety cannot be established. This changes behavior for unclassified executions.
2. Define the structured result/error shape and the minimum initial operation coverage. A narrow
   coverage claim must explicitly list uncovered plugins and SDKs.
3. Keep recovery manual for committed/unknown attempts; do not silently rerun them after restart or
   introduce stage resume. If automatic resume is desired, design its identity and idempotency first.

Recovery must preserve execution IDs, original errors, known receipts and any delivered result.
Do not delete queued/audit data, rewrite job configuration or replay failed attempts as part of an
upgrade. Reverting code cannot undo a real external write; if a future data-shape change is proposed,
document forward/backward read behavior before applying it.

## Acceptance and remaining evidence

- Reproduce the present two-invocation JobWorker test on the old implementation; the approved new
  evidence-aware path must stop with one effect for committed/unknown first attempts.
- Cover returned unsuccessful results and thrown errors, not only direct queue exceptions.
- Keep bounded retries for proven read-only/not-submitted attempts with the same configured budget.
- Cover confirmed mutation followed by model/read/format failure and mutation followed by a rejected
  second operation; earlier evidence must survive.
- Cover success of the turn followed by known/unknown notification failure without rerunning the turn.
- Cover caller cancellation, ignored cancellation, disposal, timeout, new account generations and
  unavailable approvals. No test may equate timeout with not-submitted.
- Check that missing/malformed/plugin-only evidence fails to establish replay safety, and that
  audit/logging failure does not invent or alter the business outcome.

Current evidence is local and synthetic. No provider, IM platform or billable operation was tested.
The full real tool/SDK and restart recovery paths remain unverified. Prompt policy work can explain
unknown outcomes correctly, but this separate mechanism proposal remains pending confirmation.
