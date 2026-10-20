/** Executable scenarios for decision-map ticket #11 (not production tests). */
import assert from 'node:assert/strict';
import {
  admissionBlockers,
  dispatchPortfolio,
  initialPortfolioJournal,
  projectBudget,
  replayPortfolio,
  requestStatus,
  type CapacityGrant,
  type PortfolioEvent,
} from './portfolio-admission.ts';
import {
  fixturePolicy,
  portfolioKernel,
  projectPolicy,
  request,
  scheduler,
  sponsor,
  usageGateway,
  workroomKernel,
} from './fixtures.ts';

function submit(journal: readonly PortfolioEvent[], value: ReturnType<typeof request>): readonly PortfolioEvent[] {
  return dispatchPortfolio(journal, {
    type: 'submit_request',
    actor: scheduler(value.projectId),
    request: value,
  });
}

function decide(journal: readonly PortfolioEvent[]): readonly PortfolioEvent[] {
  return dispatchPortfolio(journal, { type: 'decide_admission', actor: portfolioKernel });
}

function latestGrant(journal: readonly PortfolioEvent[]): CapacityGrant {
  const grants = Object.values(replayPortfolio(journal).grants);
  const grant = grants.sort((left, right) => right.issuedAt - left.issuedAt || right.id.localeCompare(left.id))[0];
  if (!grant) throw new Error('Expected a Capacity Grant');
  return grant;
}

function consumeAndSettle(
  journal: readonly PortfolioEvent[],
  grant: CapacityGrant,
  actualCostMicros = grant.reservedCostMicros,
): readonly PortfolioEvent[] {
  journal = dispatchPortfolio(journal, {
    type: 'consume_grant', actor: workroomKernel(grant.projectId), grantId: grant.id,
    assignmentRef: `assignment:${grant.requestId}`,
  });
  return dispatchPortfolio(journal, {
    type: 'settle_usage', actor: usageGateway, grantId: grant.id,
    actualCostMicros, settlementRef: `usage://${grant.id}`,
  });
}

// A request is an opaque, atomically granted Resource Bundle. It cannot smuggle
// messages/context into Portfolio state, and idempotency is payload-sensitive.
{
  let journal = initialPortfolioJournal(fixturePolicy());
  const bundle = request('request:bundle', 'project:software', 1);
  journal = submit(journal, bundle);
  const afterFirst = journal.length;
  journal = submit(journal, bundle);
  assert.equal(journal.length, afterFirst, 'same request id + same fingerprint must be idempotent');
  assert.throws(() => submit(journal, request('request:bundle', 'project:software', 2)), /id conflict/u);
  assert.throws(() => dispatchPortfolio(journal, {
    type: 'submit_request', actor: scheduler('project:software'),
    request: { ...request('request:smuggle', 'project:software', 3), context: ['secret Project memory'] },
  } as never), /cannot carry Workroom context/u);
  journal = decide(journal);
  const grant = latestGrant(journal);
  assert.deepEqual(grant.demands.map((item) => item.poolId).sort(), ['executor:sandbox', 'model:premium']);
  assert.equal(grant.projectPolicyRevision, 1);
  assert.equal(grant.portfolioPolicyRevision, 1);
}

// Weighted dominant service gives 2:1 long-run service inside one Sponsor lane,
// while comparing only each Project's locally selected head request.
{
  const policy = fixturePolicy([
    projectPolicy('project:a', 'normal', 2),
    projectPolicy('project:b', 'normal', 1),
  ]);
  let journal = initialPortfolioJournal(policy);
  for (let index = 1; index <= 4; index += 1) journal = submit(journal, request(`request:a:${index}`, 'project:a', index));
  for (let index = 1; index <= 2; index += 1) journal = submit(journal, request(`request:b:${index}`, 'project:b', index));
  const order: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    journal = decide(journal);
    const grant = Object.values(replayPortfolio(journal).grants).find((item) => item.status === 'offered');
    assert.ok(grant);
    order.push(grant.projectId);
    journal = consumeAndSettle(journal, grant);
  }
  assert.deepEqual(order, ['project:a', 'project:a', 'project:b', 'project:a', 'project:a', 'project:b']);
}

// Starvation reservation outranks a continuously replenished urgent Project at
// the next capacity opportunity. The bound is an opportunity bound; an atomic
// running lease still has to finish or expire.
{
  const policy = fixturePolicy([
    projectPolicy('project:urgent', 'urgent', 1, { starvationAfterTicks: 50 }),
    projectPolicy('project:low', 'low', 1, { starvationAfterTicks: 3 }),
  ]);
  let journal = initialPortfolioJournal(policy);
  journal = submit(journal, request('request:low', 'project:low', 1));
  for (let index = 1; index <= 5; index += 1) journal = submit(journal, request(`request:urgent:${index}`, 'project:urgent', index));
  const order: string[] = [];
  for (let tick = 0; tick < 4; tick += 1) {
    journal = decide(journal);
    const grant = Object.values(replayPortfolio(journal).grants).find((item) => item.status === 'offered');
    assert.ok(grant);
    order.push(grant.projectId);
    journal = consumeAndSettle(journal, grant);
    journal = dispatchPortfolio(journal, { type: 'advance_clock', actor: portfolioKernel, ticks: 1 });
  }
  assert.equal(order[3], 'project:low');
}

// Cross-Project priority is issued by the Sponsor against an exact opaque
// request and expires on the Kernel clock. Pause/resume changes admission only.
{
  const alpha = projectPolicy('project:alpha', 'normal');
  const beta = projectPolicy('project:beta', 'low');
  let journal = initialPortfolioJournal(fixturePolicy([alpha, beta]));
  journal = submit(journal, request('request:alpha', 'project:alpha', 1));
  journal = submit(journal, request('request:beta', 'project:beta', 1));
  journal = dispatchPortfolio(journal, {
    type: 'set_priority_override', actor: sponsor,
    override: {
      id: 'override:beta', projectId: 'project:beta', requestId: 'request:beta',
      lane: 'urgent', expiresAt: 2,
    },
  });
  journal = decide(journal);
  let grant = latestGrant(journal);
  assert.equal(grant.requestId, 'request:beta');
  journal = consumeAndSettle(journal, grant);
  journal = dispatchPortfolio(journal, {
    type: 'update_project_policy', actor: sponsor,
    policy: { ...alpha, revision: 2, status: 'paused' },
  });
  const before = journal.length;
  journal = decide(journal);
  assert.equal(journal.length, before, 'paused Project keeps its request but receives no grant');
  journal = dispatchPortfolio(journal, {
    type: 'update_project_policy', actor: sponsor,
    policy: { ...alpha, revision: 3, status: 'active' },
  });
  journal = decide(journal);
  grant = latestGrant(journal);
  assert.equal(grant.requestId, 'request:alpha');
}

// Budget is reserved before dispatch. A lost lease releases physical capacity
// but holds money as outcome_unknown until a trusted late usage receipt arrives.
{
  const policy = fixturePolicy([
    projectPolicy('project:budget', 'normal', 1, { hardBudgetMicros: 100 }),
  ]);
  let journal = initialPortfolioJournal(policy);
  journal = submit(journal, request('request:costly', 'project:budget', 1, { modelBudgetUnits: 8, includeExecutor: false }));
  journal = submit(journal, request('request:next', 'project:budget', 2, { modelBudgetUnits: 3, includeExecutor: false }));
  journal = decide(journal);
  const grant = latestGrant(journal);
  assert.equal(grant.reservedCostMicros, 80);
  assert.equal(projectBudget(replayPortfolio(journal), 'project:budget').availableMicros, 20);
  journal = dispatchPortfolio(journal, {
    type: 'consume_grant', actor: workroomKernel('project:budget'), grantId: grant.id,
    assignmentRef: 'assignment:costly',
  });
  journal = dispatchPortfolio(journal, { type: 'advance_clock', actor: portfolioKernel, ticks: 5 });
  let state = replayPortfolio(journal);
  assert.equal(state.grants[grant.id]?.status, 'usage_unknown');
  assert.equal(requestStatus(state, 'request:costly'), 'usage_blocked');
  assert.deepEqual(admissionBlockers(state, 'request:next'), ['project_budget']);
  journal = dispatchPortfolio(journal, {
    type: 'settle_usage', actor: usageGateway, grantId: grant.id,
    actualCostMicros: 25, settlementRef: 'provider-receipt:late-1',
  });
  state = replayPortfolio(journal);
  assert.equal(projectBudget(state, 'project:budget').availableMicros, 75);
  journal = decide(journal);
  assert.equal(latestGrant(journal).requestId, 'request:next');
}

// Cross-Project preemption is a reclaim protocol. Portfolio asks the owning
// Workroom to checkpoint; only that Workroom releases its grant. No Task state
// exists in Portfolio and an unrelated Workroom cannot consume the grant.
{
  const policy = fixturePolicy([
    projectPolicy('project:normal', 'normal'),
    projectPolicy('project:urgent', 'urgent'),
  ]);
  let journal = initialPortfolioJournal(policy);
  journal = submit(journal, request('request:normal', 'project:normal', 1));
  journal = decide(journal);
  const normalGrant = latestGrant(journal);
  journal = dispatchPortfolio(journal, {
    type: 'consume_grant', actor: workroomKernel('project:normal'), grantId: normalGrant.id,
    assignmentRef: 'assignment:normal',
  });
  assert.throws(() => dispatchPortfolio(journal, {
    type: 'settle_usage', actor: workroomKernel('project:normal'), grantId: normalGrant.id,
    actualCostMicros: 1, settlementRef: 'forged',
  } as never), /usage_gateway authority/u);
  journal = submit(journal, request('request:urgent', 'project:urgent', 1));
  journal = decide(journal);
  let state = replayPortfolio(journal);
  const reclaim = Object.values(state.reclaims)[0];
  assert.ok(reclaim);
  assert.equal(reclaim.reservedForRequestId, 'request:urgent');
  assert.equal(state.grants[normalGrant.id]?.status, 'reclaim_requested');
  assert.equal('tasks' in state, false, 'Portfolio must not become a second Task state machine');
  assert.throws(() => dispatchPortfolio(journal, {
    type: 'acknowledge_reclaim', actor: workroomKernel('project:urgent'), reclaimId: reclaim.id,
    outcome: 'checkpointed',
  }), /another Project/u);
  journal = dispatchPortfolio(journal, {
    type: 'acknowledge_reclaim', actor: workroomKernel('project:normal'), reclaimId: reclaim.id,
    outcome: 'checkpointed',
  });
  journal = decide(journal);
  state = replayPortfolio(journal);
  assert.equal(Object.values(state.grants).find((grant) => grant.requestId === 'request:urgent')?.status, 'offered');
  assert.equal(state.grants[normalGrant.id]?.status, 'usage_pending');
}

// Atomic work is never reclaimed. Pausing admission is versioned and does not
// cancel active work; reclaim_checkpointable only emits requests for safe work.
{
  const normal = projectPolicy('project:atomic', 'normal');
  const urgent = projectPolicy('project:urgent', 'urgent');
  let journal = initialPortfolioJournal(fixturePolicy([normal, urgent]));
  journal = submit(journal, request('request:atomic', 'project:atomic', 1, { preemptibility: 'atomic' }));
  journal = decide(journal);
  const grant = latestGrant(journal);
  journal = dispatchPortfolio(journal, {
    type: 'consume_grant', actor: workroomKernel('project:atomic'), grantId: grant.id,
    assignmentRef: 'assignment:atomic',
  });
  journal = submit(journal, request('request:urgent', 'project:urgent', 1));
  const before = journal.length;
  journal = decide(journal);
  assert.equal(journal.length, before, 'atomic victim must run until settlement or lease expiry');
  journal = dispatchPortfolio(journal, {
    type: 'update_project_policy', actor: sponsor,
    policy: { ...normal, revision: 2, status: 'reclaim_checkpointable' },
  });
  assert.equal(Object.keys(replayPortfolio(journal).reclaims).length, 0);
}

// Unconsumed offers expire without spending budget, then the same request may
// receive a higher fencing token. Replay produces the identical projection.
{
  let journal = initialPortfolioJournal(fixturePolicy());
  journal = submit(journal, request('request:retry', 'project:software', 1));
  journal = decide(journal);
  const first = latestGrant(journal);
  journal = dispatchPortfolio(journal, { type: 'advance_clock', actor: portfolioKernel, ticks: 2 });
  assert.equal(requestStatus(replayPortfolio(journal), 'request:retry'), 'pending');
  journal = decide(journal);
  const second = Object.values(replayPortfolio(journal).grants).find((grant) => grant.status === 'offered');
  assert.ok(second);
  assert.equal(second.fence, first.fence + 1);
  assert.deepEqual(replayPortfolio([...journal]), replayPortfolio(journal));
}

console.log('portfolio admission scenarios: ok');
