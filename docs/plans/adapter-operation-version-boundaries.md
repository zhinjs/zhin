# Adapter operation patch cutover and version boundaries

Status: **adopted patch boundary; Adapter provider/consumer metadata implemented; generator and
full release acceptance are tracked separately**. Npm package versions have not been bumped. The user
has approved npm patch releases despite the intentional authoring changes. This approval supersedes
the earlier major-release proposal. It does not authorize merging, publishing, deploying, changing
release gates, running a prerelease workflow, or migrating production data.

## 1. Adopted cutover

Ship one coordinated **patch batch**, with an explicit compatibility notice. Keep the existing
patch-only version policy and release workflow. Use the existing Adapter Feature API contract to
express its incompatible interface separately from the npm package version:

| Boundary | Before cutover | Proposed cutover | Existing enforcement |
| --- | --- | --- | --- |
| Public application facade | `zhin.js <=1.1.18` | `zhin.js >=1.1.19 <2.0.0` | New plugin peer floor and tested installation/lockfile |
| Core | `@zhin.js/core <=1.1.53` | `>=1.1.54 <2.0.0` | New plugin/core dependency and peer floors |
| Adapter package | `@zhin.js/adapter <=1.1.25` | `>=1.1.26 <2.0.0` | New dependency/peer floor |
| Adapter semantic API | `featureApi: 1.0.0`; consumers `api: ^1.0.0` | Provider `featureApi: 2.0.0`; migrated consumers `api: ^2.0.0` | Existing `assertFeatureApi`, independent of npm semver |
| Canonical Registry declaration | FeatureKit through `1.1.9` / legacy augmentation sites | `@zhin.js/feature-kit >=1.1.10 <2.0.0`; augment only its module | Direct dependency (custom peer + dev), declaration/packed-consumer checks |
| Agent removed exports / feedback source | `@zhin.js/agent <=1.1.44` | `>=1.1.45 <2.0.0` | npm dependency/peer floor; no Feature API check for arbitrary JS imports |
| Runtime / isolate event implementation | `<=1.1.15` | Both packages `>=1.1.16 <2.0.0` | Dependency floors and coherent Host installation |
| Plugin Runtime contracts | `<=1.1.17` | `>=1.1.18 <2.0.0` | Exact internal dependencies; custom Host peer floor |
| Host HTTP semantic controls | `<=1.1.11` | `>=1.1.12 <2.0.0` | Dependency/peer floor and Host contract tests |
| Game routing / migration helpers | `@zhin.js/game-kit <=1.1.18` | `>=1.1.19 <2.0.0` | Dependency floor and selected data migration; not a new Feature API epoch |
| CLI / creation / wizard | CLI `<=1.1.23`; create `<=1.1.13`; wizard `<=1.1.12` | CLI `1.1.24`; create `1.1.14`; wizard `1.1.13` | Correct generated manifests, package floors and packed project acceptance |

The upper bounds in the old column are **support boundaries for the previous implementation**,
not npm metadata retroactively written into already-published packages. The new ranges state a
minimum compatible batch; they are not evidence that every future patch has already been tested.
For each official Adapter row in Appendix A, the current column is the last pre-cutover plugin
version and the proposed column is its first API-2 version. Keep those old plugins with the
pre-cutover Host/Adapter lockfile; install the new plugin and new Host cohort together.
Exact package versions for all 105 public workspace packages are listed in Appendix A.

### What the existing admission path can prove

`packages/im/runtime/src/package-contract.ts` checks declared Feature API ranges against the
selected provider. With Adapter API 2, an old **explicit** `api: ^1.0.0` consumer is refused on the
new provider, and a new `api: ^2.0.0` consumer is refused on provider API 1. Both checks must fail
before Adapter creation/login or plugin setup that performs effects.

This is a semantic Feature API bump, **not** an npm major bump or release-gate exception.
`zhin.protocol` remains `1`: the manifest envelope has not changed. Other Feature API versions
remain unchanged; no blanket API-2 upgrade is proposed for Command, GameKit or unrelated Features.

There is an important limit: `assertFeatureApi` returns when `reference.api` is absent;
`assertPackageEngine` returns when `zhin.engine` is absent. No default API range is inferred. A malformed provider `featureApi` still fails validation even when
the consumer omits `api`; preserve that existing ordering.
`mergeFeatureReferences` also lets an explicitly declared Root reference override the inherited
Core reference. Therefore this plan does **not** promise to detect every old or manually overridden
plugin. Undeclared compatibility is unknown and requires the operator/author to check and pin the
supported package set. Do not add a missing-metadata rejection, hidden default, plugin registry or
new admission policy as part of this cutover.

`runtimeEngineVersion` is currently the independent constant `1.0.0`. It is not the npm Runtime
version; `zhin.engine: ^1.0.0` cannot enforce the npm patch floors above. Keep this engine contract
unchanged. `engines.zhin` is not the field this Runtime checks. The Node floor remains `>=22.19.0`.

For non-Adapter plugins using changed Agent, Host or GameKit helpers, an npm peer/dependency floor
and the installation acceptance matrix are the boundary. A compatible pure-text plugin need not
be rejected merely because its package was published before this batch. A plugin using the old
removed/positional APIs is supported only with the old locked dependency set until recompiled and
republished; do not certify it on the new Host from a broad `^1.0.0` declaration alone.

## 2. Breaking changes versus additive/internal work

| Change | Classification | Required author/operator action |
| --- | --- | --- |
| Endpoint control and management use named requests, including `signal` | Public source/runtime break | Update implementations and callers together; preserve native SDK signatures |
| Outbound Host controls route from canonical MessageRef/ConversationRef, removing duplicate account selectors | Public request-shape break | Remove `adapter`/`endpointKey` from recall/edit/reaction/typing controls; retain canonical refs |
| Only `@zhin.js/feature-kit` augments `AdapterRegistry` | Authoring/type compatibility break | Move augmentation and add a direct FeatureKit peer + dev dependency; retain literal platform inference |
| Native Endpoint/Adapter target contract from the pending adapter migration | Deliberate authoring/config break | Use `createAdapter`, actual Client inheritance and `endpointSpec`; no removed factory/base-class shim |
| Satori and OneBot12 select `platform + userId`; WeCom requires separate `agentId` | Configuration break | Supply actual account/application identity; do not infer or reuse a secret as `agentId` |
| Agent feedback helper functions/types removed | Public export break | Replace removed helpers with source-bound feedback adapter/capture, using the new Agent floor |
| Historical alias-only destination/grant records stop authorizing current identities | Persisted behavior/security boundary | Explicit selected binding; fresh permissions; no automatic notification replay |
| Owner approval file reads V2 into inactive legacy data and writes V3 | Persisted format and downgrade boundary | Backup and coordinate code plus data recovery; old code cannot parse a V3 file |
| `CommandIndex.dispatch`, RuntimeMessage construction, renderer/menu helpers | Exported/internal call migration; some are documented programmatic paths | Use the documented named request contracts; no positional shim; do not cite internal changes alone as a stable-API guarantee |
| Captured operations, independent `retain`, Root-only `stopSignal`, control IPC, migration provider APIs | Additive contracts plus approved lifecycle behavior | Retain/release exact authority; choose HMR task policy; custom Host/isolate implementations must implement the new required fields |
| Receiver preservation, canonical routing, cancellation and truthful unknown outcomes | Correctness fixes | Preserve integration regressions; do not turn unknown effects into safe retries |

The release note must say explicitly: **this patch batch contains intentional plugin/API breaks;
use the cutover matrix and migration guide**. Patch classification is a user-approved release
choice, not a compatibility guarantee or a reason to relax a test.

## 3. Adopted metadata and generator scope

Provider/consumer metadata in steps 1–3 is implemented. Generator work and final packed acceptance
remain explicit deliverables; there is no repeated request to confirm the adopted boundary:

1. In `packages/im/adapter/package.json`, set only `zhin.featureApi` from `1.0.0` to `2.0.0`.
   The npm version is the patch result `1.1.26`; do not hand-edit it ahead of normal versioning.
2. In `packages/im/core/package.json`, change only its Adapter Feature reference to `api: ^2.0.0`.
   This is the inherited platform-feature requirement for normal applications.
3. In each of the **22 official Adapter package manifests** below, change only the Adapter
   Feature reference to `^2.0.0`. Existing other Feature ranges, Node engines, config defaults,
   credentials, optional peers and runtime modes retain their meanings.
4. The generated Adapter plugin manifest must declare `@zhin.js/adapter` Feature API `^2.0.0`;
   normal/service generators must not mechanically assign API 2 to all capabilities.
   The existing implementation is `basic/cli/src/commands/new-plugin-manifest.ts`, currently
   `capabilities.map(... api: '^1.0.0')`. Change that existing selection seam, not a new registry.
5. Generated peer/dev ranges must meet the tested package floors. The current resolver prefers
   a project's installed versions and falls back to `^1.0.0`; neither may make a new Adapter
   scaffold claim compatibility with an old installed Adapter/FeatureKit. Resolve the new floor
   through the existing generator/packed version metadata and reject an actually incompatible
   generation attempt rather than silently rewriting the application's dependencies.
6. Update actual Adapter snippets, fixture manifests and packed-consumer tests that declare
   the Adapter API. Explicit API-1 fixtures remain for negative compatibility tests. Private
   examples inherit the Core requirement unless they already declare a concrete Adapter range;
   do not add declarations just to make every manifest look identical.
7. Restore a patch changeset for this batch with its explicit breaking notice and complete
   package coverage after inventory review. Preserve all 14 pre-existing changesets. Keep
   `defaultReleaseType: patch`, `approvedNonPatchReleases: []`, `fixed: []`, `linked: []`, the
   release coverage gate, full validation proof and npm production approval unchanged. Record
   this explicit user-approved compatibility cutover in `docs/contributing/development.md`, whose
   current absolute prohibition on incompatible patch releases would otherwise contradict it;
   do not turn that documentation correction into a blanket compatibility waiver.

The complete current manifest edit list for step 3 is:

- `plugins/adapters/bilibili/package.json` (`@zhin.js/adapter-bilibili`).
- `plugins/adapters/bilibili-live/package.json` (`@zhin.js/adapter-bilibili-live`).
- `plugins/adapters/dingtalk/package.json` (`@zhin.js/adapter-dingtalk`).
- `plugins/adapters/discord/package.json` (`@zhin.js/adapter-discord`).
- `plugins/adapters/email/package.json` (`@zhin.js/adapter-email`).
- `plugins/adapters/github/package.json` (`@zhin.js/adapter-github`).
- `plugins/adapters/icqq/package.json` (`@zhin.js/adapter-icqq`).
- `plugins/adapters/kook/package.json` (`@zhin.js/adapter-kook`).
- `plugins/adapters/lark/package.json` (`@zhin.js/adapter-lark`).
- `plugins/adapters/line/package.json` (`@zhin.js/adapter-line`).
- `plugins/adapters/milky/package.json` (`@zhin.js/adapter-milky`).
- `plugins/adapters/napcat/package.json` (`@zhin.js/adapter-napcat`).
- `plugins/adapters/onebot11/package.json` (`@zhin.js/adapter-onebot11`).
- `plugins/adapters/onebot12/package.json` (`@zhin.js/adapter-onebot12`).
- `plugins/adapters/qq/package.json` (`@zhin.js/adapter-qq`).
- `plugins/adapters/sandbox/package.json` (`@zhin.js/adapter-sandbox`).
- `plugins/adapters/satori/package.json` (`@zhin.js/adapter-satori`).
- `plugins/adapters/slack/package.json` (`@zhin.js/adapter-slack`).
- `plugins/adapters/telegram/package.json` (`@zhin.js/adapter-telegram`).
- `plugins/adapters/wechat-mp/package.json` (`@zhin.js/adapter-wechat-mp`).
- `plugins/adapters/wecom/package.json` (`@zhin.js/adapter-wecom`).
- `plugins/adapters/weixin-ilink/package.json` (`@zhin.js/adapter-weixin-ilink`).

There are 23 current consumer manifests including Core, plus the Adapter provider manifest.
These files are the exact inventory of the implemented existing-field edits. No runtime engine or missing-metadata policy change is included.

## 4. Custom plugin and Host migration

For an Adapter plugin, publish a new plugin version with this shape (package versions are
minimums from this batch, not the Adapter Feature API version):

```json
{
  "peerDependencies": {
    "zhin.js": ">=1.1.19 <2.0.0",
    "@zhin.js/core": ">=1.1.54 <2.0.0",
    "@zhin.js/adapter": ">=1.1.26 <2.0.0",
    "@zhin.js/feature-kit": ">=1.1.10 <2.0.0"
  },
  "zhin": {
    "protocol": 1,
    "type": "plugin",
    "entry": "./plugin.js",
    "engine": "^1.0.0",
    "features": [{ "package": "@zhin.js/adapter", "api": "^2.0.0" }]
  }
}
```

Add the same authoring packages as direct dev dependencies for local compilation; keep the
existing supported SDK peer instead of replacing its native API. An Adapter class owns Endpoint
creation/update/destruction. The Endpoint extends the actual platform Client and implements the
Endpoint specification; SDK callbacks and payload identity remain native. Register the actual
Adapter type in `declare module '@zhin.js/feature-kit'`, loaded once by the project's type graph.
Command/Handler/Middleware declarations still use `adapter: 'icqq'` rather than importing a class
for each command. Test both positive native inference and wrong-platform negative cases against
packed declarations, without `skipLibCheck` hiding duplicate Registry graphs.

Migrate semantic port calls, not SDK signatures:

```ts
await control.recall?.({ message, signal });
await management.muteGroupMember?.({ groupId, userId, durationSeconds, signal });
await outbound.recall?.({ message }); // canonical ref; no duplicate account selectors
```

Custom Host integrations must adopt the documented RuntimeMessage facts/operation objects,
`SnapshotReader.retain(lease)`, required event subscriptions, exact source-Client capture and
cooperative isolated `controlEvent`. Release captures in `finally`; `release()` rejects new calls
while accepted calls retain their authority until settlement. `stopSignal` is the Root close fact;
`retirementSignal` is replacement. HMR `events.on('hmr.pause'/'hmr.resume')` lets a concrete instance
choose its task policy; it does not grant retired admission or automatically clear migration
maintenance. A custom isolate must implement correlated cancellation without killing its transport
merely because a control event signal aborts.

The final user guide must include all removed feedback export names and replacements, not just
"upgrade Agent": `enableActivityFeedbackForBot`, `isGenericActivityFeedbackManager`,
`EndpointWithActivityFeedback`, `ActivityFeedbackSendPort`, `PlatformActivityFeedbackManager`,
`PlatformActivityFeedbackStartOptions`, and `BotActivityFeedbackManager`. New feedback must carry
a real operation source and use the captured canonical outbound path, never resolve a replacement
account by its display alias.

## 5. Installation, acceptance and release sequence

1. **Review the implementation against this adopted boundary.** Adapter API 2 within patch npm
   releases, exact floors/old upper bounds and unchanged missing-metadata semantics are the
   agreed scope. No merge/publication is authorized by this document.
2. **Implement the boundary through existing fields.** Update the listed metadata, generator,
   fixtures and Chinese/English upgrade docs; preserve the patch gate and unrelated changesets.
   Refresh the in-memory release plan if any package version/head/pending change has moved.
3. **Validate the complete candidate.** Run affected regressions, public API/declaration checks,
   adapter-doc/config/install-tier checks, `pnpm check:all` and scripted `pnpm eval:agent` on the
   exact candidate. Source and mocked checks are separate from actual `lib` and packed consumers.
4. **Pack and install locally before any registry publication.** Apply candidate versions only
   in an isolated release-validation copy; leave the implementation checkout unversioned. Pack the
   dependency closure and install it under strict pnpm peers. Test a clean minimal IM project,
   optional AI project, each generated plugin kind, all 22 Adapter declarations and the existing
   29-package scaffold path. Inspect tarball peer ranges and rewritten `workspace:*` dependencies;
   validate actual `lib` imports and shared type/runtime identities.
5. **Prove refusal and success.** Test old explicit Adapter API `^1` on API 2, new API `^2` on
   API 1, valid API-2 consumers, and unchanged omitted-api handling. Verify failure occurs before
   login/SDK construction. Test normal inherited Core features and explicit Root overrides without
   claiming all override combinations are certified. Check npm peer conflicts on old Core/Agent
   floors, with both valid and invalid actual packed installations.
6. **Offline upgrade rehearsal on copied data.** Inventory custom plugin versions and their API
   use; pin the old or complete new stack. Preserve account IDs/configuration/credentials and all
   existing migrations, then rehearse selected binding, interrupted apply/reconcile, conflict,
   explicit resume, exact restore and software-plus-data rollback using disposable data only.
7. **Optional public candidate, only with fresh publication approval.** Prefer local tarballs
   first. A published prerelease would need a reviewed `next` tag and existing Changesets pre-mode
   procedure in the release checkout; it is not silently covered by patch approval. Do not enter
   pre-mode, publish or change default tags during implementation. Any prerelease rehearsal must
   also verify generator ranges retain the candidate suffix: the current CLI `caretRange()` strips
   it, whereas the wizard range helper preserves it; a candidate must not silently target an
   unavailable stable floor or install an older stack. Never call a provider or log in
   real accounts merely to validate this batch without that action's authorization.
8. **Version/release review, then deployment review.** Review generated versions, CHANGELOG,
   dependency ranges, compatibility notice and exact full-validation proof. Use existing version
   PR/publication approvals. Promote/deploy only after explicit approval; do not enable auto-merge
   or remove existing patches/configuration. Do not claim CI or production acceptance from local
   tests. The Remote Console is a separate application; validate migration HTTP behavior directly
   and do not imply that a new migration page has shipped there.

Update install/upgrade documentation through existing SSOT paths: `docs/snippets/install-tiers.md`,
root READMEs, `docs/authoring/adapters.md` and its English counterpart, adapter/command authoring
examples, `docs/concepts/plugin-model.md`, `docs/concepts/generation-lifecycle.md`, deployment
instructions and generator tests. Keep IM-only and optional AI tiers distinct. Explain the package
floor versus Feature API distinction in one version table; do not copy independent thresholds into
unrelated UI or runtime rules.

## 6. Production data cutover and recovery

Code upgrade and data binding are different approvals. The already-approved migration capability
does not authorize a live migration run. Before a deployment, take a consistent backup of the old
lockfile/package set, account identity store and its encrypted-key material, databases/plugin state,
Owner approval file, and any existing migration plans/journals. Test restoration using a disposable
copy. Do not collect credentials or production before-images into this document, logs or a PR.

The existing authenticated entry is `GET /api/data-migrations` (provider discovery), owner preview,
then `POST /api/data-migrations/commands`. Prepare selects `owner`, `candidateId`, `expectedDigest`
and a complete canonical target. Later mutations accept only the persisted `planId`. Plans live in
`data/migration-plans/<uuid>.json` with private directory/file permissions; preserve them together
with the provider's domain journal. Never infer a real account, parent channel/thread or individual
session from an old alias. Account remove/replacement after preparation must be rechecked at apply.

| Observed phase | Safe next step; each mutation remains explicit |
| --- | --- |
| Unresolved historical data | Leave originals intact; operator selects exact scope/target, or finish old active games before upgrade |
| Prepared | Review full before-images/count/digests and selected identity; do not start/login an account |
| Confirmed apply, maintenance paused | Inspect exact data/journal; review and explicitly resume; no schedule/deadline extension or notification replay |
| Timeout/disconnect/unknown commit | Reconcile authoritative rows and journal; do not retry apply from a missing receipt or a failed lookup |
| Confirmed restore, maintenance paused | Verify restored rows and explicitly resume; restore is not the same as returning to the old software |
| Changed after-image | Report conflict; never overwrite newer business changes. Verified `resumable` permits only releasing maintenance, not data writes |
| Unprovable state or in-flight mutation | Keep outcome unknown; preserve plan/journal and diagnose. No automatic replay/resume |

Historical Owner grants are preview-only. New V3 approval keys use canonical account identity;
V2 grants are preserved as inactive legacy entries, never copied into active permissions. New
approval writes persist V3, and old software accepts only V2: installing old binaries alone is not
a rollback. Restore the verified pre-upgrade approval file together with its old code/lockfile, or
use a separately reviewed explicit data conversion. Never reactivate a legacy grant merely to make
rollback appear successful. Preserve new V3 evidence separately if the operator chooses a full
backup restore; do not silently discard intervening approvals or business records.

For domains with after-image protection, restore only when actual rows still match. If the new
system has accepted later business writes, a full old backup would discard them; stop and present
a concrete recovery choice instead of pretending a code rollback is lossless. Migration-plan and
domain-journal evidence survives failed file writes, HMR and restart; missing provider/journal state
is not proof that a commit did not happen. See the implemented protocol and recovery details in
[the data migration plan](./adapter-operation-data-migration.md).

## 7. Evidence and dependency propagation

This inventory reads the current manifests and **all 14 existing pending changesets**. An installed,
read-only in-memory simulation used `@changesets/assemble-release-plan 6.0.10`, config `3.1.4` and
workspace discovery through the installed release-plan tool. It did not run `changeset version`,
pre-mode or publish, write package manifests, change a lockfile, or mutate Git.

- Public workspace packages: **105**.
- Existing pending batch alone: **88 patch releases**, plus 14 `none` bookkeeping entries.
- Existing batch plus 55 explicit proposed patch seeds: **the same 88 patch releases**.
  This batch overlaps the existing dependency closure; it does not add 55 more version increments.
- Public packages outside that patch plan: **17**, unchanged. `zhin` is the existing `4.0.1` CLI
  alias and remains `4.0.1`; it is not renamed or lowered to `1.1.x`.
- No minor/major npm releases, fixed groups or linked groups are introduced. Adapter Feature API 2
  is an independent manifest field and therefore does not alter Changesets' npm bump calculation.

Concrete existing edges explain the propagation:

| Dependent | Existing dependency | Effect in proposed patch batch |
| --- | --- | --- |
| FeatureKit | `plugin-runtime: workspace:*` | Exact internal version updates; patch release |
| Adapter | `feature-kit`, `plugin-runtime: workspace:*` | Internal contract closure updates |
| Core | `adapter`, `command`, `handler`, `middleware`, `plugin-runtime: workspace:*` | Core patch and coherent platform features |
| `zhin.js` | `core`, `permission`, `plugin-runtime: workspace:*` | Facade patch to `1.1.19` |
| CLI | `runtime`, `core`, `host-http`, `scaffold-wizard`, etc. `workspace:*` | CLI patch to `1.1.24` |
| Isolate | `runtime`, `plugin-runtime: workspace:*` | Isolate patch to `1.1.16` |
| Official ICQQ | Direct Adapter/Core/FeatureKit plus `workspace:^` peers | Dependencies updated; published peers start at the new patched versions |
| Tic-tac-toe | `core`, `game-kit: workspace:*`; `zhin.js: workspace:^` peer | Canonical game package patch and new floor |
| `create-zhin-app` | `scaffold-wizard: workspace:*` | Creation template patch to `1.1.14` |
| `zhin` alias | CLI `workspace:^` | The CLI patch remains in its existing caret range, so no alias version bump |

The installed assembler treats `workspace:*` as the current exact version, regular dependency
out-of-range propagation as patch, and out-of-range peer major/minor bumps differently. This plan
uses only patch seeds; do not replace that algorithm with a hand-written "bump everything" rule.
The evidence is `/tmp/zhin-patch-boundary-evidence.json` and the reproducible read-only script
`/tmp/zhin-patch-boundary-simulation.cjs`. These temporary files contain package/graph metadata only;
the reviewed table below is the durable repository artifact. Refresh it against the final release
head before versioning. No npm registry state or real-provider capability was queried.

## Appendix A. Complete proposed npm version inventory

`D` = explicit seed for this batch (includes generator work required by this plan);
`B` = explicitly covered by an existing pending changeset; `P` = dependency-propagated patch;
`—` = no version change in this calculation. All proposed changes are patch increments.

| Package | Current workspace version | Proposed version | Reason |
| --- | --- | --- | --- |
| `@zhin.js/a2a` | `1.1.20` | `1.1.21` | P |
| `@zhin.js/adapter` | `1.1.25` | `1.1.26` | D |
| `@zhin.js/adapter-bilibili` | `0.1.1` | `0.1.2` | D |
| `@zhin.js/adapter-bilibili-live` | `0.1.1` | `0.1.2` | D |
| `@zhin.js/adapter-dingtalk` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/adapter-discord` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/adapter-email` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/adapter-github` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/adapter-icqq` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/adapter-kook` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/adapter-lark` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/adapter-line` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/adapter-milky` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/adapter-napcat` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/adapter-onebot11` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/adapter-onebot12` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/adapter-qq` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/adapter-sandbox` | `1.1.20` | `1.1.21` | D |
| `@zhin.js/adapter-satori` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/adapter-slack` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/adapter-telegram` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/adapter-wechat-mp` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/adapter-wecom` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/adapter-weixin-ilink` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/agent` | `1.1.44` | `1.1.45` | D |
| `@zhin.js/agent-feature` | `1.1.10` | `1.1.11` | P |
| `@zhin.js/ai` | `1.1.48` | `1.1.49` | B |
| `@zhin.js/cli` | `1.1.23` | `1.1.24` | D |
| `@zhin.js/client` | `1.1.21` | `1.1.22` | B |
| `@zhin.js/command` | `1.1.11` | `1.1.12` | D |
| `@zhin.js/component` | `1.1.10` | `1.1.11` | P |
| `@zhin.js/components` | `1.1.8` | `1.1.8` | — |
| `@zhin.js/config-file` | `1.1.9` | `1.1.10` | P |
| `@zhin.js/console-contract` | `1.1.3` | `1.1.3` | — |
| `@zhin.js/console-protocol` | `1.1.12` | `1.1.12` | — |
| `@zhin.js/contract` | `1.1.16` | `1.1.17` | P |
| `@zhin.js/core` | `1.1.53` | `1.1.54` | D |
| `@zhin.js/database` | `1.1.5` | `1.1.5` | — |
| `@zhin.js/feature-kit` | `1.1.9` | `1.1.10` | D |
| `@zhin.js/game-kit` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/handler` | `1.1.9` | `1.1.10` | D |
| `@zhin.js/host-http` | `1.1.11` | `1.1.12` | D |
| `@zhin.js/host-http-contract` | `1.1.1` | `1.1.1` | — |
| `@zhin.js/html-renderer` | `1.1.3` | `1.1.3` | — |
| `@zhin.js/im-contract` | `1.1.9` | `1.1.9` | — |
| `@zhin.js/interaction` | `1.1.2` | `1.1.2` | — |
| `@zhin.js/isolate` | `1.1.15` | `1.1.16` | D |
| `@zhin.js/jsx` | `1.1.8` | `1.1.8` | — |
| `@zhin.js/kernel` | `1.1.5` | `1.1.5` | — |
| `@zhin.js/layout` | `1.1.10` | `1.1.11` | P |
| `@zhin.js/logger` | `1.1.2` | `1.1.2` | — |
| `@zhin.js/mcp` | `1.1.19` | `1.1.20` | P |
| `@zhin.js/mcp-feature` | `1.1.10` | `1.1.11` | P |
| `@zhin.js/middleware` | `1.1.10` | `1.1.11` | B |
| `@zhin.js/page` | `1.1.10` | `1.1.11` | P |
| `@zhin.js/pagemanager` | `1.1.17` | `1.1.18` | P |
| `@zhin.js/permission` | `1.1.9` | `1.1.10` | P |
| `@zhin.js/plugin-60s` | `1.1.12` | `1.1.13` | P |
| `@zhin.js/plugin-answers` | `0.0.7` | `0.0.8` | D |
| `@zhin.js/plugin-bilibili` | `0.1.5` | `0.1.6` | D |
| `@zhin.js/plugin-blackjack` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/plugin-calendar` | `0.1.9` | `0.1.10` | P |
| `@zhin.js/plugin-code-runner` | `1.1.12` | `1.1.13` | P |
| `@zhin.js/plugin-content-moderation` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/plugin-dice-duel` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/plugin-dungeon-expedition` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/plugin-earthquake` | `0.1.5` | `0.1.6` | D |
| `@zhin.js/plugin-game-hub` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/plugin-group-suite` | `1.1.18` | `1.1.19` | P |
| `@zhin.js/plugin-guess-number` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/plugin-idiom-chain` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/plugin-ledger` | `1.0.2` | `1.0.2` | — |
| `@zhin.js/plugin-link-poster` | `1.1.18` | `1.1.19` | P |
| `@zhin.js/plugin-lottery` | `1.1.12` | `1.1.13` | P |
| `@zhin.js/plugin-music` | `1.1.18` | `1.1.19` | P |
| `@zhin.js/plugin-nettools` | `0.1.5` | `0.1.6` | P |
| `@zhin.js/plugin-qrcode` | `1.1.18` | `1.1.19` | P |
| `@zhin.js/plugin-reminder` | `1.0.8` | `1.0.9` | P |
| `@zhin.js/plugin-repeater` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/plugin-roulette` | `0.1.7` | `0.1.8` | D |
| `@zhin.js/plugin-rps` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/plugin-rss` | `1.1.12` | `1.1.13` | D |
| `@zhin.js/plugin-runtime` | `1.1.17` | `1.1.18` | D |
| `@zhin.js/plugin-short-url` | `1.1.12` | `1.1.13` | P |
| `@zhin.js/plugin-text-adventure` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/plugin-tic-tac-toe` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/plugin-word-riddle` | `1.1.18` | `1.1.19` | D |
| `@zhin.js/process-monitor` | `1.1.12` | `1.1.13` | P |
| `@zhin.js/prompt-section` | `1.1.9` | `1.1.10` | P |
| `@zhin.js/runtime` | `1.1.15` | `1.1.16` | D |
| `@zhin.js/scaffold-wizard` | `1.1.12` | `1.1.13` | D |
| `@zhin.js/schedule` | `1.1.3` | `1.1.3` | — |
| `@zhin.js/schedule-feature` | `1.1.9` | `1.1.10` | P |
| `@zhin.js/schema` | `1.1.4` | `1.1.4` | — |
| `@zhin.js/service-activity-feedback` | `1.1.21` | `1.1.22` | D |
| `@zhin.js/service-typesafe` | `1.0.13` | `1.0.14` | P |
| `@zhin.js/skill` | `1.1.10` | `1.1.11` | P |
| `@zhin.js/speech` | `1.1.2` | `1.1.2` | — |
| `@zhin.js/tailwind` | `1.1.2` | `1.1.2` | — |
| `@zhin.js/testing` | `1.0.6` | `1.0.7` | D |
| `@zhin.js/tool` | `1.1.12` | `1.1.13` | P |
| `@zhin.js/workroom` | `0.0.13` | `0.0.14` | P |
| `create-zhin-app` | `1.1.13` | `1.1.14` | D |
| `zhin` | `4.0.1` | `4.0.1` | — |
| `zhin.js` | `1.1.18` | `1.1.19` | B |

## 9. Decision and implementation checklist

The implementation must preserve this adopted combination: npm patch cutover plus only
Adapter Feature API 2, the exact tested floors/old upper bounds, listed manifests/generator edits,
and unchanged undeclared-metadata behavior. It does not ask for a release-gate exception, a new
engine scheme, a missing-metadata ban or a new compatibility registry.

The reviewable implementation diff must show the 24 Adapter provider/consumer manifest
edits, generator floor selection, matching documentation and refusal/success tests. Maintain the
patch changeset with the breaking notice and actual affected packages; do not claim an existing
pending changeset's coverage proves compatibility. Re-run the exact release graph, packed-plugin
acceptance and full gates. Merging, registry publication, production deployment and live data
mutations each remain separate, explicit actions.
