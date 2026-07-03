# ADR 0028: Generic IM Scene Agent

## Status

Accepted.

## Context

Zhin IM agents previously mixed several overlapping concepts: `IMSessionScope`, flat cron notify fields (`platform` / `endpointId` / `sceneId`), `IGroupManagement`, `CollaborationCell`, `group_mention`, and `im_cell` / `im_session` orchestration sources. Platform adapters, assistant jobs, orchestration kernel, and collaboration REST each used slightly different naming and shapes for the same idea: **an IM scene** (private DM, group, or channel) plus optional **delivery target** metadata (thread, quote, parent scene).

This ADR unifies the vocabulary and makes the breaking release explicit.

## Decision

### 1. Core scene contract (`@zhin.js/core`)

| Type | Role |
| --- | --- |
| `IMSceneKind` | `private` \| `group` \| `channel` (replaces `IMSessionScope`) |
| `IMSceneRef` | Canonical scene identity: platform, endpoint, sceneId, kind, optional senderId, optional parent scene |
| `IMDeliveryTarget` | Scene + optional `threadId` / `quoteId` for reply chains |
| `sceneRefFromMessage` | Derive scene from inbound `Message` |
| `messageToIMDeliveryTarget` | Full delivery target for outbound / notify |
| `sceneRefToSendOptions` | Map to adapter `SendOptions` |
| `resolveIMSceneSessionId` | Four-segment session id (unchanged structure; `kind` replaces `scope`) |

**Parent vs thread/quote**

- `parent` on `IMSceneRef`: cross-scene ownership (e.g. thread lives under a group).
- `threadId` / `quoteId` on `IMDeliveryTarget`: reply chain within the same scene.

### 2. Scene management adapters

- `IGroupManagement` → `ISceneManagement` (no public alias).
- Tool permits: `scene_admin`, `scene_owner`.
- All 11 IM adapters switch atomically.

### 3. Assistant notify (breaking)

```ts
type JobNotify =
  | { channel: 'im'; target: IMDeliveryTarget }
  | { channel: 'ha'; service: string; target?: string }
  | { channel: 'silent' }
  | { channel: 'log' };
```

- `ASSISTANT_JOBS_VERSION = 2`.
- Removed: `LegacyImJobNotify`, flat `{ platform, endpointId, sceneId, scope }`, `commMessageToImNotify`, `notifyToSendOptions`.
- Use `parseJobNotify` + `imNotifyToSendOptions` → `sceneRefToSendOptions`.
- Old `cron-jobs.json` / `assistant-jobs.json` without `target` **must be rebuilt**.

### 4. Orchestration run source

```ts
type OrchestrationRunSource =
  | { kind: 'im_scene'; scene: OrchestrationSceneRef; collaborationSceneId?: string }
  | { kind: 'manual'; label?: string };

type OrchestrationExecutorKind = 'local' | 'scene_mention' | 'remote_mesh';
```

- New writes use `im_scene` + optional `collaborationSceneId` (links kernel run to `CollaborationScene`).
- `group_mention` executor renamed to `scene_mention`; **private scenes rejected**.
- DB read aliases: legacy `im_cell` / `im_session` sources and `group_mention` executor normalize at load time.

### 5. Collaboration scene (breaking)

| Old | New |
| --- | --- |
| `CollaborationCell` | `CollaborationScene` |
| `collaboration_cells` | `collaboration_scenes` |
| `collaboration_cell_members` | `collaboration_scene_members` |
| `collaboration_cell_artifacts` | `collaboration_scene_artifacts` |
| `collaboration_cell_scenes` | `collaboration_scene_aliases` |
| `collaboration_cell_member_channels` | `collaboration_scene_member_channels` |
| Member FK `cell_id` | `collaboration_scene_id` |
| `logical_cell_id` | `logical_scene_id` |
| `GET /api/collaboration/cells` | `GET /api/collaboration/scenes` |

- **No DB upgrade hook** for collaboration tables. Wipe database and re-run `/collab init`.
- `/collab` user-facing commands unchanged.
- Cell context session key prefix: `collab-scene:` (was `cell:`).

### 6. DB migration policy

- Fresh installs register new table names only.
- Removed `upgrade-collaboration-db-schema.ts`.
- Existing deployments: wipe `collaboration_*` / orchestration tables or recreate DB; no lazy migrate.

## Consequences

- Single SSOT for IM scene identity in core; agent and ai layers bridge without violating dependency direction.
- Breaking release: document wipe + job file rebuild in release notes.
- Host Console / REST clients must call `/scenes` and expect `scenes` in list payloads.
- Five-agent and pipeline tools use `CollaborationScene` + kernel tasks; cell-level pipeline state is legacy only.

## Related

- [ADR 0023](./0023-group-cell-multi-endpoint-agents.md) — collaboration scene model (revised)
- [ADR 0027](./0027-agent-run-orchestration-kernel.md) — orchestration kernel
- `packages/im/core/src/im-scene.ts` — scene contract SSOT
