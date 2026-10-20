# End-to-end smoke suite for the #829 user-experience loop

Tracking issue: #850. Each scenario walks one loop a user goes through — install, configure, apply,
verify, then talk to the bot — through the real Plugin Runtime. Nothing here talks to a real IM
platform or a real model.

| Scenario | Loop it covers |
| --- | --- |
| `scenarios/install-migrate-boot-diagnose.mjs` | v1 project → `configVersion: 2` migration → boot → commands and a group welcome → `GET /api/messages/diagnostics` |
| `scenarios/scenario-lab-export.mjs` | A scenario-lab (#843) export runs against the smoke bot; a wrong expectation fails |
| `scenarios/admission-and-welcome.mjs` | Command `execution` cooldown and concurrency (reply text, other members unaffected, diagnostics `limit`) → `welcomeConversations` applied as new generations: omitted, exact entry, topic mismatch, invalid entry rejected, `[]` |
| `scenarios/reminders-task-center.mjs` | `remind create 10分钟后 喝水` → preview with absolute time and timezone → “确认” → delivery on a fake clock → administrator create / pause / resume through the real `/api/tasks` routes |
| `scenarios/rss-quiet-hours.mjs` | Two admin RSS subscriptions via `/api/tasks` against a local feed server: baseline, overnight updates held for the quiet one and pushed for the normal one, one morning digest, no repeat |

## How it runs

- `harness/smoke-project.mjs` writes a disposable application to a temporary directory and links the
  workspace packages into it, so the run uses exactly the code in this checkout. Repository plugins
  are copied (sources only) and reuse their installed dependencies.
- Scenarios are native Node scripts (`node --conditions=development --import tsx`). Feature providers
  must come from the same Node loader as the application, so they never run inside the Vitest
  module graph. `smoke-loop.test.ts` starts each scenario in a child process and checks the
  `SMOKE_STEP` lines it printed.
- Each step is wrapped in `smokeStep()`, so a failure names the user-visible step that broke.
- Time-based loops use the kit's `FakeClock` with `FakeScheduleRootHost`; `harness/fake-wall-clock.mjs`
  points `Date.now` at the same clock inside the scenario process. `harness/smoke-hosts.mjs` installs a
  SQLite Database Host, the fake-clock Schedule Host and an Outbound Host that sends through the kit's
  real unified send chain, so proactive sends land in `kit.deliveries` like replies.

Run locally after `pnpm build`:

```bash
pnpm exec vitest run tests/e2e-smoke
# or one scenario, with its step log:
node --conditions=development --import tsx tests/e2e-smoke/scenarios/install-migrate-boot-diagnose.mjs
```

## Evidence boundary

Passing proves the runtime behaviour of these fixtures with synthetic endpoints, explicit test roles
and a disposable configuration. It does not prove platform login, role mapping, rendering fidelity or
delivery on a real platform; that stays a separate, manual acceptance step.
