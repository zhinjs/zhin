---
sidebar: false
---

# Adapter operation data migration proposal

Status: **approved on 2026-10-31; implementation in progress**. This document inventories
source schemas, not the contents of a user's database. No production data,
credentials or account APIs were read. The user approved the preview/bind procedure and explicit maintenance migration of active games.
This authorizes implementation; actual record selection, execution and resumption remain administrator actions.

Related: [operation contracts](./adapter-operation-contracts.md),
[Adapter target migration](./adapter-target-mode-migration.md).

## Why a separate decision is necessary

An account name is reusable. Old rows often contain only that name, and some
old games used `default` even when several accounts were connected. The current
directory cannot prove which historical account created such a row. A unique
current match, a matching QQ number, an ID-shaped string or a common group ID
is not proof that an old record belongs to the current account incarnation.

New captures preserve stable logical account identity and complete scene data.
That does not authorize reassignment, deletion, expiration or suspension of old
records. A malformed explicit canonical record is an error, never a reason to
fall back to an alias. Unresolved data remains readonly until an administrator binds the selected unit;
this is not a second authoring API.

## Exact source inventory

All database names below are **logical tables inside the owning plugin's
Database Host namespace**. Preview must retain Host/project and plugin owner
identity; an identically named table in another plugin instance is not the same
migration unit. Read only the namespaces selected by an administrator.

| Data | Historical identity fields | Stable row selection / evidence |
| --- | --- | --- |
| `guess_sessions`, `bj_sessions`, `dice_sessions`, `rps_sessions`, `word_riddle_sessions`, `idiom_chain_sessions`, `adv_sessions`, `dungeon_sessions`, `ttt_sessions`, `roulette_sessions` | `adapter`, `endpoint`, `channel_type`, `channel_id`, `channel_key`; locale and game state remain separate | `id`; also `revision` where present, `updated_at`, `status`, and full before-image digest |
| `roulette_sessions` additional fields | `endpoint_adapter`, `endpoint_id` may carry an exact historical Endpoint; parent/thread were not stored | Compare the complete saved EndpointRef with retained desired-account records; do not assume a matching suffix is canonical |
| `game_records` | `channel_key`, `user_id`, `game_id` | `id`, full before-image digest; original key must not be reconstructed from an account alias |
| `ttt_queue` | `channel_key`, `user_id` | integer `id`; a queue position belongs to the same selected scope |
| `ttt_moves`, `ttt_spectators` | `session_id` foreign reference, not an independent account selector | integer `id`; retain session IDs, moves, players and spectators when a session is explicitly mapped |
| `roulette_group_settings` | `id` is the old scene key; `mute_penalty` may enable moderation | scope plus full before image; a true moderation flag is authorization-sensitive and is not copied automatically |
| `rss_subscriptions` | `adapter_name`, `endpoint_id`, `channel_type`, `channel_id`; `url` identifies the feed | No declared primary `id`. Use the exact business tuple and a snapshot digest; memory-test IDs are not a storage contract |
| `bilibili_subscriptions` | same destination fields, plus `uid` and `kinds` | No declared primary `id`. Use exact business tuple and snapshot digest; preserve duplicate groups rather than choosing an arbitrary row |
| `rss_seen`, `bilibili_watch_state` | feed/UID cursors and deduplication state, not account authority | Do not reset or relabel cursors when moving one destination; they may serve multiple subscriptions |
| Earthquake plugin state key `subscriptions/v1` | JSON entries: `adapter`, `endpointKey`, `conversationKind`, `conversationId`, `createdBy`, locale and filters | owning state namespace, complete document digest, selected entry/group digest; mutations currently serialize the whole document |
| `<workspace>/data/owner-approve-always.json` historical version 2 | `endpoints[platform + '|' + endpoint + '|' + ownerId]` contains `bashAlways` and `bashRules` | full document digest and exact original key; the original owner and grant are retained for display, not imported as authority |

Schema sources: `plugins/games/*/src/models.ts`,
`packages/game-kit/src/game-records.ts`, `plugins/utils/rss/plugin.ts`,
`plugins/utils/bilibili/src/store.ts`,
`plugins/utils/earthquake/src/subscriptions.ts`, and
`packages/im/agent/src/security/owner-approval-store.ts`.

## Recognizing formats without guessing

- New game scope keys start with the exact `game-target-v1:` marker. The rest is
  JSON produced by the existing `encodeTaskTarget` codec. Decode using
  `decodeTaskTarget`; do not parse Endpoint ID components or old dash-separated
  keys. All game scope columns are unbounded `text` in the declared schemas.
- New RSS/Bilibili rows have explicit non-null `target_json`, containing the
  encoded complete target. Null/absent means historical format. Present but
  invalid JSON/codec fields means corruption or an unsupported format, not
  historical data and not permission to select a replacement account.
- New earthquake entries explicitly carry `target`; absence identifies the old
  entry shape. Validate that target using `normalizeDeliveryTarget`. Do not
  reinterpret an old `endpointKey` because it happens to resemble a UUID.
- Owner approval storage needs a separately versioned canonical address. The
  final new-document marker belongs to its storage implementation; preview
  records that version explicitly. Never infer the version from key shape.

These are format tests. They do not prove that a referenced account still
exists, that a sender is authorized, or that a platform operation can execute.

## Read-only preview

The proposed first operation produces a local preview without changing any
subscription, game, authorization, scheduler or account state. For each selected
namespace, show counts and precise IDs grouped as:

1. Canonical and valid: retain unchanged; include whether the logical account
   still exists. A removed logical identity is not redirected to a same-name one.
2. Historical with corroborating identity evidence: show the exact saved record,
   corroborating source and the proposed complete destination for review.
3. Historical without sufficient evidence: show available name/scene/owner facts
   and selectable current accounts, but make no preselected binding.
4. Conflicting, duplicate or malformed: show the conflicting row IDs/digests and
   retain the original bytes. No normalizer may silently discard these rows.

A preview includes a plan ID, schema/codec versions, namespace identity,
source revision or digest, row/group counts, selected canonical destinations,
unchanged state, deadline consequences, and precise proposed writes. It contains
no resolved credentials and does not invoke provider identity lookups.

Evidence is sufficient for a proposed binding only when an exact stored
EndpointRef is corroborated by the retained account repository or an existing
account migration record that preserves logical identity. A platform-user ID
alone is insufficient after delete/re-add: that operation deliberately creates
a fresh internal identity. If original parent/thread information was never
stored, it is unknown. The administrator must choose the complete scene or
leave the unit unresolved; absence must not silently mean the main channel.

For keyless subscription tables, duplicate rows with identical business keys
form one explicit migration group. If exact individual identity cannot be
proved, preview cannot offer an individual-row rewrite. An administrator may
select the complete group; its expected count and before-images are part of the
approved change. No implementation may rely on incidental query order or the
in-memory model's synthetic `id`.

## Proposed administrator choices

This proposal recommends a reviewable **bind selected data** operation; it does
not grant that operation or choose it for the user. Each unit can remain
unresolved, be explicitly bound to one complete canonical target, or be handled
under a separately approved archival/removal decision. There is no automatic
"use the only current match" option.

Binding ordinary data is separate from authorizing behavior:

- Subscription filters, locale and original creator remain unchanged. The
  preview identifies the destination and whether publishing through that
  selected account is intended. It does not enable the account or log it in.
- Game history may be explicitly associated only where provenance is accepted.
  Ambiguous statistics remain under their original historical key and remain
  distinguishable from canonical statistics; do not merge them into a new
  player's totals as a side effect of account selection.
- `bashAlways`, bash allow patterns and a roulette moderation-enabled flag are
  shown as **reauthorization candidates only**. They are never copied to a new
  account/scope as active grants. Any replacement permission must be approved
  through the current authorization flow for the exact new identity. Revoking
  or deleting the old grant is a separate explicit choice.
- Existing platform-plus-group rules retain their documented shared rule scope.
  This plan does not silently convert them to per-account rules or import an
  account's old operation authority into another account.

## Active games require a cutover decision

Keeping the old notification branch does **not** preserve an active old game.
New canonical command keys do not discover an old alias-keyed active session;
old buttons can fail their scope check, queue rows can become unreachable, and
an old timeout sweep can still emit an alias-addressed notice. The implementation
must not be presented as preserving full historical gameplay continuity.

Before deploying the new game input contract to a workspace with old active
sessions, the administrator must choose a reviewed cutover:

- **Finish under the old version first:** retain the old application and allow
  selected active games to finish before upgrading. This changes no records.
- **Explicitly map a provable active scope:** while affected game admission and
  cleanup are quiesced under an approved maintenance operation, rewrite the
  selected sessions, corresponding `ttt_queue` scope keys and selected record
  associations together. Preserve session IDs, player IDs, moves, spectators,
  turn, RNG state, revision/action history and status. Reject a destination that
  already has conflicting active players/games under the existing availability
  rules. Do not choose a winning row or merge two active games.
- **Leave unresolved / defer that cutover:** no automatic abort, reset or
  reassignment is authorized. A separate archive/finish choice may be proposed
  for data whose original scope cannot be recovered.

Mapping does not extend `deadline_at`, `updated_at`, cooldowns or game timeouts.
The preview displays elapsed deadlines and explains that existing cleanup rules
may finish the game on resumption. Any desire to freeze or extend time is a new
product decision, not an incidental migration implementation.

## Atomicity, conflicts and repeat execution

A later implementation must use the existing database/state transaction and
revision facilities; first verify that the selected Host supports the required
atomic unit. Do not invent a transaction API or replace it with a series of
compensating writes. If it cannot provide the required atomicity, stop before
writes and propose a controlled offline maintenance procedure for approval.

The migration unit includes the exact before-images, expected row/group count
and source revision/digest. Recheck these at commit. New messages, a scheduler
update, a changed subscription, a new canonical target, account replacement or
an authorization change invalidate the preview; return a conflict and prepare a
fresh preview. No automatic retry of a write whose result is unknown.

Record the plan/unit ID and before/after digests in the same committed unit or
an equivalently provable atomic migration record. Repeating a confirmed applied
unit verifies its after-image and makes no new writes or sends. A partial or
unknown result requires inspection of authoritative state before any recovery.
For earthquake's whole JSON document, compare and replace the exact document,
not just one array entry while silently overwriting concurrent entries.

## Delivery interruption and recovery

Preview never pauses schedulers. A future approved commit must quiesce only the
selected plugin tasks/scopes, wait for known in-flight delivery results, and
record their existing feed cursors/deduplication state before rebinding. A send
with an unknown remote outcome is not replayed. Binding does not reset a feed's
baseline or manufacture missed notifications. Any catch-up policy or automatic
resend needs its own approval; it is not included here.

After commit, validate readback, exact account existence and codec roundtrip,
then resume only tasks whose resumption was explicitly included in the reviewed
plan. The account remains stopped if it was stopped. Record the actual paused
interval and counts without claiming uninterrupted delivery.

Before mutation, preserve an access-controlled local backup of selected original
records and a tested recovery manifest. Reversal is possible only if the current
rows still match the migration's after-image. Otherwise report a conflict rather
than overwriting later gameplay, subscriptions or new permissions. Restore data
and code versions together: an old binary cannot be assumed to understand new
scope encodings. Never undo a platform message, kick, mute or provider charge by
restoring a database snapshot; those external effects require separate review.

## Implementation and acceptance gates after approval

- Dry-run twice against the same snapshot: identical units and no writes/sends.
- SQLite and a second supported transactional dialect: NUL IDs, complete
  parent/thread roundtrips, namespace isolation, keyless duplicate groups,
  transaction failure, changed before-image and concurrent scheduler writes.
- Explicit mapping preserves game identity/state; conflicting active games are
  refused. Unknown parent/thread stays unresolved. Expired deadlines are shown
  and retain existing semantics rather than being extended.
- New logical account after replacement does not inherit data or permissions
  without the selected data binding and a separate fresh grant where required.
- Crash before commit, after commit and unknown commit response: reconcile the
  same migration unit without duplicate updates or outbound replay.
- Canonical corruption never falls back to alias routing; old unresolved data
  remains recoverable and is not deleted by a new-format writer.
- Verify backup readback and a reversal against unchanged after-images; prove a
  concurrent post-migration edit blocks reversal.

The user approved readonly preview, administrator-selected exact bindings,
unresolved records remaining readonly without automatic effects, and explicit
maintenance-period migration of active games. This authorizes implementation,
not execution against a workspace. Actual record selections, account/scene
bindings, maintenance commits/resumption and fresh authorizations remain
administrator decisions in the resulting workflow.


## Administrator entry contract

The Host exposes authenticated endpoints; this change does not add a page to the separate
Remote Console repository. Every request requires an explicit full-scope bearer credential.
Demo, query-string identity, body-supplied roles and arbitrary filesystem paths do not authorize
migration. Responses are uncached and never include full before-images or raw historical grants.

- `GET /api/data-migrations`: locally declared provider owners and titles.
- `GET /api/data-migrations?owner=<plugin-id>`: readonly candidates, digest, counts and eligibility.
- `POST /api/data-migrations/commands` with `action: "prepare"`, `owner`, `candidateId`,
  `expectedDigest` and full canonical `target`: prepare the exact selected unit without writes.
- Subsequent POST commands contain only `action` and the returned `planId`. Actions are `apply`,
  `reconcile`, `resume`, and `restore`; a caller cannot substitute a plan or its before-images.
- `GET /api/data-migrations?planId=<uuid>`: durable plan summary and last confirmed inspection.

Preparation stores complete before-images and proposed writes in Host-owned
`data/migration-plans/<uuid>.json` files (directory `0700`, files `0600`). Files are atomically
replaced and synchronized before a domain mutation is admitted. They are not written to the
bounded small-object plugin state store. There is no automatic production migration or deletion.

`apply` leaves the affected scope paused. `resume` is a separate administrator decision and
cannot start an account or replay a notification. `restore` checks that the current records still
match the confirmed after-image and also leaves maintenance paused. Data conflicts do not permit
an overwrite. A confirmed rollback may preserve a separate recovery baseline: when inspection
proves that baseline unchanged, explicit resumption may release maintenance while the data status
still truthfully reports a conflict.

An interrupted operation remains unconfirmed. `reconcile` performs readonly inspection of the
actual records and durable domain journal, including the maintenance state. A missing receipt,
a failed query or an absent journal does not by itself prove success, failure or resumption.
In-flight mutations report unknown. No operation is automatically replayed to resolve uncertainty.
Historical Owner grants are preview-only candidates; current approval commands must create a
fresh grant for the canonical account identity. The existing Owner-wide policy is not broadened
or converted into a different scene policy by this storage-key migration.
