# @zhin.js/agent

## 1.1.43

### Patch Changes

- e0f991c: ADR 0039 slice A: add the `ai_group_rules` table and `AiGroupRules` store for dynamic group-ops rules — `draft → pending → active` with `rejected` / `expired` / `disabled` side states, optimistic `revision`, a canonical `content_hash` (any edit returns to draft), at most one active rule per group and trigger (approving a new one supersedes the old), and 24 h approval expiry. Adds audit kinds `group_rule` / `rule_enforcement` and the `rule_*` reason codes. Storage is bounded: per-field limits, at most 20 open drafts per group, terminal rows lose their summary immediately and are deleted after 30 days or beyond 50 per group (on startup and hourly). No behaviour change yet: drafting tools, approval cards and the executor land in later slices.
- 8846d5d: ADR 0039 slice B: group owners and admins can now set group moderation rules. A new `rule_draft` tool (`risk: safe`, group chats only) turns "remind advertisers first, then mute for 10 minutes" into a rule and submits it for approval; it refuses anyone who is not the group owner or an admin (by the live platform role on the message) and records `rule_draft_forbidden`. Each submitted rule posts a preview card to its group (trigger, ladder, durations, cool-down, exemptions and a short `content_hash` code), gated by the control plane. In the group, the owner/admins (plus `toolHardGate.imApproval.approverIds`) answer with `/rule approve <code>` / `/rule reject <code>` / `/rule disable <code|trigger>`, and anyone can list rules with `/rules`; the code changes whenever the rule changes, so an old card can't approve new content. The Console gets `plugin.root.group-rules` / `group-rule` (read, `control:read`), `group-rule-create` / `group-rule-disable` (`control:write`) and `group-rule-approve` / `group-rule-reject` (`ops:approve`). `AiGroupRules` gains `onTransition` listeners and `recordDraftForbidden`. No new disk state: rules use the existing bounded `ai_group_rules` table. Rules are not enforced yet; the executor lands in slice C.
- 8c85a2b: ADR 0039 slice C: approved group rules are now enforced. A new host-side `GroupRuleEnforcer` (reached through `AgentTurnIngressRoute.enforceGroupRule`) takes a reported violation and runs the current stage of the group's active rule for that trigger: `remind` / `warn` send a template reminder that @-mentions the member (control plane + session profile gated, optional recall of the original message); `mute` runs automatically with **no approval card**, using the rule's approval as the hard-gate approval (`ToolHardGate.checkPreApproved` now accepts `source: 'rule'`, reports `rule_hash_mismatch` for a tampered rule, and passes `ops_cooldown` when the gate has one), still stopped by `emergency_stop` / `read_only`; `suggest_kick` never kicks by itself — it raises a fresh `member` hard-gate card (deduplicated by `ops_cooldown`) and kicks only after a human approves. Owners/admins and whitelisted members are skipped (`rule_hit_exempt`); when the bot cannot moderate, it records `rule_hit_bot_not_admin` and tells the group once a day. Every hit writes one `kind=rule_enforcement` audit row that shares its `turn_id` with the hard-gate and outbound rows. Ladder progress is in memory only, capped and pruned after the quiet window; nothing new is written to disk. No detector calls the enforcer yet: `flood` (slice D) and the content-moderation migration (slice E) come next.
- 2cc80df: ADR 0040 slice A: self-change staging area `.zhin/changes/` — change object, forward-only state machine, `content_hash`, writable-target whitelist and forbidden config keys, `self_change` audit kind and `change_*` reason codes. Disk use is bounded (terminal states drop staged files, 14-day metadata retention, 24-hour idle expiry, 5 MB / 50 files per change, 50 MB total) with pruning at start-up and every 6 hours.
- 97bf337: ADR 0040 切片 B：`change_draft` 工具起草受控自我变更（只进暂存区，不生效），宿主生成预览——文件 diff 摘要、`InvalidationPlanner` 影响面、配置补丁重载级别（宿主段需重启、插件段热重载）。
- 43560d0: ADR 0040 切片 C1：`change_draft` 起草后宿主自动试跑静态检查（语法 / 约定默认导出 / harness 禁止导入 / SKILL.md 与 agent.json），通过进 `ready`，失败进 `trial_failed` 并把错误交回 Agent；`.tsx` 用 esbuild 检查，全程内存、不落临时文件。
- 1bf0253: ADR 0040 切片 C2：试跑沙箱加载（§3.3）——静态检查通过后把草稿所在插件根拷到系统临时目录、在一次性子进程的试跑运行时（只装 IM 运行时，无端点、无模型、无令牌，60 秒超时杀进程组）里装配，校验 `sandbox_load` 与 `capability_discovered`；拷贝用完即删，崩溃残留 1 小时后清理。同时补上 `stripComments` 的线性扫描（CodeQL js/polynomial-redos，#1064 合入时漏掉），指令目录里的非 `index.*` 辅助模块不再要求默认导出 `defineCommand`。
- ee9d38a: ADR 0040 slice C3: the self-change trial runs the drafted plugin's own tests in an isolated, offline container (read-only dependencies, writable throwaway copy) after the sandbox load; skipped without Docker, without tests, or when the tests fail even without the draft.
- eb306e1: ADR 0040 slice D: a self-change that passes its trial is submitted for approval as a `self` card in the hard-gate approval queue — always delivered to the owner's private chat (never settled in a business group), human-only, bound to the content hash, one pending change per conversation, 24-hour timeout, re-issued after restart; Console lists, approves and rejects changes.
- b76317d: ADR 0040 slice E1: add `SelfChangeApplier`, the apply / verify / rollback core for approved self-changes. It re-checks the approved `content_hash` (re-hashing every staged file) and the config `expectedRevision` before touching anything (mismatch → `failed`, no files written), writes the rollback snapshot and persists `applying` + report target before writing production files, then applies by impact — `none`, hot reload, or a controlled restart after persisting `verifying`. A 60 s health check decides `applied` ("已生效"); otherwise it rolls back once and reports "失败，已回滚", and if still unhealthy goes `failed` with `emergency_stop` and an owner-only report — at most two restarts per change. `recover()` resumes `applying` / `verifying` changes at start-up. `SelfChangeStore` gains `writeSnapshot` / `readSnapshot` / `setApplyState` / `audit`, and `SelfChangeApprovals` an `onApproved` hook. Host wiring (reload, exit 75, health, reporting, start-up recover) follows in slice E2.
- c9775fb: ADR 0041 slice D: system prompt assembly now runs on a `PromptSegmentRegistry`. Built-in sections map onto text segment kinds (`system` → `environment` → `role_rules` → `platform` → `scene`, descending weight within a kind), so the persona/style rules now follow the security rules instead of leading the prompt, and the volatile git status moves into `scene`. Plugins contribute segments through `promptSegmentToken` (released with their generation); `mergeMessageSegments` is the pure chronological merge for message segments (tie order, tool pairing, event relocation, append-only). `PromptAssemblyRegistry` is a deprecated adapter over text segments. `describePromptSectionsForDebug`, the context-budget report and `zhin trace` list each segment's id / kind / weight / chars / trimmed. `buildRichSystemPromptParts` exposes the stable prefix and `scene` split (cache breakpoint offset).
- 5efb4e9: ADR 0041 §6: two-level cache for group info and member profiles. Level 1 stays the in-memory 60 s cache; level 2 is the database. Facts are read L1 → L2 → platform and every platform result (and every side event) is written to both levels; the bot's own role is still read fresh each turn and only written through. A level-2 row older than 24 h is served and refreshed once in the background (de-duplicated, bounded concurrency, cancelled with the generation). Group facts extend `ai_session_profiles` with `owner_id`, `member_count` and `facts_updated_at` (additive migration); member facts live in the new `ai_scene_members` table. Storage is bounded: a member row is deleted on leave or kick, rows untouched for 90 days are pruned, each scene keeps at most 2000 rows (oldest `updated_at` evicted), pruning runs at startup and every 6 hours, and stored text is cleaned and capped at 128 characters.
- b5071e7: ADR 0041 slice A: participant headers. The trusted host stores the full `[id:…;user_id:…;name:…;role:…;group_nickname:…;group_title:…;mute_time:…;time:…;]` header in `UserMessage.name` / `AssistantMessage.name` (built from the conversation actor and the turn's bot facts, never from model output). At the LLM boundary `projectPromptContext` now sends the full header on a `user_id`'s first appearance in the visible window, the short `[id;user_id;time]` form afterwards, and synthesizes a `member_changed` event before a message whose sender facts changed without a recorded event; the header is the first line of the text and stored history is never mutated. Replaces the `[User]{…}` JSON and `[sender:…]` labels (`buildActorPrefix` is removed); `normalizeUserMessageForStorage` strips the new header line. Legacy messages without `name` derive the header from `actor`.
- e23cabc: ADR 0041 slice B: the turn context now carries real scene facts. `EndpointManagement` gains `inspectGroupScene` (name, owner, admins, member count, global mute) and `inspectGroupMemberProfile` (role, card, title, mute expiry; one lookup), implemented by the ICQQ adapter from uncached group/member reads. The CLI resolves them per turn (bot role always fresh; group and sender facts reuse a 60 s, 256-entry in-memory cache scoped to the generation; failures omit fields) and the inbound actor now carries `groupNickname` / `groupTitle` / `mutedUntil` plus the platform role. The Session / Bot state blocks are replaced by one projected scene line `[scene_id:…;scene_type:…;scene_name:…;owner_id:…;admins:…;member_count:…;global_mute:…;assistant_role:…;]` (values escaped and clipped to 64 chars). No new on-disk state.
- 3c4178d: ADR 0041 slice C: member state changes enter the session history. Join / leave and card / title / role / mute changes from the scene side events are written to `agent_messages` as `event` messages (`<operator> changed <user_id> <field> to "<value>"`, `<user_id> join <scene_id> on <HH:mm:ss.SSS> by <self|operator_id>`), in arrival order, with the existing compaction and retention; member-controlled values are always quoted, escaped and clipped to 64 characters. At the LLM boundary they render as one `[state change]` message per run of events: a system / developer message where the provider accepts it mid-conversation, otherwise a user message headed `user_id:system` (merged into an adjacent user message as a separate block). Events never sit between an assistant `tool_calls` message and its tool results and are never moved earlier. New provider capability `compat.midConversationSystem` (`system` / `developer` / `none`; OpenAI and remote OpenAI-compatible default `system`, o-series / gpt-5 `developer`, local servers, Anthropic and Gemini `none`). Join / leave and profile changes no longer appear in the ephemeral `[Scene events]` block (a bare join still wakes a turn). The system prompt states that quoted values in `[state change]` lines are data.
- 3fd758c: 不再在每轮 `[Agents instructions]` 中重复注入根目录 `AGENTS.md`：宿主 bootstrap（可缓存的系统提示词）已包含它时，envelope 只保留更近的子目录 `AGENTS.md`。
- 16896fe: `AGENTS.md` 去重以本回合系统提示词实际携带的 bootstrap 为准（回合引擎传入），不再读 `host.bootstrapContext`（生产中为空，去重从未生效）。评测新增 `hostBootstrap`，按 CLI 宿主方式把 bootstrap 交给回合引擎，度量与生产一致。
- 825e4dc: ADR 0042 §1: the IM system prompt is now built as a byte-stable prefix (system / environment / role_rules / platform, plus the platform reply instruction and exploration guidance) and a per-turn scene tail (scene line, network note, pre-fetched data). The AI request context carries `systemPromptCacheBreakpoint`; Anthropic receives two system blocks with `cache_control` on the stable block only, Gemini receives two system parts, and other providers still get one string with the stable part first. Gemini explicit context caching now caches only the stable system part plus tools (the scene tail moves into `contents`), treats a 404/unsupported `createCachedContent` as permanent for that model, and logs the reason once per model with the API error message instead of on every prefix change.
- f1eb75c: ADR 0042 W2: resident tools are tiered by scene (group and ordinary private chats keep chat essentials only; master private chat adds development and delegation tools; non-IM turns keep the old default set). Calling an authorized deferred tool by exact name auto-loads it, and `discover` attaches and loads the schemas of its best 1-3 matches. The provider tool list is now stable for prompt caching: resident tools sorted by name, loaded tools in first-load order (new `loadedOrder` in the deferred tool snapshot), new tools only append.
- 5621f75: ADR 0042 W3: fold the resident catalogs. The deferred tool index is one line per domain (MCP server, else owning plugin / builtin area) with up to 6 sorted tool names and the total count, e.g. `calendar: calendar_add, calendar_list (2)`; details come from `discover`. The skill catalog keeps the skill name plus one trigger sentence of at most 40 characters (full description at `load_skill` / `discover`) and is sorted by name so the block is byte-stable. Providers that use prompt-mode structured output (DeepSeek, `compat.structuredOutput: 'prompt'`) now get a compact shape (one example plus one data-shape line per offered segment type, derived from the schema) instead of the full JSON Schema text; native providers still receive the schema as an API parameter and `decodeStructuredReply` still validates with it. `@zhin.js/ai` exports `registerStructuredOutputPromptText`.
- 88c82d0: ADR 0042 W4: bootstrap section scopes. A section of `AGENTS.md` / `SOUL.md` / `TOOLS.md` can carry `<!-- scope: group -->` (also `private`, `channel`, `master`, `master-private`, comma lists) on the line under its heading; the host injects only the sections matching the turn's scene (conversation type + master or not), byte-stable per scene kind. Unannotated sections apply everywhere. `zhin trace` lists skipped section titles (`bootstrap_skipped`).
- e37f30f: ADR 0042 §7/§8 (fewer rounds, measurement). Default `maxIterations` now depends on the scene: group chat 6, private chat 10, master private chat 15 (a `modelHarness` override or a customised `ai.agent.maxIterations` still wins; built-in per-model limits are never raised). When one iteration remains, the tool result tells the model to reply with what it has. A one-time hint fires when the same tool family is called 3 times in a row without new information (identical results, searches that match nothing, the same file re-read), recorded as `spin_hint` / `last_iteration_nudge` entries on the turn trace. The orchestration rule merges "send independent queries as parallel tool calls in one message" into the existing parallel `spawn_task` bullet (net size unchanged). Adds `pnpm eval:budget`: a deterministic offline first-turn token measurement (group first turn, group 6th turn, master private tool turn) with a committed baseline.
- 2b8b408: ADR 0043 §1 (H1): history stores conversation only. Per-turn context blocks (`[Turn context]` with time, told ledger, recalled memory, tone hint, merged-turn and danmaku lines; `deferred-tools`, `workspace-rules`, `skill:*`, `file-memory:*`, `session-rules:*`, `session-guidance`, `session-identity`, `active-skills`, `deferred-catalog-summary`, `quote-guidance`) are now marked `perTurn` when built and dropped by `normalizeUserMessageForStorage`; the current message sent to the model is unchanged. `projectPromptContext` also strips them (identified by flag, contextRef key or legacy text prefix) from every earlier user message, so rows stored before this change stop replaying them; stored data is never rewritten.
- 4d728c0: ADR 0043 §4 + §5 (H4) and the ADR 0041 actor-only amendment. Participant headers are no longer stored: user messages keep only `actor`, assistant messages keep `assistantActor` (plus the delivered `messageId`), and the header is rendered at the LLM boundary; legacy rows that still carry `name` are read as before. Headers now use session message aliases `id:m<n>` (an ordinal over the stored active path, so already-sent prefixes never change), `time:HH:mm` shown only when a minute has passed since the last shown time (the first message and the first message of a day also carry `date`), and `reply_to:m<n>` when the message replies to one inside the visible window. A reply to a message outside the window gets one `[quote id:…;user_id:…;time:…;] <first 120 chars>` line (media as placeholders, a forward expanded one level) so the model no longer needs `inspect_conversation_reference` for ordinary quotes; the quote is resolved by the ingress through the reference port (3 s timeout) and stored as structured `UserMessage.quote`. Tool arguments named `message_id` / `message_ids` / `*_message_id` / `reference` and `reply` segments accept the alias as well as the platform id; `inspect_conversation_reference` also accepts the quoted message id.
- eb8feeb: Isolated shell (docker, workspace-write) now mounts host self-configuration paths (#1030 list A+B: AGENTS.md, skills, .git, package.json, lockfiles, node_modules, root config, ...) read-only on top of the writable workspace, so shell tricks cannot rewrite them. Protected paths are carried on the Tool invocation policy.
- f0e1df7: Group merge window (ADR 0038 slice A): with `ai.agent.inboundQueue.merge.enabled`, plain-text mentions from several group members within a short window (`quietMs` 1500 / `maxWaitMs` 6000, up to `maxSenders` 5) are answered by one turn instead of one reply each. Off by default until merged turns narrow permissions per sender. The master, private chats, commands, stop words and messages with media, quotes or forwards keep their own turns. New audit codes `merge_window_joined` / `merge_window_flushed` (plus the other ADR 0038 codes reserved for later slices).
- 7f34293: Merged turns narrow permissions to every sender (ADR 0038 slice B1): when a group merge window answers several members in one turn, the tools, skills and sub-agents the model sees are the intersection of what each member sees on their own, and the turn's roles and permissions are intersected as well. Merging can only narrow what a turn may do, never widen it. `ai.agent.inboundQueue.merge.enabled` stays off by default until slice B2 (`onBehalfOf` review and approval-card limits).
- d9672ec: ADR 0038 切片 B2：合并回合里有副作用的工具调用按 `onBehalfOf` 指向的发送者复核（缺省按权限最低者），不通过写 `merge_on_behalf_denied`；合并回合最多 1 张新审批卡；新增 `ai.agent.toolHardGate.maxPendingPerScene`（默认 3），每群待审卡超限 fail closed（`hard_gate_scene_pending_cap`）；群聊合流 `inboundQueue.merge.enabled` 默认改为开启。
- 42e630d: ADR 0038 slice C: a merged group turn now tells the model who it is answering. The turn context carries a `[Merged turn]` list (sender id, name, message ids, text) and asks for one reply that @-mentions each sender it answers and skips nobody by pretending; the outbound audit records how many senders were merged and how many the reply answered.
- 1096173: ADR 0038 slice D: before sending, a turn whose sender followed up into a merge window drops its stale reply (audit `merge_reply_stale_discarded`) and the next merged turn answers old and new messages together; replies of turns that called a tool or hit the hard gate, and a sender chain already dropped once, are sent anyway (`merge_reply_stale_sent`).
- 24a2b71: Danmaku mode (ADR 0038 slice E1): adapters can declare the `liveDanmaku` capability. In their conversations every danmaku is a candidate; the Agent collects them in one window (`ai.agent.inboundQueue.live`: `windowMs` 10000, at least `minIntervalMs` 15000 after the previous danmaku reply, newest 100 kept) and replies once — `mode: pick-one` (default) picks one danmaku and `@`s its viewer, `summary` answers the window as a whole. Danmaku turns run as an anonymous viewer with only tools that declare the new `readOnly: true` flag (native file reads, web search / fetch, knowledge and memory search are marked), no skills, sub-agents, MCP or shell, and never an approval card. Replies are audited as `danmaku_window_picked` with the candidate count and the viewers picked.
- 119e9e6: ADR 0043 §2/§3: the history sent to the model is bounded by a token budget (`ai.context.historyTokens`: group 8000, ordinary private 12000, master private 24000, a number for all scenes or per-scene overrides, `0` = off; `ai.context.maxRecentMessages` stays as a message-count upper bound). The budget is measured after projection, the window starts on a turn boundary, and it only moves — in one block leaving 25% headroom — when the budget is exceeded, so the prompt-cache prefix stays stable. Tool results of finished turns (and very long call arguments) reach the model as their first 200 characters plus `…(已省略 N 字)`; the current turn and stored history are unchanged.
- 8ce6cd2: Project repeated file-memory snapshots through scoped context references while preserving full stored snapshots, neutral versions when no snapshot is supplied, and recovery after compaction or branch loads.
- f2bbab5: Stop the bot from reacting with an emoji on every turn. The structured-reply instruction now says reactions are occasional (`""` is the default), and the host paces reactions per session: at most one per `ai.agent.reactions.cooldownMs` (default 10 min) and only with `probability` (default 0.35; 0 disables). Paced-out reactions are not sent, count as handled, and are audited as `{ reaction: true, applied: false, paced: true }`. Memory only, bounded to 1024 sessions.
- 44eb3f8: Align the host self-configuration hard gate with the final #1030 P0 spec. `node_modules/**` (any depth), package-manager lockfiles and the plugin lifecycle file are now denied outright for every role, with no approval card. The `self` hard gate is anchored to the project root (symlink-, `..`- and case-safe) and covers the root config files, `package.json`, `schema.json`, the root plugin entry, `AGENTS.md`, the skills directories, `.git/`, `.pnpmfile.cjs` and `assistant.profile.yml`; nested files such as `plugins/x/package.json` are no longer gated, and `pnpm-workspace.yaml` / `tsconfig*.json` are not managed. The host provides the project root and extras per generation through `hostProtectedPathsToken` (carried on each Turn); without it the gate fails closed to name matching at any depth.
- ab2263a: Gate writes to the host's own configuration with the dangerous-tool hard gate (#1030 P0). A file-tool call that writes `zhin.config.*`, `.env*`, `package.json`, lockfiles, `pnpm-workspace.yaml`, `.npmrc`, `.pnpmfile.cjs`, `assistant.profile.yml`, `node_modules/` or `.git/`, and a `bash` command that writes one of them or changes dependencies, is now a dangerous `self` call: it needs a fresh human approval every time, and bypass, the auto reviewer, owner exemption and remembered approvals never grant it.
- dfa14b5: 修复 CodeQL js/polynomial-redos：`ai.context.historyTokens` 字符串解析先去掉空白、限制长度，再用无重叠量词的正则匹配。
- b223a51: Record redacted model inputs per request for local conversation traces, with reported usage kept separate from context estimates. Preserve trusted conversation and source-message identity, expose details through full-scope read-only Console APIs, and enforce bounded trace retention. Request-body recording is enabled by default and can be disabled with `ai.agent.recordRequestBodies: false`.
- d0e1fac: Keep stable prompt instructions ahead of turn-specific capabilities, project unchanged context without placeholder text, and retain scoped state snapshots with readable updates and compaction recovery. Preserve native conversation/tool chronology and separate participant identity from runtime guidance.

  Resolve the ICQQ bot account and current-group role before capability discovery, and support explicitly declared current-conversation bot-role requirements without changing existing requester permissions or approvals. Keep role lookup failures unknown and preserve execution-time platform checks.

- 1ca669a: Read complete retained user-message text on demand through the existing session-tree runtime and `GET /api/agent/sessions/:key/message`. Bind each read to the tree's session ID, reject cross-session/non-user messages, and return text without image payloads. Keep tree previews unchanged and report older runtimes without message reading as unsupported.
- Updated dependencies [f67883e]
- Updated dependencies [b5071e7]
- Updated dependencies [e23cabc]
- Updated dependencies [3c4178d]
- Updated dependencies [825e4dc]
- Updated dependencies [f1eb75c]
- Updated dependencies [5621f75]
- Updated dependencies [2b8b408]
- Updated dependencies [4d728c0]
- Updated dependencies [eb8feeb]
- Updated dependencies [f0e1df7]
- Updated dependencies [d9672ec]
- Updated dependencies [24a2b71]
- Updated dependencies [119e9e6]
- Updated dependencies [f2bbab5]
- Updated dependencies [1bdbc08]
- Updated dependencies [df6442c]
- Updated dependencies [b223a51]
- Updated dependencies [d0e1fac]
- Updated dependencies [3771f7a]
- Updated dependencies [945303c]
- Updated dependencies [4f96ad5]
  - @zhin.js/core@1.1.52
  - @zhin.js/ai@1.1.47
  - @zhin.js/adapter@1.1.24
  - @zhin.js/tool@1.1.11
  - @zhin.js/im-contract@1.1.8

## 1.1.42

### Patch Changes

- 5be6f3a: Add optional public R2 publishing for generated and outbound inline images, plus approval-gated workspace image uploads. Keep image bytes out of tool results and subsequent context when storage is enabled.

  Keep MCP image originals in a scoped local store with seven-day retention and bounded capacity. Expose on-demand inspection through `get_local_assets`, projecting images only into the next model request and sharing perception limits with authorized child turns.

- 334e92d: 公告：草稿 → 审批 → 发送（ADR 0037 第 1 期切片 B）。

  - 新表 `ai_announcements` 与 `AiAnnouncements`：状态只前进 `draft` → `pending` → `approved` → `sent`，旁路 `rejected` / `expired` / `failed`；`revision` 乐观并发；改正文回到 `draft` 并重算 `content_hash`；待审批默认 24 小时超时。
  - 新工具 `announcement_draft`（`risk: safe`）：模型只能建草稿，不能提交、审批或发送。
  - Console `plugin.root.announcements` / `announcement`（读）与 `announcement-create` / `-edit` / `-submit` / `-approve` / `-reject` / `-resend`（动作，暂用 `control:read` / `control:write`）。
  - 批准即发送：摘要复核 → 控制面 → 会话画像 → 硬闸以公告审批记录作批准（`ToolHardGate.checkPreApproved`，不弹第二张卡）→ `EndpointManagement.sendGroupNotice`（icqq / napcat）。被拦或失败置 `failed`，不自动重试；重发回到 `pending` 需再批一次；摘要不符拒绝（`announcement_hash_mismatch`）。
  - 审计追加 kind `announcement` 与码 `announcement_drafted` / `_submitted` / `_approved` / `_rejected` / `_expired` / `_sent` / `_send_failed` / `_resend` / `_hash_mismatch`。

- 0bdd5df: 冷场 → 会话临时 `mention_only`（ADR 0037 第 1 期切片 C，§1.3）。

  - 会话运营配置新增 `coldField.enabled`（默认关，只能按会话打开）/ `coldField.threshold`（默认 20）/ `coldField.durationMs`（默认 30 分钟）；读库失败时视为关闭。
  - 只统计群消息：未点名且旁听判定不参与计 1；点名、旁听参与、Bot 主动发言（scene event 唤醒、模板欢迎、公告）清零。命中阈值给该会话加控制面临时 `mention_only`（`actor=policy`、`expiresAt`），到期自动撤销。
  - 临时覆盖与运营者手动覆盖分存、只会更严、不进 `revision`，在 `control` 查询的 `temporary[]` 里可见；`control-set` 显式写 `mention_only: false` 时一并清除。计数与临时覆盖只在进程内存。
  - 审计复用 `control_change` / `control_gate`，追加码 `cold_field_mention_only_on` / `cold_field_mention_only_expired` / `cold_field_mention_only_cleared`；决策回放 `decisions` / `decisions-export` 新增可选 `reasonCode` 过滤（`DecisionEventQuery.reasonCode`）。

- 08e64de: Shorten operation confirmation prompts: display action descriptions and exact arguments, omit internal approval-policy boilerplate, and render choices once with their existing authorization scopes visible in the labels.
- 291cf6e: 控制面四开关（ADR 0036 切片 D）：`emergency_stop` / `muted` / `read_only` / `mention_only`。

  - 两级：实例默认 + 会话覆盖（`platform + scene_id`），会话覆盖只能更严；生效顺序 `emergency_stop → 实例 muted → 会话 muted → read_only → mention_only → 常规策略`，先命中先返回。
  - 接入 IM 入站、旁听、scene event 唤醒（位于 #995 会话画像发言判定之前，拦下时不调模型），回合中途变更时回复 / scene event / 主动出站在发送前再判一次止损类开关。
  - Console `plugin.root.control`（`control:read`）/ `plugin.root.control-set`（`control:write`，必须带 `expectedRevision`，不符返回 conflict）。拦截写 `control_gate`，变更写 `control_change`（`actor=operator`，前后值）。
  - 持久化到新表 `ai_control_state`；读不出时 fail closed（按 `emergency_stop` 处理）并拒绝写入，直到重新读成功。模型没有任何工具能读写这些开关。

- ff87195: 决策审计 Console 回放（ADR 0036 切片 C）：

  - Host 新增只读查询 `plugin.root.decisions`（倒序列表，按平台 / 会话 / kind / outcome / 时间过滤，`nextBefore` 翻页）、`plugin.root.decision-turn`（按 `turn_id` 展开时间线）、`plugin.root.decisions-export`（时间窗导出 JSON，字段与表结构一致，`nextSince` 分页），都需要 `decisions:read`；入口在「机器人状态」页。
  - `DecisionEventLog` 增加 `query` / `turn` / `prune` 读取与保留期清理；新增配置 `ai.audit.retentionDays`（默认 14 天），启动时与之后每小时清理过期行，并为 `ts`、`turn_id` 建索引（SQLite / MySQL / PostgreSQL）。
  - 不含控制面开关（切片 D）与危险工具硬闸（切片 E）。

- d6158d5: 新增决策审计表 `ai_decision_events`（ADR 0036 切片 A，只有表结构与码表，尚无写入）：

  - 字段与 ADR 一一对应：`id`、`ts`、`turn_id`、`instance_id`、`platform`、`scene_id`（与会话画像 `scene_key` 同口径）、`user_id`、`kind`、`outcome`、`reason_code`、`reason_detail`、`payload`、`actor`、`actor_id`；随 AI 持久化表一起注册，append-only。
  - `kind` / `outcome` / `actor` 枚举与 `reason_code` 码表集中定义；码表外的值一律记为 `unknown`，原值写进 `reason_detail`。
  - 序列化时 `reason_detail` 截到 200 字，`payload` 去掉密钥、Cookie、token 与完整提示词；`actor=operator` 必须带 `actor_id`。

- d507e5f: 决策审计开始写入 `ai_decision_events`（ADR 0036 切片 B，写路径埋点）：

  - 每条 IM 入站与每次 scene event 唤醒按回合写 append-only 记录，同一回合共享 `turn_id`：入站唤醒（`inbound_wake`）、会话画像不能发言（`speak_gate` + `model_skip`，码 `cannot_speak_muted` / `cannot_speak_muted_all` / `cannot_speak_restricted`，scene event 唤醒同码）、旁听判定（`ambient_decision`）、scene event 无新内容（`scene_event_nothing_new`）、模型调用摘要（`model_run`：模型、耗时、状态、是否发言，不记提示词）、出站（`outbound`：已发 / 抑制 / 失败）。
  - 码表追加写路径用码（只增不改）。
  - 审计写失败只记日志，不阻断、不拖慢回合；现有日志不变。

- cffaa8f: 危险工具硬闸与群管工具对齐（ADR 0036 §2/§3、ADR 0037 §3，#1011 G1–G3）：

  - 改他人群名片归 `member`：新增 `set_group_card`；场景管理通用工具 `{prefix}_set_nickname`（`setMemberNickname`）改归 `member`。Bot 自身改昵称请用 `set_self_nickname` / `set_bot_nickname`（`identity`）或声明 `riskCategory`。
  - 核心名单按 `{prefix}_{suffix}` 后缀匹配（至少两段），补齐场景管理通用工具 `remove_member` / `ban_member` / `unban_member` / `set_moderator` / `rename_scene` / `set_scene_muted`，以及 `set_group_name` / `set_anonymous`。
  - 硬闸接入控制面（#1008）：会话处于 `emergency_stop` / `read_only`（含状态不可用）时危险工具在弹审批之前直接拒绝，审计 `tool_hard_gate` + `control_emergency_stop` / `control_read_only`；`muted` 不拦硬闸管理工具。

- a3b636d: 危险工具硬闸 IM 审批通道（G6，#1013）：`ai.agent.toolHardGate.imApproval`，默认关闭。

  - 配置：`enabled`、`approverIds`（扁平列表或 `platform → userIds`）、`delivery: dm | approver_group`、`approverGroupId`（审批群模式必填，且不能是业务会话）。
  - 新审批卡片经触发调用的 Endpoint 私聊投递给 allowlist 审批人（或发到专用审批群），内容含工具、类别、会话、脱敏参数摘要、卡片 id、过期时间；投递失败不重试，卡片照常留给 Console、超时拒绝。
  - 审批人私聊 `/approve <id>` / `/deny <id>` 结算同一个 `ToolApprovalQueue`，与 Console 先到先得；群 / 频道消息与触发会话一律不能结算；仍是 humanOnly、一次一批，不提供本会话 / 永久授权，`bypass` 与审核 Agent 不能放行。
  - 审计：`tool_approval` 结算记录 `payload.channel`（`console` / `im_dm` / `im_approver_group` / `turn_prompt`），IM 操作者记 `actor_id = im:<platform>:<userId>`；Console 审批卡片 RPC 返回 `channel`。

- 08e64de: Expose current ICQQ conversation and bot-role inspection through a private Agent skill. Add conversation-scoped quote, merged-forward, own/member recall, and owner-approved leave-group tools with live platform checks and documented guild-channel limitations.

  Include real message IDs in the existing turn and conversation context so message operations can target actual messages without guessing.

- 9cade30: 修复国际化调用链遗漏：Agent 审批、管理命令和错误反馈采用可信语言及实际命令前缀；游戏快捷帮助、工具反馈、平台默认卡片和后台通知贯通语言。协议即时回复复用受运行代约束的个人语言查询，业务验证支持不改变审批身份的双语展示元数据。

  AI 正文、进度与耗尽摘要统一优先遵从用户明确语言要求，再跟随实际输入；个人／项目语言仅作兜底，固定界面文案继续使用配置语言，不增加翻译调用。

  GitHub 工作区为 Git clone/pull/fetch/ls-remote 显式分隔选项与位置参数，保留仓库和分支校验；顺序写入 Bot 名称和邮箱，避免竞争同一配置文件锁。

- 53bc6a0: 提供简体中文和英文的项目与个人语言能力，复用 SQL 用户状态并固定多轮交互语言。命令提示使用当前命令索引、实例命名空间和实际前缀；可信语言贯穿消息、工具与计划任务。新增双语目录和 Schema 显示元数据，创建及配置向导支持语言选择；保留既有配置、权限、时区与投递语义。修复 Root Feature 热更新时 setup 能力丢失，并为已有任务表显式增补语言字段。
- 7595136: Upgrade `nodemailer` to 10.1.4+ and `js-yaml` to 5.4.1+ to clear security advisories.
- e7b72a4: 群管冷却与 `ops:approve` 审批权限（ADR 0037 第 1 期切片 E，§3）。

  - 会话运营配置新增 `ops.cooldownMs`（实例默认 60 秒 + 会话覆盖，`0` 关闭）；同一 `platform + scene_id + 工具名` 在冷却期内只能发起一张硬闸审批卡。冷却记录为进程内，重启清空。
  - 冷却判定在控制面之后、生成新审批卡之前：命中不入队、不弹卡，本回合同类危险工具 latch，模型收到"冷却中、勿重试/换工具"说明。冷却表自身出错时不拦（冷却是节流不是授权）。
  - 审计新增 kind `ops_cooldown` 与码 `ops_cooldown_passed` / `ops_cooldown_hit`；命中同时写一条 `tool_hard_gate` 拒绝，回放串成一条链。
  - Console 新权限点 `ops:approve`：结算硬闸审批卡（与旧的 `tool_approvals:resolve` 任一即可）、读审批卡（与 `tool_approvals:read` 任一即可），以及公告 approve / reject / resend（不再接受只有 `control:write` 的令牌）。
  - `PluginConsoleRpcMethod` 新增可选 `anyOfPermissions`：持有其中任一权限即满足，对动作算作方法自身的要求。

- 66b6404: 让活动反馈、内容审核默认提示和后台任务通知保持发起操作或任务创建时的语言，并将语言沿现有 Host、精确投递目标与主动发送链传给适配器。

  显式配置的提示、用户及模型原文保持不变；审核默认提示仅在未配置模板时本地化，异步审核固定入队时语言，不修改审核规则、调度、权限或重试行为。

- dcd4982: Upgrade runtime dependencies to clear security advisories: `undici` (6.29.1 / 8.12.2+), `axios` 1.20.0, and `@modelcontextprotocol/sdk` 1.32.0+ (bringing patched `hono`, `body-parser`, `proxy-addr`, `follow-redirects` and `ip-address` through the lockfile).
- 69f9ef6: Scene awareness (#996): high-priority social events (bot muted/unmuted, join request, member joined/left, group notice updated, bot poked) now wake one short Agent turn on their own after a 3–5 s coalesce window (at most one wake per scene every 15 s), without waiting for the next human message. Low-priority events (reactions, card/title/remark changes, person-to-person pokes) never wake alone. Every turn carries the recent scene events as a short ephemeral `[Scene events]` block (≤5 lines / ≤200 chars) that is never stored in `agent_messages`. When the bot cannot speak, the wake only updates the session profile and skips the model, same as the session-profile speak gate. Configure with `ai.trigger.sceneEvents` (`conversations` defaults to `ai.trigger.ambient.conversations`).
- 9dfdaf4: 会话日程 `ai_session_events` 与到点提醒（ADR 0037 第 1 期切片 D，§2）。

  - 新表 `ai_session_events`（`revision` 乐观并发）与存储 `AiSessionEvents`：`at` 本身总会提醒，`remind_before` 追加提前量；已触发的偏移记入 `fired`，全部触发后 `done`；创建 / 修改时已过去的偏移直接记为已触发。
  - 模型工具 `session_event_create`（`risk: safe`）只能为当前群 / 频道建事件；修改 / 取消只经 Console RPC `session-events` / `session-event` / `session-event-create` / `session-event-update` / `session-event-cancel`（`control:read` / `control:write`）。
  - 到点唤醒复用 job-scheduler 的 `ScheduleEngine` 计时（不写 `schedule-jobs.json`）：`inbound_wake` / `schedule_wake_fired` → 控制面（按被点名判定，`mention_only` 不拦）→ 会话画像 → 模板直发（不调模型）。被拦 / 失败记为已触发、不补发；同一会话同一分钟的提醒合并为一条；重启后错过超过 10 分钟（`DEFAULT_SESSION_EVENT_GRACE_MS`）的写 `schedule_wake_missed` 不发。Bot 经日程发言后旁听窗口与冷场计数清零。
  - 审计新增 kind `schedule` 与码 `schedule_event_created` / `_updated` / `_cancelled`、`schedule_wake_fired` / `_missed` / `_merged`；决策回放可按 `kind=schedule` 过滤。

- a5f0381: 入群欢迎 / 退群记录（ADR 0037 第 1 期切片 A）。

  - 会话运营配置 `AiSessionOps` 与新表 `ai_session_ops`：按 `platform + scene_id` 存放，与会话画像分开；`welcome.enabled`（默认关）/ `template` / `mergeWindowMs`（60s）/ `maxPerHour`（10）/ `rulesUrl`，`leave.record`（默认开，只写审计）/ `leave.notify`（默认关，本期不发）。读不出时一律不发欢迎。
  - 模板变量白名单 `{members}` `{nickname}` `{group}` `{rules_url}`，未知变量原样保留。
  - 欢迎：入群 → 合并窗口 → 小时上限 → 控制面 → 会话画像发言判定 → 出站；被拦只写审计不补发，失败不重试。会话开启欢迎后 scene event 不再因入群唤醒模型（避免双发）。
  - 审计追加 kind `member_lifecycle` 与码 `welcome_sent` / `welcome_merged` / `welcome_rate_limited` / `welcome_disabled` / `member_leave_recorded`。
  - Console `plugin.root.session-ops` / `session-ops-preview`（只渲染，不发送不审计）/ `session-ops-set`（`expectedRevision`，变更写 `config_change`）。

- 17d1301: 新增危险工具硬闸（ADR 0036 切片 E，fail-closed）：

  - 工具可以声明 `risk: 'dangerous' | 'safe'` 和 `riskCategory: 'member' | 'publish' | 'funds' | 'identity'`。宿主内置一份危险工具清单，`ai.toolHardGate.dangerousTools` 只能把工具调高为危险，插件声明 `safe` 不能调低。
  - 危险工具执行前必须拿到一次全新的人工审批（`humanOnly`），`execApprovalMode: bypass`、自动审核、主人自动放行和已记住的授权都不能越过。拒绝、超时（默认 5 分钟）、无人可批都按拒绝处理，本轮不再重试同一工具或同一类别。
  - 资金类（`funds`）默认禁用；打开 `ai.toolHardGate.allowFunds` 后仍需审批。
  - 无人值守的轮次会排进审批队列，Console 通过 `plugin.root.tool-approvals` 查看、`plugin.root.resolve-tool-approval` 批准或拒绝（权限 `tool_approvals:read` / `tool_approvals:resolve`），批准后下一次同参数调用只放行一次。
  - 结果写进 `ai_decision_events`：`tool_hard_gate`（allow / deny）、`tool_approval`（defer / allow / deny），safe / 只读工具放行但仍写 `tool_call`（allow）；新增码 `tool_approval_requested`、`tool_approval_approved`、`tool_funds_disabled`、`tool_hard_gate_latched`、`tool_safe_allowed`（追加在码表末尾）。

- f821029: 新增会话画像。私聊是一个人的会话，群和频道是多人会话，两者共用一套模型：

  - **人物关系与好感度**（新表 `ai_user_relations`，按 `platform + user_id` 合并同一个人）：称呼、短笔记、语气标签、好感度 -100 ～ 100、关系 stranger/acquaintance/familiar/close。好感度按规则变化（聊天/夸奖加分，辱骂与连续只当工具用扣分，加分有冷却和每日上限，主人恒定满分），回合结束后异步写回，不阻塞回复。
  - **会话上下文与发言限制**（新表 `ai_session_profiles`，按 `platform + scene_key`）：话题、管理员、成员概况、Bot 自己的禁言/全员禁言/宿主限制。由会话事件和发送者角色按规则维护；话题由模型经 `session_profile` 工具更新。Bot 在会话里不能发言时，入站消息直接不进 AI 回合，也不跑旁听判定。
  - **注入很短且只对本轮有效**：`[Relationship]` 只放本条消息的发起人（旁听时再加 1 个最近活跃的人），`[Session]` 只有一行；两者作为 ephemeral 内容块发给模型，存入 `agent_messages` 前丢弃，不会在之后的回合重放。`@zhin.js/ai` 的 `TextContentBlock` 新增 `ephemeral` 标记。
  - `user_profile` 工具新增 `note` / `unnote` / `call_me` / `tone`，并拒绝保存疑似密钥或证件号的内容。
  - `ai_user_profiles` 偏好收紧为 8 个固定维度（name/language/timezone/style/interests/dislikes/occupation/location，常见别名归一化），同维度覆盖写入，其他键拒绝，值 ≤80 字；笔记、语气标签、话题都是去重 + 固定上限，不会无限增长。

- Updated dependencies [334e92d]
- Updated dependencies [0fc0219]
- Updated dependencies [560c549]
- Updated dependencies [144a17b]
- Updated dependencies [ff87195]
- Updated dependencies [18296cf]
- Updated dependencies [a3b636d]
- Updated dependencies [08e64de]
- Updated dependencies [9cade30]
- Updated dependencies [53bc6a0]
- Updated dependencies [7595136]
- Updated dependencies [e7b72a4]
- Updated dependencies [b8e594e]
- Updated dependencies [66b6404]
- Updated dependencies [adb4af2]
- Updated dependencies [dcd4982]
- Updated dependencies [69f9ef6]
- Updated dependencies [17d1301]
- Updated dependencies [f821029]
  - @zhin.js/adapter@1.1.23
  - @zhin.js/plugin-runtime@1.1.17
  - @zhin.js/ai@1.1.46
  - @zhin.js/core@1.1.51
  - @zhin.js/permission@1.1.9
  - @zhin.js/tool@1.1.10
  - @zhin.js/skill@1.1.10
  - @zhin.js/im-contract@1.1.7
  - @zhin.js/agent-feature@1.1.10
  - @zhin.js/mcp-feature@1.1.10
  - @zhin.js/prompt-section@1.1.9

## 1.1.41

### Patch Changes

- 0dd657d: Let the structured-decision provider decide group ambient engagement. New `ai.decisions.ambient` policy (`off` / `shadow` / `active`, plus `timeoutMs` and `minConfidence`): in `active` mode the DecisionProvider (for example TypeSafe Jev) answers one binary `engage` / `stay_quiet` choice over the same recent messages the chat-model judge sees, and the `ai.trigger.ambient.judge` list takes over when it fails, times out or answers invalidly; in `shadow` mode the judge list still decides and the decision is logged as `ambient_decision_shadow`. Quiet time, cooldown, hourly caps, conversation window, judge interval, `ambient.minConfidence` and ambient shadow mode are unchanged, and addressed turns still skip the ambient judge. Without `ai.decisions.ambient` nothing changes.
- Updated dependencies [0dd657d]
- Updated dependencies [5d099f5]
- Updated dependencies [f9ab410]
  - @zhin.js/ai@1.1.45
  - @zhin.js/core@1.1.50

## 1.1.40

### Patch Changes

- f98025b: 自动输出统一的每轮 Agent 用量汇总，DEBUG 展示模型调用与首请求上下文预算。沿用 TurnTrace 汇总主回合及子回合，传递缓存写入、模型身份和用量可用性；未知或部分数据明确标记，日志不包含消息、提示词或工具内容。
- 66ec1a5: Batch queued group moderation by conversation and sender while allowing ordinary inbound handling to continue. Preserve original-message evidence, notice-based escalation, model-owned recall and generation cancellation. Bound each group's pending buffer, explicitly audit reviews skipped at capacity, and attribute shared completions proportionally without counting the group request more than once. Older completion hosts retain per-message attribution.
- 7d68df6: 精简 Agent 内置固定提示词与消息说明，保留工具、审批和结构化回复能力。适配器 Skill 按会话场景拆分，群／频道管理仅向对应场景披露；提示段与模型消息段支持场景声明，沿用当前回合权限和 generation 投影。
- 250b026: 补齐上下文压缩中的工具参数、思考和媒体估算，以及已披露工具输入与结构化输出 Schema 的固定预算。小窗口按可用预算收紧近期原文保留量，继续保留最少消息数与工具调用配对。拒绝截断、失败、取消、请求工具、空白或未节省 token 的摘要，避免错误摘要写入历史；无可压缩前缀时不再报告摘要成功。

  摘要检查点改为绑定实际被压缩的已持久化前缀，修复当前回合未落库时的锚点错位；对来源不明、并发变更或等待写锁期间取消的结果跳过保存，原始记录不删除。

- bf0fa9f: Say failures in a chat voice. In IM turns a failed reply no longer reads "模型服务当前限流，已自动重试仍未成功…", "模型调用失败：…请检查 API 密钥与网络后重试", "模型未能生成符合消息格式的回复…" or "❌ AI 处理失败: …"; the bot says something like "刚卡了一下，你再说一遍？" (tired / confused / refusing lines for quota, overlong context and safety blocks, nothing for a cancelled request). The owner (master) also gets a short cause in brackets. Full errors stay in the logs, non-chat origins keep the precise messages, and a configured `ai.trigger.errorTemplate` is still honoured.
- 9bc3285: Never send tool-call markup as a chat message. DeepSeek sometimes writes a tool call as text (`<｜｜DSML｜｜ calls>…`), which the plain-prose fallback forwarded to the group verbatim. Replies containing DSML, `<invoke>`, `<tool_call>` or similar markup are rejected in JSON and in prose, are not reworded by the format correction (that would announce an action that never ran), and fall back to the host failure notice. `<text>…</text>` wrappers are split into one message each.
- 3326db3: 减少已加载 Skill、工作区规则和工具参数 Schema 的重复上下文；保留原始记录、更新版本和压缩检查点。合并等价消息输出 Schema，稳定请求前缀与工具顺序，并沿现有开关扩展 Anthropic 历史缓存标记。上下文追踪包含输出 Schema 和去重后的消息估算。
- e91235e: Let the bot answer with a reaction, the way a person taps 👍 instead of typing. Adapters declare reactions with `segments.reaction` (values with meanings, optional scopes); the reply schema then has a `reaction` field limited to those values, the instruction says when a reaction alone is enough, and the reply port applies it to the message being answered before any words. icqq offers 21 QQ face reactions in groups.
- 6da2bad: 新增独立于日志的 Agent 用量分字段存储，默认保留 30 天；为消息与会话增加可查询身份及状态字段。提醒、管理员 RSS 和 Agent 计划任务使用事务化 SQL 表，迁移保留认领与回执，未知投递不自动重发。修复跨连接事务隔离、拒绝传播和 PostgreSQL 长度字段兼容。支持 SQLite、MySQL、PostgreSQL，升级需备份并完整重启，不能与旧版本进程混写。
- 3781f1c: 支持多模态感知备用模型和 ICQQ 原创表情识图；增强语音回复的使用指引与错误提示，让已启用的 TTS 回复无需逐次审批。ICQQ 踢人工具使用 human 策略，每次都要求独立人工审批，不能由自动审核或历史授权替代。

  内容审核支持按账号和群显式开启广告、辱骂审核：提醒、警告、10 分钟禁言，通知通过 @ 对应成员说明处理结果，30 分钟无新违规重置；提醒/警告是否撤回原消息由模型结合上下文决定。入群 10 分钟内的明确广告可直接踢出，执行前刷新权限和入群时间；审核、通知或平台操作结果不确定时不盲目重试。

  并发消息独立审核并按到达顺序保存上下文，仅处罚和通知使用成员预留；重复投递不覆盖正在等待的撤回决定。接受完整 JSON 代码块，记录无效审核结果。人工确认显示具体参数，并在等待确认时隔离参数，确保批准对象与执行对象一致。

- Updated dependencies [f98025b]
- Updated dependencies [9e21404]
- Updated dependencies [de39053]
- Updated dependencies [66ec1a5]
- Updated dependencies [7d68df6]
- Updated dependencies [250b026]
- Updated dependencies [bff8e31]
- Updated dependencies [bf0fa9f]
- Updated dependencies [3326db3]
- Updated dependencies [e91235e]
- Updated dependencies [6da2bad]
- Updated dependencies [3781f1c]
  - @zhin.js/ai@1.1.44
  - @zhin.js/core@1.1.50
  - @zhin.js/adapter@1.1.22
  - @zhin.js/prompt-section@1.1.8
  - @zhin.js/plugin-runtime@1.1.16
  - @zhin.js/im-contract@1.1.6
  - @zhin.js/tool@1.1.9
  - @zhin.js/agent-feature@1.1.9
  - @zhin.js/mcp-feature@1.1.9
  - @zhin.js/permission@1.1.8
  - @zhin.js/skill@1.1.9

## 1.1.39

### Patch Changes

- 974fa85: Add ambient group engagement (`ai.trigger.ambient`): for a group message nobody addressed, wait for the burst to settle, apply a per-group cooldown and hourly cap, and let a judge model decide whether the bot would naturally chime in. Engaged turns tell the Agent nobody called it, so it can still return no messages. Mentions, quotes and DMs are unchanged and always reach the Agent. Off unless groups are listed; `mode: shadow` logs judgments without replying.
- deeb964: Accept integer IDs where the structured reply schema expects a string (for example a mention target written as `2100001` instead of `"2100001"`) instead of spending a format-correction model call on them.
- d9cc732: Accept structured replies that miss the strict format instead of failing the turn: a JSON object wrapped in a sentence or code fence, or with a bracket too many or too few, is repaired and still validated against the schema; a plain prose answer is sent as one text message. MiniMax often writes the structured answer as text, and these cases used to reach users as "Model did not produce the requested structured output".
- d3fc1a6: Stop prefixing chat replies with "（任务步骤较多，已自动续跑 N 次）" after an automatic continuation. A group member does not announce how many steps a task took; non-IM callers (HTTP, Console) still get the notice.
- 070bb6b: Skip the assistant-profile heartbeat while HEARTBEAT.md is missing or has no task, the way the kernel scheduler's own heartbeat already did. The default heartbeat prompt only reads that file, so each idle run was a wasted model turn (about 40k prompt tokens every 30 minutes). Heartbeats with a custom prompt still run.
- Updated dependencies [974fa85]
- Updated dependencies [1e9b3d6]
- Updated dependencies [d9cc732]
- Updated dependencies [070bb6b]
  - @zhin.js/ai@1.1.43
  - @zhin.js/core@1.1.49
  - @zhin.js/kernel@1.1.5

## 1.1.38

### Patch Changes

- Updated dependencies [db06de8]
  - @zhin.js/core@1.1.48

## 1.1.37

### Patch Changes

- 6fdd30b: Fix the occasional 5 s stall on an Agent turn (`SessionSystem waitForPersistence: timeout`) when `@zhin.js/workroom` is not installed. Only the Workroom persistence coordinator marked Agent persistence ready, so in Agent-only setups the first turn of every new Agent generation waited for the fallback timer. The Agent host now marks readiness itself when Workroom is absent, and `waitForPersistence` clears its fallback timer once readiness arrives (#857).
- 1a11207: HMR no longer reloads on editor temp, swap, lock and backup files (`.!<digits>!*`, `*.swp`/`*.swo`/`*.swx`, `4913`, `*~`, `.#*`, `*.tmp`, JetBrains `*___jb_tmp___`/`*___jb_old___`); matching uses the file name only (#857).

  Plugin tools can opt into the resident tool set with `defineAgentTool({ alwaysLoaded: true })`. The default stays deferred (`discover` / `load_tool`), at most 8 declared tools are resident per turn, `alwaysLoadedMode: replace` ignores the flag, and pinned tools now stay resident when a turn rebuilds its tool list after `load_tool` (#857).

- a3ab153: Adapters can declare `segments.model` per segment type (extra optional string fields the model may fill, plus a prompt hint) that only that platform's Agent replies see. icqq now declares the segment types its encoder supports and a share extension, so the Agent can send music share cards from tool results.
- 61cca0b: AI 回复里引用的本地文件和 URL 媒体现在受本轮权限约束：`path` 必须通过与 `read_file` 相同的工作区与敏感路径检查，`url` 需要本轮出网权限并在每一跳都遵守 `allowedDomains`；不满足时以「附件不可用」占位。此前结构化回复可在禁止出网的回合里下载任意 https 地址，旧的 `<audio>` / `<video>` / `<file>` 写法还能把任意本地文件作为附件发出。`publishOutboundElements` 新增可选 `authority` 参数，IM 回合的回复入口已传入本轮权限。
- e8f7309: Agent structured replies now offer only the segment types the reply endpoint delivers (derived from the adapter's `segments.supported`), and the model can send quick-reply keyboard buttons. reply / forward / face are no longer offered to the model because it has no reliable source for their platform IDs.
- ade0f33: Export the `UsageSubject` type used by `completeText({ onBehalfOf })` and document its `groupId` format.
- d3563d9: Plugins can now import the AI completion contract from the `zhin.js` main entry without depending on `@zhin.js/agent` (#877). `@zhin.js/core` defines `aiCompletionToken` (same id, and `@zhin.js/agent` re-exports the same object), the `AiCompletion*` / `UsageSubject` types, `usageSubjectFromMessage(message)` (same quota key rules as Agent turns; returns `undefined` when the message has no sender), `isAiCompletionQuotaError(error)` and `hasResource(context, token)`. Construction and capability contexts gain an optional `has(token)` member (the built-in ones and the `@zhin.js/testing` fake plugin implement it), so plugins can check for optional resources without try/catch.
- b15c86b: `PluginTestKit` accepts a file-backed configuration (`createConfigDocument(path)`) as `config`, so tests share the same file authority as `zhin start` (saved vs applied config, `config:explain`, reload of the config file). Adds end-to-end smoke scenarios for literal-choice config forms, `config:explain` and structured replies.

  `@zhin.js/agent` evals gain a structured-reply seed case (mention + text segments) that the nightly real-model run replays under the existing request budget.

- 3224ba3: `aiCompletion.completeText`：用量配额在调用前预留提示词估算量（并发调用互相可见），调用失败或 provider 未返回 usage 时按估算计费。

  模型降级与主对话路径一致：候选为绑定模型、模型注册表推荐、该 provider 其余模型，是否实际降级由 `ai.agent.providerResilience.fallback` 决定。

- f91cc89: 修复媒体感知描述中嵌套的帧标记在单次剥离后被重新拼出的问题（循环剥离直至稳定）。
- 1148821: 媒体感知预处理（perception pre-pass）的模型用量不再丢失：`describe` 返回 `usage`，并计入本回合的 `usageQuota` 与回合 token 汇总。
- 4dd081c: 结构化回复格式修正不再把「修正指令 + 被拒绝的原文」写入会话历史：成功时只持久化修正后的助手消息，失败时持久化实际发送给用户的失败文案。
- c618eb7: IM conversation turns now get a chat prompt: the workspace persona (SOUL.md) leads, a chat style section replaces the report-style one, and the coding-workflow sections are reduced to a short "workspace tasks" note; critical rules no longer claim to override the persona. Structured replies become `{"messages":[{"segments":[...]}]}` so the model can send several short messages, delivered in order with a short pause; a legacy single `{segments}` reply is still accepted. Workspace prompt files may use a `{{nickname}}` slot filled from `ai.agents.<name>.nickname` (default `Zhin`).
- a383380: 修复 source map：这些包之前的 `.js.map` / `.d.ts.map` 指向没有发布的 `src/`，调试和"跳转到定义"都找不到源码。现在 `.js.map` 内联了源码（`inlineSources`），也不再生成指不到源码的 `.d.ts.map`。运行时行为不变。

  预告：下一个大版本会移除发布包里冗余的 `.ts` 源码（很多包里的 `src/**/*.ts`，以及插件约定目录里与 `index.js` 并排的 `index.ts`），本次不做改动。深导入 `.ts` 文件的代码请改用包的 `exports` 入口，详见根目录 `CHANGELOG.md`。

  Source maps now embed their sources (`inlineSources`); dangling `.d.ts.map` files are no longer emitted. Heads-up: redundant published `.ts` sources will be removed in the next major. Switch any deep `.ts` imports to the package's `exports` entry.

- b3bbada: 子 agent 结果投递与主动出站（`sendElements`）也不再读取或下载模型在文本中引用的本地路径和 URL（新增 `NO_MEDIA_AUTHORITY`）；工具生成的图片 / 语音是内联 base64，不受影响。补齐 #892 只覆盖 IM 回合回复入口的缺口。
- 12d9a03: 识图预处理在模型返回空描述时仍上报用量；请求发出后失败（服务端错误、超时）时按提示词加媒体的保守估算计入用户配额与本轮用量。请求发出前就被拒（如识图模型不支持该媒体）不计费。
- Updated dependencies [1a11207]
- Updated dependencies [9943df6]
- Updated dependencies [5be09ae]
- Updated dependencies [a3ab153]
- Updated dependencies [e8f7309]
- Updated dependencies [5afc18f]
- Updated dependencies [d3563d9]
- Updated dependencies [c618eb7]
- Updated dependencies [a383380]
- Updated dependencies [fbfefb7]
  - @zhin.js/tool@1.1.8
  - @zhin.js/core@1.1.47
  - @zhin.js/adapter@1.1.21
  - @zhin.js/ai@1.1.42
  - @zhin.js/im-contract@1.1.5
  - @zhin.js/agent-feature@1.1.8
  - @zhin.js/mcp-feature@1.1.8
  - @zhin.js/prompt-section@1.1.7
  - @zhin.js/skill@1.1.8

## 1.1.36

### Patch Changes

- 18de875: 累计 Agent 回合内模型接口返回的用量，修复多次工具调用只报告最后一次、总结及格式纠正漏计的问题，使回合终态、日志与已启用的用量配额使用同一累计值。
- Updated dependencies [c407bd2]
- Updated dependencies [064b06d]
- Updated dependencies [a50fc8a]
- Updated dependencies [b58548a]
- Updated dependencies [e914a93]
- Updated dependencies [e914a93]
- Updated dependencies [9816c18]
- Updated dependencies [064b06d]
- Updated dependencies [7edd04c]
  - @zhin.js/core@1.1.46
  - @zhin.js/permission@1.1.7
  - @zhin.js/plugin-runtime@1.1.15
  - @zhin.js/adapter@1.1.20
  - @zhin.js/agent-feature@1.1.7
  - @zhin.js/mcp-feature@1.1.7
  - @zhin.js/prompt-section@1.1.6
  - @zhin.js/skill@1.1.7
  - @zhin.js/tool@1.1.7

## 1.1.35

### Patch Changes

- d033076: 修复 MiniMax 结构化回复的 JSON 文本被 SDK 丢弃后误解析 thinking 的问题。保留完整 JSON 文本并继续严格校验；格式错误最多进行一次无历史、无业务工具的纠正，失败时返回固定提示，不重跑工具或放宽消息契约。
- Updated dependencies [d033076]
  - @zhin.js/ai@1.1.41
  - @zhin.js/core@1.1.45

## 1.1.34

### Patch Changes

- dd7f25f: Agent 的 IM 最终回复默认使用统一的 segments JSON Schema，贯通校验、终态事件与统一发送链路，支持文字、Markdown、真实用户 mention 与图片等媒体段。拒绝非法结构并保留媒体策略、泄漏检查和非 IM 调用边界。
- Updated dependencies [dd7f25f]
  - @zhin.js/ai@1.1.40
  - @zhin.js/core@1.1.45

## 1.1.33

### Patch Changes

- a64716a: IM 回合的出网权限改为独立开关 `ai.agent.network`（`enabled`、`allowedDomains`），默认关闭；未设置 `enabled` 时仍兼容 `execPreset: network`。没有出网权限的回合不再向模型提供 `web_fetch` / `web_search`，并在提示词里写明真正的开启方式；拒绝信息也带上同样的修复说明，模型不再编造开关位置。
- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- cc9959e: 新增插件用的纯文本补全 `aiCompletionToken`（`zhin.js/agent` / `@zhin.js/agent/runtime`）：`completeText()` 只做一次补全、不带任何工具，复用 provider 的重试、超时和同 provider 模型降级；`untrusted` 内容按数据块渲染且不能提前闭合；传 `onBehalfOf` 时计入用量配额。`AIProvider` 新增可选的 `completeTextResult()`，返回实际作答的模型与用量。

  **行为变化**：`AIService.createAgent()` / `runAgent()` 默认不再带 `registerTool()` 注册的工具（`includeRegisteredTools` 默认改为 `false`）；需要时显式传 `includeRegisteredTools: true`。

- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [a64716a]
- Updated dependencies [75e26a6]
- Updated dependencies [75e26a6]
- Updated dependencies [cc9959e]
- Updated dependencies [fdc2148]
  - @zhin.js/ai@1.1.39
  - @zhin.js/adapter@1.1.19
  - @zhin.js/agent-feature@1.1.6
  - @zhin.js/core@1.1.44
  - @zhin.js/im-contract@1.1.4
  - @zhin.js/kernel@1.1.4
  - @zhin.js/mcp-feature@1.1.6
  - @zhin.js/permission@1.1.6
  - @zhin.js/plugin-runtime@1.1.14
  - @zhin.js/prompt-section@1.1.5
  - @zhin.js/skill@1.1.6
  - @zhin.js/tool@1.1.6
  - @zhin.js/logger@1.1.2

## 1.1.32

### Patch Changes

- 9891e66: Extract the Workroom, Portfolio and Data Governance domain code from `@zhin.js/agent` into the new `@zhin.js/workroom` package. Compatibility stubs at the old internal agent paths were removed in A4b (see `move-workroom-runtime`), together with the `./workroom/*.js`-style deep exports; `@zhin.js/workroom` exposes only its package root. Import from `@zhin.js/workroom`.
- c829031: feat(agent): 长对话压缩、已告知账本与缓存友好的提示词顺序（#730）。
  - 自动压缩改为在消息达到 `contextWindow × thresholdRatio`（新配置 `ai.agent.compaction.thresholdRatio`，默认 0.7）减去系统提示和工具定义占用时触发，插件运行时会话同样生效；以前要接近“窗口减 13k”才触发。
  - 压缩摘要会保留已告知用户的结论和承诺。
  - 新增按会话的“已告知”账本，最终回复和进度汇报共用：下一轮以 `[Already told the user]` 短块提供给模型，自动去重，最多 8 条。
  - git 状态移到系统提示最后一段，便于缓存稳定前缀。
  - 回合追踪记录 provider 返回的缓存命中 token。
- 0c17e0b: feat(agent): 上下文量化与按需披露（#729）。每轮第一次模型请求的上下文开销按段估算（系统提示、工具 schema、按需工具索引、技能目录、专家 agent 目录、已加载技能、记忆、bootstrap、历史、本轮输入），写入回合追踪的 `context_budget`，`zhin trace last` 可见。插件运行时的技能目录和专家 agent 目录改为只列名称加一行说明（最多 96 字符、40 条），技能正文在 `load_skill` 后才注入；未常驻的工具在系统提示 `## Deferred tools` 段列出名称和短说明（只含本回合有权使用的工具）。修复 `load_tool` / `load_skill` 之后模型直接给出文字回复时，agent loop 仍多发一次模型请求的问题。
- bf52b40: fix(agent): read_file / list_dir / glob / grep / edit_file / write_file 默认常驻加载（仍受本轮工具过滤与 exec 策略约束），常驻工具不再写入会话快照，不占 `maxLoadedPerSession` 名额也不会被挤出。模型直接调用本轮目录中的延迟工具时自动加载并执行，审批与权限检查照常生效；不在目录中的名字仍按未知工具拒绝，并提示使用 discover / load_tool。
- 1f24fbf: feat(agent): 后台任务（Detached Task）——持久化状态机、冻结权限快照、每步 checkpoint 与重启恢复、副作用幂等键（#731）
- 55811d1: Provider resilience gate cases for model fallback and request timeouts (#724). The eval scripted model can register several candidate models and records the model id of each request; a `hang` fault step drives a virtual clock so timeout cases never wait in real time. The provider request timeout now accepts injected timers (`ProviderTimers`).
- 9b8b586: Add a scripted-model agent eval framework (`packages/im/agent/evals`) that drives `FullAgentTurnEngine` through `TurnIngress`, with tool, outbound-text, approval and termination assertions; run it with `pnpm eval:agent` (CI gate).
- a6ea7b4: Agent evals: multi-message ingress cases (#725). A case can now feed several timed messages through the IM admission protocol (TurnAdmissionGate) on a virtual clock, which makes same-sender merging, FIFO queuing of different members, cancel and queue-full/expiry testable end to end.
- 9486586: Eval mock tools can declare `parameters` (JSON Schema), which is sent to the model. Cases with live checks must declare every argument their script passes. This fixes the nightly `seed-group-member-read-only-lookup` failure, where a real model saw `get_weather` with no arguments and called it without a city.
- 2b5e5ae: Add 27 seed agent eval cases covering QQ regressions, #716/#718 fixes and #719 group-member tightening. The scripted eval driver gains native file/bash tools on a temp workspace, `notOffered` tool-call expectations, model-input assertions and generic provider fault steps, and applies the same group-member restriction as AgentRuntime via the new shared `restrictGroupMemberTurn` helper.
- bf52b40: 新增探索纪律 harness：model harness 支持 `explorationBudget`（连续只读探索调用达到次数后在工具结果中注入提示，默认 8，0 关闭）与 `explorationGuidance`（系统提示加入"先规划、限定目标文件"）；内置 MiniMax M 系列预设（explorationBudget 5，开启 guidance，不改 maxIterations），均可通过 `ai.agent.modelHarness` 覆盖。
- bf52b40: 原生文件工具不再淹没上下文：grep/glob 默认跳过 node_modules、.git、.opencode、.zhin、dist、coverage 等目录并遵循 .gitignore（路径直接指向这些目录时仍可搜索）；grep 拒绝 `.*`、`^` 等匹配所有行的模式并给出改用 read_file / glob / list_dir 的提示，跳过二进制与超大文件；grep 匹配数、输出字节、单行长度，glob 文件数，list_dir 条目数与 read_file 行数均有上限，截断时提示如何缩小范围或继续读取。
- bf52b40: Harness 组合修复：直接调用被策略移除的 bash 不再被自动加载进会话；standalone 子 loop 支持传入父 turn 策略以同样隐藏 bash；交互提示的回答（如审批回复 y）不再作为背景事件进入下一轮上下文。
- bf52b40: 修复 IM 审批静默拒绝：审批结果区分「用户拒绝 / 审核器拒绝 / 超时 / 无审批通道」，并以不诱导重试的文案返回给模型；审批提示支持回复 y/同意、n/拒绝；超时不再被当作用户拒绝记忆；owner 读取工作区内 package.json、锁文件等非机密项目文件不再需要确认（.env、密钥等仍需确认，写入审批不变）。
- bf52b40: fix(agent): 本轮策略无法执行 Shell 时不再向模型提供 bash（工具列表与目录同时过滤，load_tool 也无法再加载），万一触发会返回明确、不可重试的错误。新增 `ai.agent.masterShell`（默认 `off`）：设为 `isolated` 时，仅 IM 私聊中的 master 可在 Docker 容器内执行 bash（工作区可写、无网络、development 白名单、白名单外命令需审批），宿主无 Docker 时直接失败、不降级到宿主机。
- fc75499: feat(agent): injection guard, outbound leak check and usage quotas (#727). Once external content (tool results, web pages, files, sub-agent reports, background group events) has entered a turn, shell commands, messages to other conversations, config changes and scheduled tasks always go through the ApprovalPort, with the source chain on the approval card; unattended turns deny them (`ai.agent.injectionGuard.confirmHighRisk`, default on). Replies, progress updates and outbound tool messages now mask verbatim system-prompt lines, secrets and other sessions' memory before delivery (`ai.agent.injectionGuard.outboundCheck`, default on). New `ai.agent.usageQuota` adds per-user / per-group token quotas and a per-group rate limit, all off by default, owner exempt.
- bf52b40: fix(agent): 工具步数用尽时不再把原始工具输出发给用户。循环结束且没有可见回复时，会关闭工具再请模型总结已完成的工作、剩余事项并询问是否继续；总结失败则回复固定提示。`formatToolCallsForUser` 不再展示 read_file / grep / glob / list_dir / web_fetch 等只读探索工具的结果，并限制总长度。
- 2a9d08b: Semantic memory gets a data model and write policy (#733). Entries now carry `kind` (user_fact / preference / task_state / episodic), the writing turn and its trust level, `last_used_at` and a bounded version history; existing `memory_entries` tables gain the new columns at startup without losing rows. `memory_upsert` attributes writes to the turn (the model can no longer set `source`), keeps group members out of global/platform memory and away from facts written at a higher trust level, defaults group-member writes to their own `user` scope, and gives `task_state` a bounded expiry that can be tied to a task.
- e4fbfb2: Semantic memory retrieval uses BM25 (#734). `memory_search` ranks with BM25 (word tokens plus CJK bigrams), and each turn now recalls the top-k entries relevant to the current message from the initiator's visible scopes into the turn context, bounded by `ai.memory.semantic.recall` (`topK` 5, `maxTokens` 400 by default), so memory cost per turn no longer grows with the number of entries. Users can view and forget memory about themselves with `/memory` and `/forget`; `SemanticMemoryRuntime` gains `list` / `delete` for management surfaces.
- 4ce55db: Add a minimal per-turn trace: `TurnTrace` collector (model calls and tokens, redacted tool-call summaries with duration and result size, denials, budget extensions and auto-continuations, nested sub-agent turns, termination) fed from the turn journal, the last 50 traces kept in `data/agent-traces/recent.json`, a new `zhin trace <turnId|last>` command, and traces attached to failing eval reports.
- ba56e74: Nightly real-model evals (#723): a MiniMax capability matrix (tool-call format, parallel calls, long context, Chinese instruction following) with semantic checks, an optional LLM-judge interface, hard request/token budgets, and JSON/Markdown reports diffed against the previous night. Runs from a scheduled workflow, never as a PR gate.
- 56bafda: feat(agent): 多模态感知预处理 `ai.multimodal.perception`。主模型收不了的图片 / 视频 / PDF，由配置的感知模型（如 Gemini Flash-Lite）经 provider 韧性层描述后，以 `[图片描述]` 等不可信外部内容注入，并写入会话历史；按字节 sha256 缓存，每回合有上限，失败回到原占位。描述会让回合进入“已接触外部内容”状态（高危动作需审批），`media_resolution` 事件带上来源模型。不配置时行为不变；配置错误时启动失败，`zhin config check` 同样报错。

  fix(agent): 模型 fallback 跳过不支持本回合媒体类型的候选（已接收的图片不会在 fallback 时悄悄变成占位）；带图片的回合仍以绑定的模型（`ai.agents.<name>.model`）为第一候选。

  deprecate（仍兼容，下一个 minor 移除）：

  - `ai.agents.<name>.priority` / `match`（含 `hasMedia` 等全部条件）从未生效：IM 消息总是交给 `ai.agents.zhin`。仍接受，启动时告警，不再因此校验报错；`zhin config check` 报 `ai.agent_routing_deprecated`，`--fix` 自动删除。`ai.routes` 的 `--fix` 改为直接删除。删除未导出的 `routing/route-matcher` / `match-rules`；`RouteMatchConfig` 与相关字段标记 `@deprecated`。
  - `ZhinAgentConfig.visionModel`（仅代码可设置的残留）：仍作为图片回合的后备候选，设置时告警。
  - `AgentCore.runVision` / `runVisionTurn`、`runAgentLoopVisionTurn` / `runAgentLoopVisionTurnRun` 及其类型：无生产调用方，标记 `@deprecated`。

- 7d2263c: Progress-aware tool-call budget (`ai.agent.toolBudget`): `maxIterations` becomes a soft budget extended while the turn makes progress (not when looping or failing), with hard step/wall-clock/token caps, opt-out automatic in-turn continuation (default: master private chat), throttled natural-language progress updates (default: private chats), and the exploration budget resetting on the same progress signal. Sub-agents use the same budget with a lower hard cap and no continuation.
- 1ea299a: Add PR-gate eval cases for provider resilience (#724): 429 retry then success, retries exhausted with a polite reply, empty reply with and without a re-ask preset, and a malformed tool call.
- 27da0e8: Provider resilience for agent turns: classify provider errors (rate limit, timeout, 5xx, network, empty reply, malformed tool call), retry with exponential backoff honouring Retry-After, per-request timeout, fallback across `modelCandidates`, and per-model quirk presets (`emptyReplyRetries`, `requestTimeoutMs`; MiniMax M-series re-asks once on an empty reply). Configured via `ai.agent.providerResilience` with conservative defaults.
- 7d2263c: Add opt-in in-turn sub-agents (`ai.agent.subagentTurnMode: sync`) on the plugin-runtime turn path. Sub-agents inherit the parent turn policy, never wider (no bash unless the parent can run it); approvals go to the parent conversation and requester. DeferredWorkerRunner now offers no bash unless given a frozen turn policy snapshot.
- dbc1456: feat(agent): 后台任务插话、改向与叫停，`/tasks`、`/task stop|redirect` 命令，并从 `@zhin.js/agent` 导出后台任务模块（#732）
- d91d21a: feat(agent): trust tiers and initiator binding (#726). Each turn now has an initiator trust level (owner / trusted_member / group_member), and its authority is that level's ceiling intersected with the configured policy. This replaces the #719 group-member special case; group-member turns keep the same restrictions, but denials now report the `trust-level` policy. Sub-agent reports, third-party plugin prompt sections, skill instructions and background group events are rendered as labelled `external_content`, and traces record the initiator trust level.
- a62acca: Ordinary IM turns now have a clear policy for messages that arrive while a turn is running (#725). A sender's follow-up replaces their own unanswered turn and is answered together with the earlier text, or merges into their queued turn. Other members' messages always queue and never interrupt or merge into someone else's turn. The initiator or master can stop a turn with `取消` / `cancel`. Queues are bounded by the new `ai.agent.inboundQueue.maxQueuedTurns` (default 5) and `ttlMs`, and queue waits and merges are recorded on the TurnTrace.
- 9ab9ffb: fix(ai): `completeText`（压缩、上下文摘要、子 agent 摘要）与主对话路径对齐。
  - 经现有 provider 韧性层（`createResilientCompletionPort`）做错误分类、退避重试、单次超时（默认 180s）和同 provider 模型 fallback；SDK 自带重试置 0，避免重试叠加。
  - `TextCompleteOptions` 新增 `signal`、`timeoutMs`、`fallbackModels`、`resilience`；压缩与摘要调用方在有取消信号时透传，取消不再走降级摘要，也不计入自动压缩熔断。
  - 只返回正文，绝不把模型的 thinking 当摘要；内容安全 / 长度失败抛出 `CompletionFailureError`（消息即面向用户的说明）。
  - 未指定模型时优先使用 provider 配置的 `defaultModel`。
- 1280631: Gemini provider fixes (#769). Gemini chat models now default to multimodal input, and images go out as typed file parts. Gemini 3 function-call thought signatures round-trip. SAFETY, RECITATION and blocked-prompt refusals, empty MAX_TOKENS replies and MALFORMED_FUNCTION_CALL now show up as visible errors instead of empty replies. Gemini `RetryInfo.retryDelay`, `API_KEY_INVALID` and RPC statuses feed retry classification. A new provider-config `providerOptions` field carries `safetySettings` and `thinkingConfig`, and opt-in `contextCache: { mode: 'explicit' }` adds explicit Gemini `cachedContents` with TTL refresh and invalidation. The nightly real-model evals now run on Gemini (`GEMINI_API_KEY`), with new multimodal eval cases.
- bd78a94: Gemini coverage for the provider resilience layer (#724). Gemini safety blocks (SAFETY, PROHIBITED_CONTENT, BLOCKLIST, SPII, IMAGE_SAFETY, RECITATION and blocked prompts) now get a polite refusal and are never retried or sent to a fallback model. A per-day Gemini quota (`QuotaFailure` `PerDay`) skips retries and falls back to the next candidate model. 504 `DEADLINE_EXCEEDED` is reported as a timeout. A new Gemini model-harness preset re-asks an empty reply or a `MALFORMED_FUNCTION_CALL` once on the same model. The nightly capability matrix gets a multimodal column, and `NIGHTLY_PROVIDER=minimax` keeps MiniMax available next to the Gemini default.
- 57ea5f7: Provider config fixes. Provider `timeout` and `maxRetries` now take effect: they override `ai.providerResilience` for that provider, below per-model harness settings. New opt-in `firstChunkTimeoutMs` / `chunkTimeoutMs` abort streams that connect but go silent, and the stall is retried and failed over like any timeout. `authScheme` now works for every scheme (`Token`, `Bearer`, `''`) on chat requests and model discovery alike. The `sdk: openai` `baseUrl` gets `/v1` on a bare proxy root, like the other OpenAI-protocol providers; `compat.appendV1: false` keeps the old as-written behaviour. `compat.supportsDeveloperRole: false` sends `system` instead of `developer` to reasoning models. OpenAI refusals now surface as a content-policy message instead of an empty reply. MiniMax `baseUrl` values ending in `/anthropic` or naming only a host are completed to `/anthropic/v1`, and `@ai-sdk/minimax` is declared as an optional peer dependency. `compat.supportsReasoningContent` and `compat.toolCallsInAssistant` are deprecated no-ops, and gateway presets no longer set them.
- f48ba72: `deferredTools.alwaysLoadedTools` now extends the default resident tools (`ask_user`, `spawn_task`, `discover`, `load_tool`, `load_skill`) instead of replacing them, so an override no longer hides `discover`/`load_tool`. Set `deferredTools.alwaysLoadedMode: 'replace'` to restore the previous replace behaviour.
- 417ec5b: **Behaviour change (#753):** IM private chats from senders who are neither the owner (`master`) nor on `trigger.trusted` now get the `group_member` trust level instead of `trusted_member`. Such stranger DMs no longer get `bash`, file-write or send-to-other-conversation tools. Owner DMs, trusted-list DMs and non-IM ingress (HTTP, CLI, schedules) are unchanged. To restore full authority for a DM user, add their ID to `trigger.trusted`.
- 7f0f8ca: Agent evals: the eval driver accepts a real-model source (`createLiveModel`), and the nightly MiniMax runner now replays seed cases that declare `live` semantic checks end to end through the driver. The PR gate also runs those checks on each scripted run, so it stays deterministic (#723).
- d38d38c: Tighten agent turns started by ordinary group members (not master, not in `trigger.trusted`): no bash, read-only files, and no outbound messaging tools. Restricted tools are hidden and also denied at execution with a clear reason (#719).
- 8e26cf1: 配置面收敛（#735）：弃用运行时未读取的 `ai.agent.maxSkills`、`policyDenialStopAfter`、`deferredToolMaxResults`、`taskExecApprovalMode`（启动告警，`zhin config check --fix` 可移除），新增《默认行为规范》权威文档与开关清单门禁。
- 9891e66: 入站消息 `origin` 标签（self / member / peer_bot / human）与出站 ledger 兜底：

  - 新增 `Message.origin`（仅由 InboundRuntime 经 Peer Registry、出站 ledger 与 `roomMembershipToken` 端口可信判定，绝不读取正文或 metadata）。
  - self / member / peer_bot 来源的消息只记录（self 不重复记录），不触发命令、handlers、middleware、ingressRoute 或 agent turn；无法判定时 fail closed 为 peer_bot。
  - `[sender:...]` 标签增加 `origin=`（缺省时输出不变）；`createRuntimeTurnAccess` 对非 human 来源抛错。
  - `stripUserSpoofedSenderPrefix` 改为转义正文中所有伪造的 `[sender:` / `[origin:` 标签（全角 `［`），不再剥离开头。
  - 新增 `roomMembershipToken` 端口；Room 成员端口的实现、“Registry 未就绪的 Room 不开始协作”以及背景上下文块中 peer_bot 消息的标签留给后续条目（Room 激活 / Room Bus）。

- f768296: Stream observers of `executeAgentTurn` now read a journal-derived feed: the turn journal is the single source, so authority tool events (`tool_call` / `tool_result` / `tool_denied`) committed by TurnToolRuntime reach stream consumers in commit order with the existing TurnEvent shape, without being journaled twice. Adds `createJournalFeed` / `journalFeedOf`.
- 9891e66: Move the Workroom runtime composition (`workroom-runtime`) from `@zhin.js/agent` into `@zhin.js/workroom`; the dependency direction is now `@zhin.js/workroom` -> `@zhin.js/agent`.

  - Workroom exports were removed from `@zhin.js/agent`, `@zhin.js/agent/runtime` and `zhin.js/agent`; the `zhin.js/agent` re-export surface shrank, so users who imported Workroom exports through `zhin.js/agent` must import them from `@zhin.js/workroom` instead (the export names are unchanged). `@zhin.js/agent` no longer depends on `@zhin.js/workroom`.
  - The `Local*` assignment authority types declared by the authority provider module (`WorkroomLocalAssignmentAuthorityInput`, `WorkroomLocalAssignmentResolvedAuthority`, `WorkroomLocalAssignmentAuthorityPort`) clash with the domain contracts of the same name in a single barrel; the provider variants are exported with a `WorkroomProvider` prefix.
  - Compatibility stubs at the old internal agent paths and the `./workroom/*.js`, `./portfolio/*.js`, `./data-governance/*.js` deep exports of `@zhin.js/workroom` are removed. Use the package root.
  - `@zhin.js/agent` gains three narrow host-integration exports: `collectAgentLoopTurnRun` and type `ZhinAgentPrivate` (`@zhin.js/agent/core`; `ZhinAgentPrivate` is an internal host-integration type, not a stable API), and `runWithAgentTurnConfiguration` (`@zhin.js/agent/turn`).
  - `@zhin.js/cli` and `@zhin.js/a2a` declare `@zhin.js/workroom` as an optional/dev + peer dependency (like `@zhin.js/agent`), so installing the core no longer pulls in agent/workroom.

- bc09928: Nightly evals: retry a 503 UNAVAILABLE once (8–15 s, or a longer Retry-After), record runs that stay 503 as provider-unavailable instead of model failures, fail mostly-503 nights as infra-flaky, list budget-skipped runs in the summary, and default to gemini-3.5-flash-lite.
- 779750f: Nightly evals: serialize and pace real model requests to the Gemini free tier (≥4 s apart, ≤15 RPM). A 429 is retried after 2/4/8 s or after a longer `retryDelay` / `Retry-After`; a daily-quota 429 is never retried and fails the run with a clear message.
- 9891e66: Separate Workroom runtime code from the generic Agent runtime (`src/workroom-runtime/`) and remove Agent-core reverse dependencies on Workroom.

  Migration notes:

  - `validateWorkroomDefinitions` is no longer exported from `@zhin.js/agent/config`; import it from `@zhin.js/workroom`.
  - Workroom console fields (`workroom`, `workroomCatalog`, `workroomControl`, `workroomProfiles`, `workroomKnowledge`, `portfolioSponsor`, `effectSponsor`, `dataLifecycle`) moved from `AgentHostConsolePort` to the new `workroomHostToken` (`@zhin.js/workroom`).
  - `defineAiDatabaseModels` now registers only Agent tables; call `defineWorkroomDatabaseModels` for Workroom tables. `activateAiDatabaseStorage` no longer activates the Workroom journal/catalog; use `prepareWorkroomDatabaseStorage` (validates persisted journal headers) before it and `.activate(...)` after.
  - `plugin-runtime/deferred-capability-plan.ts` is now Workroom-free: the Workroom realization/authority code moved to `workroom-runtime/workroom-capability-realization.ts` (exported from `@zhin.js/workroom`); `createDeferredCapabilityPlan` takes an injected `ceiling` (`DeferredCapabilityCeiling`) instead of `authority`, and `isReservedControlToolName` is exported.
  - `createDeferredCapabilityPlan` now throws if the legacy `authority` option is passed (it used to be silently ignored; use `createWorkroomDeferredCapabilityPlan`), and it throws if the injected `ceiling` returns tools or skills that are not a subset of its input (by reference).
  - `RESERVED_CONTROL_TOOL_PREFIX` ('workroom\_') is exported from `@zhin.js/agent/runtime` next to `isReservedControlToolName`.

- b3fea8c: Agent turn traces are now persisted in `data/agent-traces/<day>.jsonl`, kept for 7 days with a 64 MB size cap (`ZHIN_TRACE_RETENTION_DAYS`, `ZHIN_TRACE_MAX_MB`), and redacted again when written. `zhin trace` can filter by session and time (`--sessions`, `--session`, `--since`, `--until`). A new read-only host API (`/api/agent/trace-archive/*`, full scope) backs the Console Agent Trace page (`TraceArchivePage`), which goes from sessions to turns to a turn detail with a waterfall and the raw record. Failing agent evals print a `zhin trace` command that opens the failing case's trace (#728).
- Updated dependencies [9891e66]
- Updated dependencies [c829031]
- Updated dependencies [0c17e0b]
- Updated dependencies [bf52b40]
- Updated dependencies [55811d1]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [fc75499]
- Updated dependencies [2a9d08b]
- Updated dependencies [e4fbfb2]
- Updated dependencies [56bafda]
- Updated dependencies [7d2263c]
- Updated dependencies [27da0e8]
- Updated dependencies [7d2263c]
- Updated dependencies [d91d21a]
- Updated dependencies [a62acca]
- Updated dependencies [9ab9ffb]
- Updated dependencies [1280631]
- Updated dependencies [bd78a94]
- Updated dependencies [acfaaef]
- Updated dependencies [57ea5f7]
- Updated dependencies [6e035e5]
- Updated dependencies [57ea5f7]
- Updated dependencies [55db42d]
- Updated dependencies [f48ba72]
- Updated dependencies [386150d]
- Updated dependencies [2dfe5fa]
- Updated dependencies [2dfe5fa]
- Updated dependencies [3237f63]
- Updated dependencies [8e26cf1]
- Updated dependencies [9891e66]
- Updated dependencies [9891e66]
- Updated dependencies [4778587]
- Updated dependencies [40537e3]
- Updated dependencies [681abf3]
- Updated dependencies [9891e66]
- Updated dependencies [9891e66]
  - @zhin.js/adapter@1.1.18
  - @zhin.js/ai@1.1.38
  - @zhin.js/core@1.1.43
  - @zhin.js/permission@1.1.5
  - @zhin.js/plugin-runtime@1.1.13
  - @zhin.js/kernel@1.1.3
  - @zhin.js/mcp-feature@1.1.5
  - @zhin.js/agent-feature@1.1.5
  - @zhin.js/prompt-section@1.1.4
  - @zhin.js/skill@1.1.5
  - @zhin.js/tool@1.1.5

## 1.1.31

### Patch Changes

- Updated dependencies [5ab6307]
  - @zhin.js/core@1.1.42
  - @zhin.js/ai@1.1.37

## 1.1.30

### Patch Changes

- b36452a: Bind optional decision providers to the held runtime generation. Add explicit off, shadow and active policies for progressive capability selection, scoped search reranking and automatic approval judgments, preserving deterministic permissions and human approval memory. Validate consumer configuration and expose redacted decision diagnostics.
- Updated dependencies [badcc1f]
- Updated dependencies [b36452a]
  - @zhin.js/core@1.1.41
  - @zhin.js/plugin-runtime@1.1.12
  - @zhin.js/ai@1.1.37
  - @zhin.js/adapter@1.1.17
  - @zhin.js/agent-feature@1.1.4
  - @zhin.js/mcp-feature@1.1.4
  - @zhin.js/prompt-section@1.1.3
  - @zhin.js/skill@1.1.4
  - @zhin.js/tool@1.1.4
  - @zhin.js/permission@1.1.4

## 1.1.29

### Patch Changes

- b9b3953: Recognize versioned Tool, MCP, Skill and Agent projections across native generation module identities, so protocol ingress retains visible capabilities and fixed-generation execution guards. Keep MCP tools/list available with an empty tool set and reject unknown calls explicitly instead of advertising an unavailable method.

  Bind reused Tool projections to the explicit operation snapshot: new requests read current generation config, resources and projections, while in-flight requests keep their leased generation and retirement guards.

- b9b3953: 修复框架生命周期与消息处理的竞态：HMR 停止等待异步 watcher 清理，并在清理失败时仍等待在途 reload；命令前缀通过端点能力所属插件读取配置，前导空白不再丢失结构化参数；工具在异步策略检查后再次检查取消信号；文件缓存遇到超限替换时删除旧内容并保持字节计数一致。
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
  - @zhin.js/adapter@1.1.16
  - @zhin.js/im-contract@1.1.3
  - @zhin.js/core@1.1.40
  - @zhin.js/ai@1.1.36
  - @zhin.js/tool@1.1.3
  - @zhin.js/mcp-feature@1.1.3
  - @zhin.js/skill@1.1.3
  - @zhin.js/agent-feature@1.1.3
  - @zhin.js/kernel@1.1.2

## 1.1.28

### Patch Changes

- 0de4836: Expose the canonical Plugin Runtime `Message` contract from `@zhin.js/core`, `@zhin.js/core/runtime`, and the `zhin.js` root entries, and migrate Agent, permission, and GitHub integrations to the fields middleware actually receives. Document and lock the `EndpointEvent<Notice | Request>` handler boundary so side-event payload fields match editor inference.
- Updated dependencies [43eda99]
- Updated dependencies [0de4836]
  - @zhin.js/core@1.1.39
  - @zhin.js/permission@1.1.3
  - @zhin.js/adapter@1.1.15

## 1.1.27

### Patch Changes

- 36c2eb9: Add schema-driven database setup with explicit live-tested server and driver versions, validate environment-backed connection options before startup, and generate safe database examples for new projects.

  Make durable timestamp columns portable across SQL dialects, preserve dialect-specific identity syntax, migrate legacy inbox tables before their first millisecond timestamp write, and encode canonical conversation keys at the database boundary so PostgreSQL accepts them.

  Keep legacy durable conversation rows readable, normalize transaction results consistently, and make production mode select the matching environment overlay by default.

- 95b24d4: Skip unsupported directory handle flushes on Windows while retaining file flushes and POSIX directory durability, and prevent Agent message persistence from issuing a second insert when a SQL dialect does not return an inserted id.
- cce3d5b: Automatically activate the uniquely matching private Skill of a selected platform Agent so intent-specific tools are available in the same turn.
- Updated dependencies [5b5d270]
- Updated dependencies [36c2eb9]
- Updated dependencies [95b24d4]
  - @zhin.js/im-contract@1.1.2
  - @zhin.js/core@1.1.38
  - @zhin.js/plugin-runtime@1.1.11
  - @zhin.js/ai@1.1.35
  - @zhin.js/adapter@1.1.15
  - @zhin.js/agent-feature@1.1.2
  - @zhin.js/mcp-feature@1.1.2
  - @zhin.js/permission@1.1.2
  - @zhin.js/prompt-section@1.1.2
  - @zhin.js/skill@1.1.2
  - @zhin.js/tool@1.1.2

## 1.1.26

### Patch Changes

- c861789: Own the Agent lifecycle event contract inside the Agent package and remove the
  classic Plugin event subscription bridges. Runtime consumers now subscribe
  through explicit event targets instead of Plugin AsyncLocalStorage. Agent event
  publication no longer double-writes into `Plugin.dispatch()`, and Core no longer
  declares Agent or Schedule events in `Plugin.Lifecycle`. Replace the process-global
  activity bus with a generation-owned Resource, and remove concrete Plugin objects
  from ZhinAgent and its tool security path.
- 1414ccb: Make `UserMessage.actor` the sole participant identity authority across IM trigger, Agent ingress, persistence, LLM rendering, session-tree previews, and compaction. Remove sender identity from `agent_messages.extra`, delete text-based sender recovery and duplicate sender types/helpers, and keep Core AI trigger results limited to canonical user content.
- e1d77d2: Centralize each turn's executable tool snapshot in `ExecutableToolRegistry`, removing duplicate mutable maps from full and standalone Agent loops and keeping model projection and runtime lookup on one authority.
- 743d470: Make `@zhin.js/tool` the sole owner of Agent Tool input Schema admission, JSON Schema projection, and pre-execution parsing. Require an object-root JSON Schema or the public Zod 4 `safeParse` plus `toJSONSchema` contract, remove Zod 3 structural compatibility, and delete the duplicate `@zhin.js/core/tool-zod` entry point.
- 62dee52: Rename the Agent Tool policy field from `approval` to `requiresApproval`, so values such as `never` and `always` state when human approval is required. Remove the old field without a compatibility alias and migrate built-in, adapter, feature, and utility Tools to the canonical contract.
- eb0100a: Model per-turn tool execution, Workroom priority authorization, and generation-owned governed dispatch as concrete classes with private dependencies. Construct these implementations directly and remove their anonymous-object factories.
- 6b0415a: Move Agent Host composition, database activation, runtime introspection, and MCP lifecycle helpers to `@zhin.js/agent/runtime`, and remove the classic `ToolRuntime` machinery from the package root. `composeZhinAgentRuntime` now returns the composed runtime carrying its internal Host contract, so the CLI no longer imports or calls `asPrivate` itself.
- cd54131: Remove the deleted `usePlugin`, `getPlugin`, and host-root registry signatures
  from the public runtime instead of retaining throwing or no-op compatibility
  exports. Remove the module-global `registerAIHook` compatibility registry;
  Agent hooks now belong to generation-owned resources and canonical stream events.
- 8ededb6: Remove the classic Plugin-tree Agent discovery path. Workspace Agent discovery now accepts only a project root, package Agent surface discovery accepts a filesystem descriptor, and plugin-packaged Agents remain owned by the generation Feature provider.
- 8740059: Standardize TypeScript capabilities on named module directories such as `commands/foo/index.ts`, `middlewares/audit/index.ts`, `handlers/message-receive/index.ts`, `pages/workroom/index.tsx`, and `mcps/filesystem/index.ts`. Only the fixed `index` entry is discovered; sibling files remain private helpers.

  Command route segments come from directories, while `[name]`, `[[name]]`, `[...name]`, and `[[...name]]` directories declare dynamic parameters. Plugin owners do not enter the route unless their config explicitly sets `commandNamespace`; Endpoint `commandPrefix` remains platform-owned and defaults to an empty string.

  Migrate the built-in adapters, plugins, examples, generators, migration tooling, hot reload classification, Agent authoring surfaces, documentation, and release artifacts to the explicit entry convention.

  Make Tool ownership and progressive disclosure explicit across all four supported locations: plugin-public `tools/`, Agent-private `agents/<name>/tools/`, Skill-private `skills/<name>/tools/`, and Agent-Skill-private `agents/<name>/skills/<name>/tools/`. Move adapter and group-suite operations that require domain instructions into their owning Skills so `load_skill` is the only path that unlocks their schemas.

  Remove the package-root `agent/` convention. Public capabilities now use named package-root directories, schedules use `schedules/<name>/index.ts` or `plugin.ts` injection, MCP connections use `mcps/<name>/index.ts`, Prompt Sections use `prompt-sections/<name>/index.ts`, Agent definitions use `agents/<name>/`, and permission vocabulary is published as `PERMITS.md`.

- 25a845a: Unify Skills on `skills/<name>/SKILL.md`, support Agent-private Skills and nested Skill-private Tools, publish and mount existing plugin Skills, add governed Skill metadata and Turn access filtering, unlock only already-admitted same-owner Tools, and make `on-risk` and `once` approval behavior precise.
- 103f2c3: Document the canonical Workroom Journal, Projection Outbox, and Extended Console RPC module entries, and add a repository gate that prevents external deep imports or restoration of their removed flat source entries.
- 9110ab8: Move optional Speech loading and pipeline ownership into the CLI composition root. Agent media handling now depends on an explicitly injected `AudioTranscriptionPort`; Core no longer exposes a process-global Speech loader, and Logger no longer exposes the process-global warn-once registry.
- d844144: Move Bash execution to a native generation ToolFeature backed by an explicit execution port and the typed Turn policy. Remove the classic Bash tool API, hidden input authority channel, and `createBuiltinTools` Bash entry.
- 2a2b5d7: Move conversation compaction state into a host-owned `AgentCompactionRuntime`. Automatic compaction, manual compaction, lifecycle cleanup, and stability metrics now operate on the same explicit runtime instance, so multiple Agent hosts cannot share or evict each other's session state.

  Remove the process-global compaction state helpers. `@zhin.js/agent/memory` now exposes the class-based runtime, including instance-local metrics, LRU pressure eviction, and cleanup.

- 1fa1c09: Replace the process-wide proxy URL and fetch cache with provider-owned `AiHttpTransport` instances. Model discovery, text generation, image generation, and generated-image downloads now use the owning provider's transport, and disposing `AIService` waits for proxy agents to close.
- b853dba: Remove process-global ScheduleEngine and Scheduler getters and setters. Each assistant ScheduleJobEngine now owns and disposes an isolated scheduler, preventing cross-runtime job collisions and stale timers.
- e561309: Give each IM runtime one dedicated conversation owner for event-store replacement, inbound and outbound fact recording, notice normalization, reference lookup, context aggregation, and consumer cursors. Split the conversation contract into reader and writer ports so Agent and CLI receive only the read capability while Core retains mutation authority.
- f4387ef: Publish `generate_image` as a generation-owned native Tool Feature for both main and subagent turns. Provider lookup and image defaults now stay with the Host-owned `AIService`, execution follows the canonical `ToolIndex` and `TurnToolRuntime` path, and the detached class-based implementation is removed.
- 75920c4: Replace the process-global LLM provider, transport, live-model resolver, and language-model caches with owner-scoped `LlmApiRuntime` instances. Agent loops and compaction now require an explicit completion port; AIService, ZhinAgent, subagents, deferred workers, and the CLI composition root retain and inject their own runtime. Remove the global registration, lookup, resolver, cache-reset, and test-reset APIs.
- 5c1ea6c: Replace the process-global Owner approval helpers with `OwnerApprovalRuntime`, owned by each `ZhinAgent` and injected into command handling and exec policy evaluation. Remove classic `Plugin` lookup wrappers, the unreachable pending-approval map and shorthand, and its misleading stability metric.

  Split strict V2 persistence into a private store that validates complete documents and writes atomically. V1 files are rejected without online migration or rewriting; retained approvals must be recreated explicitly.

- cd4f240: Replace the detached class-based `knowledge_search` implementation with a generation-owned Tool Feature backed by the explicit `KnowledgeIndex` contract and encapsulated `MarkdownKnowledgeIndex`. The CLI publishes it to main and subagent turns only when `ai.knowledge.baseDir` is explicitly configured inside the project root. Knowledge indexing is bounded, abort-aware, deterministic, and shared by both execution paths.
- 535fed1: Make `tools/<name>/index.ts` available to the owner-aware Tool Feature, preserve tool tags and keywords through Agent projection, and replace the 60s plugin's process-global API base registration stack with an owner-scoped `SixtySClient` used by every command and Agent Tool.
- 5d990be: Remove dead classic Plugin and Adapter runtime bridges. Agent activity feedback now depends on the explicit Adapter `EndpointControl` port, dangerous-tool allowlists come only from the current turn context, and the unused global Adapter registry cleanup and typing example integration are gone.
- cd55ee6: Remove the ambiguous `defineTool` and `DefineToolInput` aliases from the Agent authoring surface. Explicit `tools/<name>/index.ts` entries now use the single canonical `defineAgentTool` authoring API.
- 98dbc85: Remove classic `*.tool.md` and standalone Skill directory discovery from the Agent runtime. Tools now enter through Plugin Runtime `tools/<name>/index.ts` features, Skills use `skills/<name>/SKILL.md`, and Group Suite keeps its database and transient state inside its owning plugin runtime.
- 3abdc90: Remove the unused classic Plugin-based Agent introspection REST and collector APIs. Console introspection is owned by the Host composition and reads commands, components, middleware, endpoints, and Agent resources from the current Runtime snapshot.
- 2b7b271: Remove the unused classic `AgentFeature` and `MCPFeature` registries from the Agent root API. Agent presets and MCP connections now have one authority each: the generation-owned `AgentIndex` and `McpIndex` projections provided by their dedicated Feature packages.
- f19d598: Remove the remaining classic Agent Tool rail and the unmounted `install_skill` and retired `activate_skill` protocols. Skill loading now uses the polymorphic `SkillInstructionSource` contract and typed read results, `spawn_task` owns its explicit turn-bound definition, and Web, file, orchestration, spawn, and Skill modules replace the former catch-all `builtin` directory. Remove the unused ToolSelection collector and its compatibility exports so the generation Tool catalog remains the only production selection path.
- ba0ba3c: Remove the unused classic `createBuiltinTools()` aggregate and the duplicate class-based file, web-fetch, and TODO Tool implementations. These capabilities are now exposed only as generation-owned `@zhin.js/tool` definitions and executed through `ToolIndex` and `TurnToolRuntime`.
- 5140ce1: Remove the unmounted classic Database Feature, its `defineModel` extension, and the process-global post-start migration hook. Database tables and lifecycle now have one authority through the generation-owned Database Host. Also remove the inactive online `bot_id` compatibility migration; supported schemas must use `endpoint_id` directly.
- 379439b: Remove the unmounted classic Core `ToolFeature` and `SkillFeature` registries and the unused Agent bridge that copied them into a mutable resource hub. Tool and Skill authority now comes only from generation-owned Feature projections consumed by Plugin Runtime `CapabilityIngress`; Core retains only the stateless IM access predicate used by the current path.
- 11c9352: Remove dead deprecated aliases from Core and Agent, including legacy Tool and outbound segment types, the old interactive segment helper, duplicate Session and Schedule names, obsolete log formatters, and the process-global Task Executor drain shim. Current APIs now expose one name and one ownership model for each behavior.
- 4bc3d3c: Remove the unused IM-specific session store and its Agent injection slot. The persistent and in-memory implementations now share `AgentSessionRepository` as the single origin-neutral session lifecycle contract, and generated epoch IDs no longer depend on process-global counters.
- 6012e3c: Remove the detached `analyze_media` Tool that reported images as model-ready without injecting them into a model turn. Inbound images now use the canonical media pipeline directly: vision-capable providers receive native image input, while unsupported providers report that limitation explicitly. File tools no longer direct callers to a nonexistent analysis path.
- 31b42a8: Remove the latest-generation store API and implicit module-global runtime access. Generation-owned state is now provided as snapshot resources and resolved from each command, middleware, component, tool, or scheduled operation's capability context.

  RSS, content moderation, and music now expose owner-scoped runtime tokens. The Agent security, prompt, continuation, typing, anomaly, audit, and sandbox modules require explicit instances instead of selecting a process-global current generation.

- cb61227: Remove the implicit classic `web_search` Tool from standalone `AIService` agents. Standalone capabilities are now explicit through per-agent `tools` or the service-owned registration boundary, while the generation runtime remains the sole owner of native Web Tool Features. Move shared Web search infrastructure into the cohesive `web` module and reject ambiguous duplicate registrations.
- 140cf0f: Remove the legacy composed side-event mapping aliases in favor of structured `mapNoticeParts` and `mapRequestParts`. Delete unmounted Agent default hook, tool, and subagent modules that exposed no runtime behavior.
- 774ed26: Require the canonical `data/memory/global`, `platforms/<platform>`, and `sessions/<session>` layout. File-memory loading no longer copies or reads root-level legacy files, and the public migration helper has been removed.

  Anchor memory path classification to the selected workspace and reject root-level or unknown memory paths. Path resolution, policy checks, and memory reads are now pure and cannot create memory directories as a side effect.

- adecba9: Remove process-global prompt, instruction, bootstrap, and Git status caches. Context readers now observe the current workspace on every request without cross-owner state or cache-reset APIs.
- 019f5ff: Make the generation `ToolIndex` the sole Agent Tool catalog. Remove the empty ResourceHub Tool registry, its builder and Capability Seam adapter, and stop merging its empty projection into Console introspection. Agent support resources now own only Skill, SubAgent, MCP, and Hook state; plugins register Tools through `tools/<name>/index.ts` or `context.addTool()`.
- 77d5a46: Remove the retired `tool_search` and `run_deferred_task` orchestration protocol from the Agent and CLI. `discover`, `load_tool`, and `spawn_task` are now the only documented and executable orchestration vocabulary; obsolete config migration, result formatting, prompt redaction, reserved names, subagent filtering, and the detached class-based tool are removed. Config repair now preserves canonical `ai.agent` fields while removing retired model fields.
- da17137: Remove the unused legacy Capability Seam DI symbol and direct Tool and Skill invocation compatibility APIs. Capability Seam now enters the runtime only through the generation-owned `capabilitySeamToken`, provider projection, and the canonical Turn Tool Runtime.
- 659b61d: Require the current Agent session database models during generation activation and remove automatic SQLite schema probing, legacy-column deletion, and historical session-tree backfills. Database mode now rejects incomplete schema registration instead of silently retaining in-memory session state.
- 91adaa5: Require every Workroom Projection binding and outbox item to carry an explicit audience and binding-generation cursor. Remove online normalization of legacy bindings and cursor migration, and split Projection contracts, repositories, state transitions, tracing, projection rules, and delivery into one canonical domain module.
- 1fed817: Require the composition root to inject one `NotificationRouter` into Schedule execution and delivery. Remove the duplicate `resolveAdapter` construction path and the Task Executor adapter resolver exposure so scheduled output has one outbound routing authority.
- 698f16f: Replace ambiguous command approval modes with `ask`, `auto`, and `bypass`, add a fail-closed review Agent, and scope remembered human decisions to the current invocation, sender, or conversation.
- e5d9795: Separate Workroom, Portfolio, and Data Governance domain contracts from Agent runtime composition. Assignment grants, disclosure authority, remote execution, governed dispatch reasons, catalog validation, and effect blocker ports now belong to their domain modules; the local model assignment adapter moves to `@zhin.js/agent/runtime`. Remove the deprecated Workroom catalog config aliases and enforce the domain dependency direction in the architecture harness.
- 444ea45: Split the Workroom Journal into a canonical domain module with explicit contracts, Memory/File/Database adapters, event validation and codec, stored control projection, and governed payload publication/replay boundaries. Preserve the package-root API while removing the monolithic source entry and migrating all internal consumers to the new module.
- 2fd8017: Make root `AGENTS.md` the main Agent contract and `agents/<name>/agent.json` plus `system.md`, `boundaries.md`, and `conventions.md` the only named sub-agent authoring shape. Standardize Agent and Skill private Tools, Skills, and Hooks as nested named directories, enforce access predicates and governed Tool activation, and keep supporting-file changes on Agent Slot hot reloads.
- 5c3858e: Make `@zhin.js/im-contract` the explicit zero-dependency owner of transport identities, canonical segments, media guards, conversation facts, stores, and delivery contracts. Platform adapters now read media contracts from that foundation instead of reaching through Core.
- 33ea736: Use `tools/<name>/index.ts` and `defineAgentTool` from `@zhin.js/tool` as the sole Agent Tool authoring model. Remove the duplicate `@zhin.js/tools` definition, context, bridge, export, and discovery path; migrate plugin manifests, examples, scaffolding, HMR, and prepack compilation to the generation-owned Tool Feature.
- Updated dependencies [c861789]
- Updated dependencies [1414ccb]
- Updated dependencies [743d470]
- Updated dependencies [62dee52]
- Updated dependencies [13f7301]
- Updated dependencies [cd54131]
- Updated dependencies [a9e4a40]
- Updated dependencies [5855db7]
- Updated dependencies [ef92a6d]
- Updated dependencies [ec921d2]
- Updated dependencies [8740059]
- Updated dependencies [63d1f7a]
- Updated dependencies [25a845a]
- Updated dependencies [9110ab8]
- Updated dependencies [3d42fc9]
- Updated dependencies [eb3227a]
- Updated dependencies [1fa1c09]
- Updated dependencies [b853dba]
- Updated dependencies [e561309]
- Updated dependencies [d4c6175]
- Updated dependencies [7a0e1ca]
- Updated dependencies [103b5d3]
- Updated dependencies [5a7a7f7]
- Updated dependencies [75920c4]
- Updated dependencies [b076eae]
- Updated dependencies [cd4f240]
- Updated dependencies [535fed1]
- Updated dependencies [73a24b7]
- Updated dependencies [4380cf9]
- Updated dependencies [2dbbc15]
- Updated dependencies [1cb1163]
- Updated dependencies [be3061e]
- Updated dependencies [75f8332]
- Updated dependencies [81935e2]
- Updated dependencies [f9ed01b]
- Updated dependencies [ac0ab50]
- Updated dependencies [5140ce1]
- Updated dependencies [522d75f]
- Updated dependencies [a7611b3]
- Updated dependencies [8823044]
- Updated dependencies [379439b]
- Updated dependencies [11c9352]
- Updated dependencies [4bc3d3c]
- Updated dependencies [31b42a8]
- Updated dependencies [135ac91]
- Updated dependencies [140cf0f]
- Updated dependencies [251e4d2]
- Updated dependencies [203ad34]
- Updated dependencies [e6c5113]
- Updated dependencies [e0f6478]
- Updated dependencies [77d5a46]
- Updated dependencies [65d0391]
- Updated dependencies [698f16f]
- Updated dependencies [2fd8017]
- Updated dependencies [5c3858e]
- Updated dependencies [cf83528]
- Updated dependencies [33ea736]
- Updated dependencies [df9f76b]
- Updated dependencies [0724ddd]
  - @zhin.js/core@1.1.37
  - @zhin.js/ai@1.1.34
  - @zhin.js/tool@1.1.1
  - @zhin.js/plugin-runtime@1.1.10
  - @zhin.js/adapter@1.1.14
  - @zhin.js/mcp-feature@1.1.1
  - @zhin.js/prompt-section@1.1.1
  - @zhin.js/agent-feature@1.1.1
  - @zhin.js/skill@1.1.1
  - @zhin.js/logger@1.1.1
  - @zhin.js/kernel@1.1.1
  - @zhin.js/im-contract@1.1.1
  - @zhin.js/permission@1.1.1

## 1.1.25

### Patch Changes

- 33b1582: Update vulnerable dependencies and replace unsafe HTML and protocol-text regular expressions with bounded scanners.
  - @zhin.js/core@1.1.36

## 1.1.24

### Patch Changes

- 28b7375: Add a governed software-delivery plan, GitHub workspace REST transport and exact-artifact CI/CD provider integration. Enforce candidate-bound, current-clock review and Sponsor decisions; prevent duplicate Effect dispatch and recover uncertain external operations through query-only reconciliation and health evidence.

  Custom GitHub capabilities must provide an explicit binding matching the Effect capability reference and digest; missing or mismatched bindings now fail closed. Ref and PR recovery validate the actual immutable diff against the workspace path scope before settling success.

- aec523c: Add authenticated GitHub Issue admission through the standard Workroom Host, isolated coding execution and Git object upload, and a digest-bound GitHub Actions candidate provider. Keep missing service identities and deployment prerequisites blocked, with durable recovery and cancellation checks.

## 1.1.23

### Patch Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.
- a34bf91: Publish internal peer dependencies as compatible caret ranges instead of exact versions, preventing compatible internal minor releases from forcing unrelated major bumps.
- Updated dependencies [1fc6270]
  - @zhin.js/agent-feature@1.1.0
  - @zhin.js/ai@1.1.33
  - @zhin.js/core@1.1.35
  - @zhin.js/im-contract@1.1.0
  - @zhin.js/kernel@1.1.0
  - @zhin.js/logger@1.1.0
  - @zhin.js/mcp-feature@1.1.0
  - @zhin.js/permission@1.1.0
  - @zhin.js/plugin-runtime@1.1.9
  - @zhin.js/prompt-section@1.1.0
  - @zhin.js/schedule@1.1.0
  - @zhin.js/skill@1.1.0
  - @zhin.js/tool@1.1.0

## 1.2.1

### Patch Changes

- @zhin.js/core@1.5.16

## 1.2.0

### Minor Changes

- 12325e1: Project Root Capability Seam Tool and Skill providers through the fixed-generation
  `CapabilityIngress` through the new `capabilitySeamToken` and canonical
  `TurnToolRuntime`, including permission,
  approval, cancellation, journal, conflict, and lifecycle enforcement. Direct
  Tool and Skill invocation helpers now fail closed; use projected Turn
  capabilities for execution.

### Patch Changes

- d19e976: Repair Workroom bootstrap, planning, governed payload, Portfolio assignment, scheduling, projection, acceptance, and graceful shutdown flows so fresh self-hosted projects can execute `/work` end to end.

## 1.1.22

### Patch Changes

- a728a20: Expose the token-bound Console principal for safe Workroom sponsor initialization, generate the missing governed Console disclosure sink, use one canonical Catalog binding digest, and renew stale Project disclosure authorities after Catalog or Sponsor changes.

## 1.1.21

### Patch Changes

- 337fd05: Normalize Project Data Governance authority candidates before requesting the exact publication decision, so Workroom disclosure bootstrap persists through the canonical repository without digest drift.

## 1.1.20

### Patch Changes

- 882a08a: Complete first-run Workroom disclosure setup with explicit model-processor contracts, a self-hosted Root-private AES/HMAC authority, Catalog-bound P12 publication, Console diagnostics, and fail-closed regression coverage.
- Updated dependencies [882a08a]
  - @zhin.js/ai@1.5.9
  - @zhin.js/core@1.5.15

## 1.1.19

### Patch Changes

- d85eddd: Add an end-to-end first-time Workroom planning setup flow: configure trusted Pack publishers, diagnose token/Catalog/Profile/Policy joins in Console, and bootstrap a governed Capability Pack, active Project Profile, and Planning Policy from the exact current generation.
- Updated dependencies [d85eddd]
  - @zhin.js/ai@1.5.8
  - @zhin.js/core@1.5.15

## 1.1.18

### Patch Changes

- a5ee497: Stop Workroom feedback loops in shared IM rooms by consuming trusted Bot principals without confusing Endpoint aliases with platform user IDs. Admit explicit mentions on member Bot endpoints, route projection replies through each member's configured or default primary endpoint, and keep governed `/work` requests inside Workroom when planning is unavailable. Converge stale Workroom projection bindings to the interaction binding revision with monotonic idempotent replay, and preserve Sponsor bindings when one Agent definition occupies multiple member roles.
- 7108d0b: Resolve uniquely mentioned Workroom members to their active Assignment, isolate Orchestrator turns from ordinary room sessions and conversation tails, remove classic subagent delegation from Workroom capabilities, deliver replies through the canonical Orchestrator Endpoint, reject untrusted bot identity metadata, and recognize implicit default Endpoints during Catalog validation.
- Updated dependencies [ba7e17a]
- Updated dependencies [7108d0b]
  - @zhin.js/core@1.5.15
  - @zhin.js/ai@1.5.7

## 1.1.17

### Patch Changes

- 736fa04: Fix Workroom human-ingress replay for runtime Endpoint identities containing canonical separators, add per-member Bot/App message routes for shared rooms, acknowledge applied human input, and expose exact application errors in runtime logs.

## 1.1.16

### Patch Changes

- e9c6a73: Close lifecycle races across IM activity indicators, subagent cancellation and schedule feedback: retry inactive starts, serialize native typing keepalives with cleanup, await generation disposal without task-observer self-deadlocks, propagate subagent abort signals without delivering retired-generation results, preserve spawn/start/finish ordering, and make same-scene schedule locks executor-owned and lifecycle-drained. The deprecated global schedule-lock drain remains exported for compatibility but now fails explicitly with migration guidance instead of falsely reporting that generation-owned executors were drained.
- 902fa35: Separate Adapter definitions from live Endpoint responsibilities in activity feedback. Runtime feedback now depends on a narrow outbound send port and the concrete Endpoint control surface instead of fabricating the legacy all-in-one Adapter class.
- 54bfd6b: Introduce Prompt Sections as a generation-owned Plugin Runtime Feature. Projects can declare typed context under `agent/prompt-sections/`, select interactive or scheduled profiles and IM platforms, and govern presentation order separately from required/preferred/opportunistic budget retention. In-flight turns remain pinned to their original generation across hot reloads, required policy fails explicitly when it cannot fit, duplicate identities are rejected, and the previous mutable Agent-local discovery and platform contributor APIs are removed. ICQQ and GitHub platform guidance now use the same Feature instead of a module-global registry.

  Expose a content-free Prompt Section catalog through Console introspection, including owner, source, generation, profiles, and budget policy without disclosing prompt text. New AI projects mount the Feature automatically, and the full-bot example plus Chinese and English product documentation demonstrate the supported configuration.

- 12025ee: Project exact Endpoint control capabilities through the outbound Host and connect native typing, editable progress, ordered Agent/subagent/tool events, and transient Schedule completion states to IM activity feedback. Gate event ingress by the committed Runtime generation, pin Endpoint operations and retirement cleanup to that generation's IM snapshot, and guarantee terminal cleanup across public Agent error and cancellation paths.
- 09b14d6: Publish clearer package and authoring API documentation for generated references and editor IntelliSense.
- 1fc78bc: Unify native platform Client access behind the literal `adapter` discriminant. Handlers infer both native events and Clients, while command, inbound/outbound middleware, and both Agent tool authoring surfaces expose the exact operation-scoped Client through a lazy `$client` getter. Definitions without `adapter` keep `$client` typed as `unknown`, and runtime dispatch rejects adapter mismatches before resolving the Client. Bundled platform tools now use this single path instead of model-provided endpoint ids and adapter-specific dependency wrappers. Every adapter registers one Client/EventMap contract, and protocol adapters including NapCat, Milky, OneBot and Satori now produce transport-independent Client objects rather than letting Endpoint instances impersonate Clients.
- Updated dependencies [54bfd6b]
- Updated dependencies [12025ee]
- Updated dependencies [09b14d6]
- Updated dependencies [1fc78bc]
  - @zhin.js/prompt-section@0.0.1
  - @zhin.js/core@1.5.14
  - @zhin.js/plugin-runtime@1.1.8
  - @zhin.js/ai@1.5.7
  - @zhin.js/logger@1.0.77
  - @zhin.js/skill@1.0.13
  - @zhin.js/tool@1.0.13
  - @zhin.js/agent-feature@1.0.13
  - @zhin.js/mcp-feature@1.0.13
  - @zhin.js/permission@1.0.4
  - @zhin.js/kernel@1.0.8

## 1.1.15

### Patch Changes

- 3dbf990: Add content-free Workroom readiness diagnostics and authenticated Sponsor controls for exact-sequence Run cancellation and durable replan requests.
- Updated dependencies [f2c532f]
  - @zhin.js/core@1.5.13

## 1.1.14

### Patch Changes

- d336a3f: Remove the process-global Assistant, legacy orchestration, and session-tree registries. Host and Console operations resolve narrow projections exclusively from the request's generation-owned `AgentHostPort`; the Workroom major changeset removes `OrchestrationService` itself rather than retaining another mutable command authority. Shadow generations can no longer publish operational state before commit, retired generations cannot leak back into service, and Console no longer receives concrete mutable repositories, engines, ingress objects, or orchestration services.

  Also remove the unused process-global bootstrap gate, connection authorization queue, session agent-state store, and the empty `@zhin.js/agent/connection` compatibility subpath. The inert state-authoring contract is removed in full: `defineState`, its public definition/discovery types, `DiscoveredPluginAgentSurface.states`, `AgentSurfacePluginInfo.states`, and `agent/state/*` discovery/reporting no longer exist. These experimental APIs had no production authority or lifecycle owner; connection authorization and durable state must be supplied by explicit generation-owned ports instead.

  Remove the equally inert `defineDynamic` contract, `agent/dynamic.ts` discovery, process-global resolver registry, and per-turn prompt scratch field. Although files were reported as discovered, no production composition path ever registered them. Dynamic turn policy must be modeled as an explicit generation-owned projection rather than a latest-live module registry.

  Make the Schedule `JobWorker` the sole owner of a narrow private `ScheduleExecutionQueue`, removing the public generic orchestrator `TaskQueue`, module-level latest-generation lookup, implicit queue/timer construction fallback, speculative DAG/priority/listener APIs, and the direct-execution bypass. Queue timeout and disposal now propagate cancellation through `TaskExecutor` into the Schedule Turn, retain their concurrency/lifecycle slot until the real operation settles, settle every queued waiter, and reject use after disposal. Remove the deprecated `AssistantJob*`, `createAssistantJobStore`, `getAssistantJobsPath`, `legacyDualWrite`, and inert `jobsFile` configuration surfaces; Schedule naming and the fixed `schedule-jobs.json` path are now the only contracts.

- 0c82a7e: Remove the process-global remote Agent and task-poller registries. Remote orchestration now receives an explicitly generation-owned `RemoteAgentRegistry`; configured Agent Cards are validated and must be ready before a candidate generation can publish. Delegation, SSE continuations, non-streaming polling, and persisted-task recovery are tracked and drained by that owner, while the old public poller API has been deleted.
- b9217e4: Replace the process-global semantic-memory repository and classic memory tools with a generation-owned `SemanticMemoryRuntime` and native ToolFeature definitions. Enabling semantic memory now requires a ready Database Host and `memory_entries` model; invalid candidates fail closed instead of silently using process-global or ephemeral memory.

  Completed orchestration runs are no longer written to semantic memory implicitly. Persisting a run summary now requires an explicit, authorized memory write through the generation-owned tool/runtime, so orchestration completion and durable user memory no longer share a hidden side effect.

- 974772e: Replace the user-facing `Prompt` vocabulary with the `UserInteraction` authoring surface for input, confirmation, and selection. Commands and handlers now expose `interaction`; IM Runtime exposes `createInteraction`; schema-driven endpoint collection is named `SchemaInteraction`. The old prompt-named interaction types and properties are removed rather than aliased. User interactions render through one canonical Markdown and keyboard/list presentation module shared by commands and Agent `ask_user` turns.

  Extract the transport-neutral interaction contract into `@zhin.js/interaction`. A discriminated `ask()` API supports text, number, confirmation, single-select, multi-select, and typed lists with structured `title`, `description`, and `tip` content. Typed `sequence()` interactions return one result object keyed by step id, render progress, and retry invalid replies without leaking invalid values to callers.

  Preserve AI Markdown and card command actions through outbound publishing. QQ delivers Markdown with native command buttons; KOOK, Discord, Telegram, DingTalk, and Lark/Feishu now declare and encode their native Markdown dialects while retaining each adapter's interaction policy. Correct QQ callback button action encoding and button style mapping.

- 5969c5b: Preserve shared-session participant attribution through conversation persistence and compaction, add explicit turn intent routing, expose the compatible supersede/FIFO overlap policy, and retain causal participants on tool journal events.
- 2f786bd: Replace text-only IM context and metadata-based quote handling with canonical
  conversation events, scoped reference resolution, explicit Endpoint content
  ports, and typed multimedia outcomes. Conversation notices are projected as
  untrusted context data rather than model-authority system instructions.
  The process-global passive-group buffer is removed: prior inbound conversation messages
  are now consumed from the same event store and cursor, with the current Turn
  message excluded from its own context projection.
  The unused `ConversationMemory` topic-memory runtime, its timers, legacy tables,
  and topic-window configuration are removed; `ContextRepository` is the only
  Agent conversation-history authority.
- 63d89f9: Remove the unconstrained `accept_task` Workroom command. Task acceptance now enters through a trusted `WorkroomAcceptancePolicyDecisionPort`; the Kernel validates exact Task/Assignment/candidate bindings and permits automatic acceptance only for low-risk, fully deterministic, evidence-complete candidates before appending a structured Acceptance Record with Journal CAS.

  Pre-policy `task.accepted` journal entries do not satisfy the new record schema and must be exported for audit and replanned instead of being silently promoted to accepted Project state.

  Task revisions must now pin an immutable Acceptance Contract and Policy snapshot before an Executor can claim them. The standard Agent Host resolves the provider through the generation-owned `workroomAcceptancePolicyDecisionToken`, so hot reload cannot replace the contract already recorded in a Run.

  Policy routes that require judgment or high-risk authority now append durable, candidate-hash-bound Reviewer Assignment or Sponsor Gate facts. Each wait records its pinned Contract/Policy, owner, deadline and recovery actions; expiry is replayable and can be reopened by a fresh policy evaluation, replanned or cancelled without waiting for an Agent response.

  Reviewer claims/verdicts and Sponsor decisions now enter through typed Kernel methods backed by a generation-owned `WorkroomAcceptanceAuthorityPort`. Every authorization is rebound to the exact Project, Run, Task, target and Journal sequence; producer self-review, stale candidates, incomplete criterion/claim disposition and untrusted authority are rejected. Reviewer-only and Reviewer-then-Sponsor routes now produce replayable Acceptance Records with principal and control-target proof.

- 71c7cdd: Add the first production Data Governance boundary. Unknown or malformed descriptor input is quarantined against a trusted category/kind confidentiality floor, while the pure disclosure policy returns only typed `full`, `metadata_only`, `transform_required`, `approval_required`, or `deny` decisions bound to the exact descriptor, policy, channel, purpose, principal, processing destination, recipient snapshot, transform, and approval scope.
- 3cca0ea: Advance the production Workroom boundary with four fail-closed contracts:

  - project accepted Task claims into immutable Task Memory and typed, CAS-bound Project State patches without admitting rejected or free-form report content;
  - persist Remote A2A dispatches in a crash-durable, fenced Memory/File Outbox with payload-sensitive idempotency and reconciliation states that cannot complete Tasks;
  - execute exact role-scoped Assignment envelopes through a cancellable observation-only Executor port; and
  - register, govern, activate, roll back, and pin immutable Project Profile revisions, requiring Sponsor authority for bootstrap or semantic capability expansion.

- 1312ca0: Replace the legacy mutable orchestration stack with the event-sourced Workroom Kernel.

  - `@zhin.js/agent` now exposes versioned Workroom events, pure replay/decision state transitions, CAS journals, and a read-only runtime projection. The public `OrchestrationService`, mutable repositories, `AgentDispatcher`, executor/workflow APIs, remote Agent registry/poller, old orchestration tools/constants, and five-agent workflow strategy are removed.
  - `zhin.js/agent` no longer exports the immediate-execution `runPipeline`, `runParallel`, or `route` helpers. Use `AIService.runAgent` for an ordinary one-shot model call; durable multi-Agent collaboration must enter a Workroom Plan and Assignment lifecycle.
  - `spawn_task` is now only an ordinary chat subtask facility. It no longer accepts Run/Task identifiers, creates Runs from IM sessions, dispatches remote tasks, or writes Workroom state.
  - `@zhin.js/ai` no longer owns IM Agent orchestration database models or the unused `ai.remoteAgents` configuration. Workroom persistence belongs to `@zhin.js/agent` as `workroom_events` or an atomic file journal.
  - The Workroom journal backend is fixed for the process lifetime. Changing `ai.sessions.useDatabase` requires a process restart; an unavailable selected database rejects generation activation instead of falling back to another authority.
  - The CLI exposes the read-only Project-scoped Console API at `/api/agent/workroom/runs`; the old `/api/agent/orchestration/runs` route is removed. No model-writable Workroom compatibility tools are published: future command adapters must hold an authenticated Project capability and dedicated Scheduler/Executor/Acceptance ports.
  - The Console client now queries Workroom Runs by `projectId` and renders the replayed Task revision/attempt state. `registerOrchestrationConsole`, `OrchestrationRunsPage`, and `/console/orchestration` are removed in favor of the Workroom-named surface.

  Execution completion and acceptance are separate durable facts. All writes use `append(runId, expectedSequence, events)`; no mutable Task projection can act as a second authority.

- 985fa22: Remove `ai.workrooms` as a restart-bound configuration surface. Workroom definitions now live in the persistent Workroom Catalog, are validated against the exact active Plugin Runtime generation, and can be managed through the Console without rewriting process configuration.

  Remove the `AgentOrchestrator` and `ResourceHub` compatibility exports in favor of `AgentResourceHub`. The renamed resource hub is only the generation-scoped registry for Tool, Skill, SubAgent, MCP, and Hook capabilities; durable Workroom orchestration and Run/Task/Assignment state remain exclusively owned by the Workroom Kernel and its typed ports.

  Route durable IM ingress through canonical Interaction Space bindings before commands or ordinary chat Agents. Workroom and Sponsor spaces produce content-free Project Inbox or Task Input proposals; they never fall through to the ordinary chat Agent authority path.

  Add the authenticated Remote A2A callback host and the first durable outbound dispatch admission boundary. Remote dispatches preregister exact Assignment authority before transport, bind delivered remote task/context receipts before accepting callbacks, and recover crash windows without resending an already-bound dispatch. Missing or uncertain transport outcomes remain `reconcile_required` and cannot complete a Task.

  Persist each Workroom member's Assignment locality in the Catalog. Omitted routes retain the legacy local meaning; remote routes name one exact A2A endpoint and remain deterministic when several endpoint transports are enabled. Catalog/Profile/Grant authority is rechecked before either local or remote claim, so local and remote providers can coexist without first-wins or lexicographic routing.

  Replace the legacy file-backed Workroom Journal array format with content-addressed immutable v3 segments and database envelopes. The v3 schema uses an event-specific closed payload schema, stores only opaque control references beside governed payload receipts, and rejects unknown future fields before publication. Existing `.zhin/workroom-journal` data and database rows—including the blacklist-era v2 format—must be exported and migrated offline before starting this release; the runtime deliberately rejects legacy records instead of guessing their schema or silently upgrading historical `completed` work into accepted Project state.

  Replace arbitrary Effect Sponsor decision `reason` text with the closed v2 `reasonCode` contract. An exact pending-Intent resubmission first publishes a content-free, digest-bound quarantine/supersession receipt, durably replaces the legacy plaintext slot with that tombstone, and then publishes to a dedicated v2 slot. Partial migrations fail closed and resume idempotently after restart, while existing v2 records in the former slot remain replay-compatible. Human rationale must use a governed payload surface and is never persisted in the content-free decision repository.

  Require a full-scope token-bound principal plus current Catalog and P12 metadata authority for Portfolio Sponsor projections. Add the Root-authorized Data Steward/Privacy/Compliance Console plane for content-free lifecycle display, Hold review/release, subject erasure/export, retention purge, and reconciliation; identity and authority fields supplied by callers are rejected.

  Add an optional persistent `sponsorConversation` delivery view to Workroom Catalog entries. Multiple Projects may share one portfolio-level Sponsor Room address, while controls require an explicit Project id and every outbound item remains Project-scoped. The Host bootstraps the exact current Endpoint binding before the first outbound alert; queued projections revalidate current Catalog membership/binding plus the Sponsor-specific P12 channel and manifest immediately before delivery.

  Deliver content-free Portfolio lane, queue-head, grant/reclaim, budget, blocker, and fairness cards through that same governed Sponsor Room outbox. Strict Project-scoped Portfolio lane/status/budget-transfer controls use the authenticated Sponsor ingress path; a current card reply may supply the Project selector, switching Projects never rewrites a room-wide binding, and conflicting/stale explicit or reply targets are clarified without mutation.

  Keep Local Assignment recovery scans independent from long-running executors, and use one locale-independent canonical comparator throughout Workroom, Portfolio, and Data Governance authority ordering.

  Add `zhin agent legacy-runs <input>` and `zhin agent legacy-payloads <input> --kind <kind>` as offline recovery aids. Both commands read legacy data without mutating it and write create-only audit/proposal output; they never promote a legacy `completed` Run to accepted state, write a new Workroom Journal, delete embedded payloads, or perform an automatic migration. Any replacement work still requires explicit admission through the new Kernel.

- 04b861d: Route local and remote Assignment observations through the fenced Workroom Kernel CAS, add a crash-durable authenticated Remote Callback Inbox with ordered reconciliation, and remove the legacy unfenced heartbeat and execution-completion commands.
- a23d544: Add the first independent Portfolio Admission production boundary: a strict content-free Capacity Request parser and a Portfolio-only Journal repository contract with expected-sequence CAS, payload-sensitive idempotency, immutable atomic Resource Bundles, and explicit rejection of Workroom Task, Plan, Context, Memory, Artifact, Evidence, prompt, message, title, and tool-argument payloads.
- 8cddabf: Add production Workroom execution infrastructure: a durable remote-dispatch worker, a constrained local Assignment Executor, a crash-durable Profile Journal, atomic Portfolio Resource Bundle admission, and content-free materialized Disclosure Manifests backed by trusted policy and destination digests.
- dbe5081: Add the first production contracts for the remaining Workroom cutover:

  - immutable, content-digested Remote A2A Dispatch envelopes and a generation-owned outbound executor port whose receipts are observations rather than Task terminal facts;
  - a fail-closed Profile compiler for exact Capability Pack revisions and generation capability supply; and
  - an I/O-free `WorkflowPlanBuilder` that returns deterministic versioned DAG proposals without executing Agents or writing Workroom state.

- Updated dependencies [67ef8c4]
- Updated dependencies [5969c5b]
- Updated dependencies [5969c5b]
- Updated dependencies [974772e]
- Updated dependencies [5969c5b]
- Updated dependencies [5969c5b]
- Updated dependencies [2f786bd]
- Updated dependencies [1312ca0]
  - @zhin.js/plugin-runtime@1.1.7
  - @zhin.js/im-contract@1.0.4
  - @zhin.js/core@1.5.12
  - @zhin.js/ai@1.5.6
  - @zhin.js/agent-feature@1.0.12
  - @zhin.js/mcp-feature@1.0.12
  - @zhin.js/permission@1.0.3
  - @zhin.js/skill@1.0.12
  - @zhin.js/tool@1.0.12

## 1.1.13

### Patch Changes

- @zhin.js/core@1.5.11

## 1.1.12

### Patch Changes

- Updated dependencies [0b8b5bd]
  - @zhin.js/ai@1.5.5
  - @zhin.js/core@1.5.10

## 1.1.11

### Patch Changes

- Updated dependencies [d3920e9]
  - @zhin.js/core@1.5.10
  - @zhin.js/agent-feature@1.0.11
  - @zhin.js/mcp-feature@1.0.11
  - @zhin.js/skill@1.0.11
  - @zhin.js/tool@1.0.11

## 1.1.10

### Patch Changes

- e4757a8: fix: bump
- c3c0ebf: fix: jiagouyouhau
- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/core@1.5.9
  - @zhin.js/tool@1.0.10
  - @zhin.js/ai@1.5.4
  - @zhin.js/agent-feature@1.0.10
  - @zhin.js/mcp-feature@1.0.10
  - @zhin.js/skill@1.0.10

## 1.1.9

### Patch Changes

- 63253bb: Restrict Root consumers to the read-only `SnapshotReader` lease interface and
  remove public `RootRuntime.controller` access. Generation commit, transaction,
  close, and stop authority now remain inside the Root lifecycle.

  Close Root admission when rollback cleanup or retired-generation disposal can
  no longer prove lifecycle integrity. Existing leases may drain, but new
  operations and generation transactions fail closed until the Process Host
  stops the Root.

  Bind externally driven capability resources to lifecycle-owned generation admission gates.
  Adapter candidates can establish Endpoint connections during readiness while their IM ingress
  remains invisible; snapshot commit atomically retires the old ingress and publishes the new one,
  without closing the old Endpoint before the transaction succeeds.
  Admitted HTTP, WebSocket, IM, isolated-RPC, Endpoint control, and Endpoint management operations
  now retain their exact generation until settlement instead of escaping with a live object.

  Remove inert unconfigured Endpoints and deferred soft-start. Configured Endpoint creation,
  connection readiness, and local admission are required generation prerequisites; any failure
  disposes the complete candidate set and leaves the previous generation serving traffic.

  Move the HTTP listener to Process Host ownership. Generation scopes now receive only an
  `HttpHost` routing port (without `listen`/`close` authority), and HTTP/WS registrations are tagged
  with generation admission so candidate routes cannot shadow committed routes before publish.

  Remove the fallible post-commit `openNext` phase and all pre-commit old-generation
  quiesce/resume hooks. Handoff now performs candidate readiness and reversible candidate cleanup
  only; the previous generation remains untouched until the single synchronous snapshot/admission
  publish point, then drains through its existing leases.
  Candidate setup, Feature projection, Endpoint readiness, MCP connection, isolation activation,
  database activation, and config commit now receive the Root transaction `AbortSignal`; Root Stop
  fails closed and awaits candidate cancellation cleanup.

- 6fb24dd: Replace the concrete `AIService` and `ZhinAgent` escape hatches on `AgentHostPort`
  with a canonical protocol port that lists immutable Agent bindings and executes
  `TurnRequest`s. `AgentRuntime` selections now require the immutable binding for
  the turn so provider/model state remains isolated across concurrent requests.

  Route A2A tasks through the canonical Agent runtime without synthetic IM
  messages or shared `agent.configure()` mutation. A2A callers now enter as a
  fail-closed `user` principal, cancellation propagates through the turn
  `AbortSignal`, and task completion continues to project through the A2A event
  bus.

- d162216: Replace Message-shaped session management with canonical session-key interfaces.
  `ZhinAgent.archiveSession`, `ZhinAgent.compactSession`, and the session-tree
  helpers now accept a stable session key instead of a synthetic IM Message.

  Route Plugin Runtime transcript recording, passive group context, management
  commands, and Owner approval through immutable Turn access/address data. Owner
  approval persistence now has one origin-neutral implementation shared by the
  canonical command path and the remaining classic policy adapter. Ordinary IM
  turns no longer construct a synthetic Message; that projection is isolated to
  configured collaboration Cell orchestration.

- 7427818: Route scheduled and preview Agent work through the generation-owned canonical Turn ingress and the single full Agent core. Remove the synthetic IM Message schedule path, legacy schedule-context execution branch, and duplicated schedule tool-security wrapper.

  Add a typed direct capability-resolution event and explicit canonical Shell preset authority. Schedule execution is stateless, fail-closed, journaled, budgeted, audited, and uses the same capability policy/runtime as other canonical turns.

- 90da255: Remove the unreachable classic Plugin bootstrap, process-global authoring registration, and the parallel HTTP Agent session runtime. Agent setup is now owned exclusively by the Plugin Runtime composition root, authoring capabilities are published only through generation projections, and transport approval must be supplied explicitly through `ApprovalPort`.

  Also remove the classic proactive-dispatch factory and stop `AIService` standalone agents from fabricating an authenticated IM message. Standalone execution without an authenticated IM origin now carries no message authority and therefore remains fail-closed under tool policy.

  BREAKING CHANGE: `initAgentModule`, `createAgentSessionHostPort`, `HttpAgentSessionStore`, `FileHttpSessionPersistence`, `HttpStepProjector`, `HttpApprovalWaiter`, `createProactiveOutboundService`, `registerPluginAgentSurfaces`, and related HTTP-session types are removed. Protocol hosts must execute canonical `TurnRequest` values through the generation-owned `AgentHostPort`; proactive delivery must be implemented by the generation-owned IM runtime.

- 953cfe1: Remove the obsolete Collaboration Scene/Cell domain after Agent coordination
  moved to the Orchestration Kernel. This deletes `/collab`, the initialization
  wizard, Scene identity and membership repositories, archived Cell pipeline
  state, seven Collaboration database tables, and their public exports.

  The top-level `collaboration` configuration key is no longer accepted and now
  fails schema validation. Agent startup is selected only by `ai` or `assistant`.

  Keep the optional Five-Agent workflow as an independent Agent module with
  `FiveAgentRole`, role binding, and role capability policy interfaces. It no
  longer depends on IM scenes, Bot membership, or text handback conventions.

  Remove `StructuredOutboundDetectInput.collaborationCell`; structured outbound
  selection is based only on tool, handoff, and Adapter capability requirements.

- 0e73866: Remove the classic Message-based Collaboration Cell execution seam. IM now
  serves only as canonical turn ingress and reply delivery; Agent-to-Agent work is
  executed by the Orchestration Kernel through `local` Agent bindings or
  `remote_mesh` A2A agents.

  Remove peer mention routing, synthetic Message bridging, Cell prompt injection,
  IM projection executors, `internal_room`, and the dead Collaboration outbound
  parser APIs. Orchestration executor and persisted source parsing now fail closed
  for removed legacy shapes instead of silently changing execution domains.

  `AITriggerConfig.peerMode` and the public `internal_room` / `im_projection`
  executor variants are removed. Local task `assignedTo` values now name an Agent
  binding; remote tasks name an A2A Agent.

- Updated dependencies [63253bb]
- Updated dependencies [7427818]
- Updated dependencies [953cfe1]
- Updated dependencies [0e73866]
  - @zhin.js/plugin-runtime@1.1.6
  - @zhin.js/core@1.5.8
  - @zhin.js/mcp-feature@1.0.9
  - @zhin.js/tool@1.0.9
  - @zhin.js/ai@1.5.3
  - @zhin.js/agent-feature@1.0.9
  - @zhin.js/permission@1.0.2
  - @zhin.js/skill@1.0.9

## 1.1.8

### Patch Changes

- Updated dependencies [36cb1ca]
  - @zhin.js/core@1.5.7

## 1.1.7

### Patch Changes

- 7945544: fix(command): 修复 CommandSession.sender.role 缺失 master/trusted 及平台群角色

  `resolveRoles` / `resolveSender` 现在从 IM Message 的 `$sender` 读取 `isMaster`、`isTrusted` enrich 快照和平台 `role` 字段，
  而非仅依赖 duck typing 接口的 `sender` 和 `metadata`。

  fix(agent): 启动时自动清理旧版 agent_sessions 表的 NOT NULL IM 地址列

  旧版 `agent_sessions` 包含 `platform`、`endpoint_id`、`scene_id`、`scene_type`、`bot_id` 五个 NOT NULL 列（origin-neutral 重构前），
  新 model 不再包含这些列，但 `CREATE TABLE IF NOT EXISTS` 不修改已有表结构，导致 INSERT 因缺失 NOT NULL 值而失败。
  新增 `dropLegacyAgentSessionImColumns()` 在启动时检测并通过 `ALTER TABLE DROP COLUMN`（SQLite ≥ 3.35.0）自动移除。

  - @zhin.js/core@1.5.6

## 1.1.6

### Patch Changes

- @zhin.js/core@1.5.5

## 1.1.5

### Patch Changes

- 6f9c366: Make the full Agent Core origin-neutral by removing legacy IM Message and Plugin
  lifecycle dependencies from model execution, compaction, and tool hooks. Tool
  security remains exclusively owned by the required per-turn
  `ToolExecutionAuthority`.
- 373a56b: Make the full Agent Core depend on one required ToolExecutionAuthority. Policy, approval, journal, cancellation, and execution now remain behind a turn-owned adapter, allowing canonical TurnToolRuntime execution without a second Agent loop or duplicate approval path.
- 0de46a8: 删除进程级 `AgentRuntimeRegistry` 与按 Endpoint 复制 `ZhinAgent` 的运行时子图。

  Plugin Runtime 现在只有一个 generation-owned Agent 权威；协作任务通过显式 binding 在该 Agent 的 SubAgent 系统中执行，不再通过 Endpoint key 查找或隐式回退到另一个可变 Agent 实例。持久化就绪状态也只提交给当前 generation 的 Agent。

  Console 的 Agent 工具、MCP、会话树、Assistant 与 Orchestration 端口统一从其正在观察的 `RuntimeSnapshot` 根资源读取 `agentHostToken`，不再拼接多个“最新 generation”全局 store。相应移除公开的 registry/bootstrap API。

  Console Host 的 Agent runtime 接口改为 lease-bound `acquireAgentRuntime`；所有异步 Session、Assistant 与 Orchestration 操作在完成前持有 generation lease，避免 HMR 中途销毁正在使用的旧代资源。

- b08f7fe: refactor(agent): migrate global registries to generation-scoped stores

  Replace module-level global singletons with createGenerationStore across
  orchestration, schedule, session-tree, typing-indicator, assistant,
  collaboration, and memory-entry registries. Pattern changes from
  set*/register* to provide\* with lifecycle-bound disposal. AgentDispatcher
  is now owned by OrchestrationKernel instead of a global singleton.
  AIService removes chat/chatStream/ask methods (use completeText).
  New spawn-delegation module detects async vs sync spawn_task results.
  KeyedMutex utility added for per-key async serialization.

- daffd4c: 建立 generation-owned Agent Turn 基建并删除第二工具注册权威。

  - Tool capability 统一由 `tools/*.ts` 或 `context.addTool()` 写入候选 generation，并在 commit 后通过唯一 `ToolIndex` 发布；删除 experimental `agentToolsHostToken`。
  - Tool execution context 现必须携带 Turn AbortSignal、trace/turn/session identity 与 principal；生产工具执行等待真实 settlement 后再释放 generation lease。
  - 新增 durable Turn Journal 与 crash-safe File Journal Store，按 sequence 原子发布、跨实例拒绝 stale writer，并保留可 replay 的 terminal facts。
  - MCP 外部工具调用改走固定 snapshot 的 canonical Tool ingress、统一审批/Journal/取消链；删除 `allowApprovalTools` 绕过开关。
  - ApprovalPort 现在必须消费所属 Turn 的 AbortSignal，取消审批等待时 fail closed。

  BREAKING CHANGE: `ToolIndex.execute()` 新增必需的 invocation context；`JournalStore.append()` 新增 expected previous sequence；MCP 删除 `allowApprovalTools`；`agentToolsHostToken` 不再导出，条件式工具改用 `context.addTool()`。

- 36c7400: Replace `AgentPromptBuildContext.commMessage` with an authenticated platform projection and make Agent prompt assembly consume canonical Turn identity. Platform contributors and prompt hooks no longer receive a classic IM `Message`.

  Remove the unused Message field and active-context escape hatch from PromptController; turn scheduling is keyed only by canonical session identity.

- a9fa72e: Make Context System builders and injectors consume canonical Turn identity rather than Core IM `Message`. Schedule context is now selected explicitly from the Turn origin, uses a native Schedule session/principal projection, and fails closed when the job identity is absent.
- c8de3ef: Replace Home Assistant's legacy `ZhinTool` and IM `Message` execution boundary with native generation-owned Agent Tool definitions. Home authorization now consumes the authenticated canonical tool principal, and the CLI publishes Home tools only through the Tool Feature projection.

  Configured Agent and Home candidate initialization now fail closed instead of publishing a generation with the requested capability silently absent.

- 60f0fc8: Route production IM Agent turns through the Root-owned `AgentRuntime` and the
  generation-owned full `AgentTurnEngine`. Add canonical deferred capability
  loading for projected tools and skills, keep policy/audit execution under the
  turn authority, and remove the production `ZhinAgent.processTurn` bridge.
- 574c990: Replace Message-based passive group context APIs with canonical session/principal observations, remove the deprecated append API, and make TurnIngress session preparation drain passive context by its fixed session identity.
- d096f16: Replace schedule management tools' legacy `ZhinTool` and IM `Message` boundary with native Agent Tool definitions and canonical invocation identity. Schedule creation now derives creator and delivery target from the authenticated tool principal and origin.

  Remove the process-global Schedule manager registry. Every generated Schedule Tool set closes over its own generation manager, preventing in-flight old-generation turns from crossing into a newer engine.

- 3f29623: Require every Tool invocation to carry immutable permission, unattended, and network policy into `ToolExecutionContext`. Tool transports can now enforce the exact fixed-Turn authority at each side-effect boundary without process-global execution context.
- 2916852: Make canonical invocation origin and principal display identity part of every
  Tool execution context. IM, HTTP, A2A, Schedule, Internal, and MCP callers now
  carry structured origin data through ToolIndex instead of requiring tools to
  read a legacy IM Message side channel.
- d047869: Make the canonical Turn Tool Runtime enforce file and Bash policy before execution. File writes, sensitive reads, unsafe shell commands, shell mutations, and shell reads of sensitive paths now use the shared policy facade and fail closed from authenticated Turn principal roles.
- 162fa34: Publish `ask_user` as a generation-owned ToolFeature backed by a Root-owned, origin-neutral InteractionRouter.

  Tool execution now receives an optional turn-scoped QuestionPort. The IM composition root binds that port to the canonical session and authenticated sender, and ImRuntime can claim pending interaction replies before middleware, commands, or Agent fallback. Invalid replies use the current message's delivery authority; the router never retains an expired Runtime Message or Adapter handle. Missing interactive authority, ambiguous sessions, delivery failures, cancellation, and Root shutdown fail closed.

  BREAKING CHANGE: canonical Agent turns no longer rely on Plugin Prompt middleware or mutable global ask-user registries for `ask_user`. Ingress adapters that support interactive questions must provide a QuestionPort; unattended turns cannot expose one.

- e62561e: Replace Message-based inbound media resolution with canonical `TurnMedia` processing. IM segment fallback and platform references are projected only by the ingress adapter before media materialization, transcription, and model injection.
- 3eeeb46: Add explicit, fail-closed network authority to canonical Turn policy. Web tools and Bash network commands are denied unless the Turn grants network access; URL-bearing operations enforce absolute URLs, HTTPS constraints, SSRF protection, and domain allowlists before execution.
- 85d0f82: Require an explicit immutable Agent prompt profile for interactive and Schedule Turns. Prompt assembly no longer discovers Schedule mode from ambient storage or borrows synthetic IM platform/session fields, and the unused fast-path prompt API has been removed.
- 61bfc1c: Fail closed on Agent session and context persistence failures. Database errors now surface as typed `PersistenceUnavailableError` instead of being reinterpreted as Not Found, empty history, or successful metadata writes.

  Make `ContextRepository` the sole Agent session archive authority and remove the duplicate Store archive command that previously reported false after a successful archive.

- 04bad47: Fail closed when a required tool execution fact cannot be written to the Turn
  Journal. Journal integrity failures now abort the model loop and return the
  stable `turn_journal_commit_failed` outcome instead of becoming tool output.
- e40b048: Require generation leases at the IM ingress route instead of exposing a bare
  snapshot. Snapshot leases are store-owned, expose their active state, and can
  be rejected when presented to an Agent Runtime attached to another Root.

  Project configured MCP clients into the generation lifecycle. Configured
  servers must become ready during candidate activation; activation failure is
  fail-closed and leaves the previous generation serving traffic. Agent bindings
  filter the MCP servers visible to a turn, and MCP tools use owner-qualified
  `${qualifiedServer}__${tool}` names with fail-closed approval metadata.

- 5a5b1bb: Resolve the complete Agent Turn engine from the fixed generation snapshot instead of capturing a constructor callback. `AgentRuntime` now fails closed when the active generation does not provide `agentTurnEngineToken`.
- f1708c3: 将彩票 Agent 工具迁入正式 `tools/*.ts` ToolFeature 约定目录。

  删除已移除的 `AgentToolsHost` 动态注册桥与 `agent/runtime-tools` 中间层；工具现在由 Plugin Runtime 在候选 generation 中发现，并由标准 prepack 构建器生成可发布的 JavaScript 入口。

  Agent capability catalog 现在发布全树、owner-qualified 的 Tool identity（例如 `lottery__history`），避免子插件工具不可见及跨 owner 同名碰撞；执行边界会运行 Zod-like `safeParse` schema，非法输入在进入工具前 fail-closed。

  Lottery 的 Tool、Command、pipeline 与 outbound 全部从 owner capability runtime 读取资源；删除进程级 DB、Agent deps、push 注册表和 fallback，多实例与跨 generation 执行因此保持隔离。插件将 `zod` 声明为真实运行时依赖，保证 ToolFeature 在不安装 Agent 的合法部署中也可被发现。

  Tool approval 的 `on-risk` 语义现在完整贯穿 Core transport 与 Agent approval gate，不再在 Plugin Runtime capability 投影中丢失。

- d254a81: Publish the built-in file capability family as native, generation-owned ToolFeatures on the canonical IM Turn path.

  File execution now requires explicit Turn workspace authority. The shared policy facade canonicalizes existing targets, symlinks, and missing write targets before checking workspace containment and sensitive paths, then passes that exact authorized input to the executor. Missing authority, home-relative paths, directory escape, and symlink escape fail closed. Native read, write, edit, list, glob, and grep tools consume ToolExecutionContext and AbortSignal directly; glob and grep no longer spawn shell commands.

  BREAKING CHANGE: `runTurnToolPolicies` is asynchronous and successful/approval decisions carry the authorized input. `createRuntimeTurnRequest` requires `workspaceRoot`, and canonical file tools no longer permit paths outside that workspace.

- 7123c47: Publish `web_fetch` and `web_search` as native generation-owned ToolFeatures on the canonical IM Turn path.

  Both tools now use one Turn-scoped network module that authorizes every redirect hop, rejects non-public DNS results, pins the socket connection to the reviewed address while preserving HTTPS SNI and Host, enforces cancellation, timeout, redirect, and response-size limits, and records transport policy rejection as a canonical denied tool event. Interactive IM turns receive HTTPS authority only from the explicit `network` execution preset.

  BREAKING CHANGE: the canonical web tools no longer consume ambient AsyncLocalStorage network policy or automatic fetch redirects. Deployments must explicitly select the `network` preset, and non-public or non-HTTPS targets fail closed.

- 05befc1: Make Agent session persistence origin-neutral. `agent_sessions` now stores only Agent session identity and lifecycle metadata; IM platform, endpoint, and scene fields remain exclusively in the IM transcript/session projection. HTTP, A2A, Schedule, and internal Turns can open Agent sessions without fabricating IM identities.
- 0663b6a: Make the public Turn Context Envelope consume canonical Turn origin, principal, and session data instead of IM `Message`. IM metadata is now validated and projected only by the ingress adapter, while Schedule, HTTP, A2A, and internal Turns describe their native origins without fabricated platform fields.
- f28f9b3: Remove ambient mutable Schedule state from the Agent turn context. Schedule authority now flows explicitly through the existing Context, Prompt, and Tool pipelines, while Schedule feedback events publish their job identity directly from TaskExecutor instead of mirroring it through legacy plugin-event ALS.
- 9f340f7: Delete the classic Plugin/Message-based `ask_user` implementation and its global pending-session middleware.

  Interactive clarification now has one authority: the generation-owned `ask_user` ToolFeature and turn-scoped QuestionPort. Security approval remains a separate, explicit ApprovalPort and fails closed when the ingress does not provide one. AIService no longer accepts a Plugin to inject interactive tools, classic built-in aggregation no longer publishes `ask_user`, and post-tool owner prompting no longer bypasses the approval boundary.

  BREAKING CHANGE: `AskUserBuiltinTool`, `AskUserSessionService`, `createAskUserTool`, `AIService.setPlugin`, `ImApprovalAdapter`, `SessionInteractionPort`, and owner hard-orchestration exports are removed. Hosts must provide QuestionPort for ordinary questions and ApprovalPort for security decisions.

- e53444f: refactor!: 架构债第二轮（asPrivate 零强转、窄接口域拆分、JSX 全局冲突根治、测试面真迁移）

  - **agent**：`asPrivate` 强转彻底去除——门面类与 `ZhinAgentPrivate` 全量对齐，编译期校验恢复；接口按域拆窄（`AgentSessionHost` / `AgentContextHost` / `AgentTurnLifecycleHost` / `AgentEmitterHost`）；`HostPromptController.schedule` 伪泛型修正（toolCalls 收紧为 `ToolCallRecord[]`）；零调用门面成员删除。
  - **core + satori**：两处全局 `JSX.Element` 声明改为模块作用域 `export namespace JSX`（语义不同的两套 JSX 模型不再互斥），`zhin.js/jsx-runtime` 类型前转补齐；examples components 回归 type-check 编译面。
  - **ai**：OpenAI wire 类型（`ChatCompletionRequest/Response/Choice`、`ToolDefinition`/`ChatToolDefinition`）与 **`ContentPart` 本体及全部 shim**（`processMultimodal`、`normalizeContentPartsToPayloads`、`summarizeContentParts`、`prepareMultimodalBlocks`、`createInboundTurnPipeline` 兼容门面）从公共面彻底删除——agent 测试 mock 已迁 ai-sdk 原生面（`wireMockLlmApi` 直注册 ai-sdk stream，断言面收敛到 AgentMessage 层）；`ChatMessage.content` 收窄为 `string`；891 行死沙箱 `sandbox-enhanced.ts` 连文件删除；init 镜像入口的 `as unknown as` 强转消除。

  BREAKING CHANGE：上述公共导出收窄项；JSX 全局命名空间不再由 `@zhin.js/core`/`@zhin.js/satori` 提供（经 jsxImportSource 的消费链不受影响）。

- 5eedd26: Publish `todo_read` and `todo_write` as native generation-owned ToolFeatures backed by a session-addressed, crash-safe TodoStore.

  The canonical session key is now the only TODO identity. Storage filenames are hashes, replacements are serialized and atomically renamed, aborted writes are never published, and model input cannot select a chat identifier or filesystem path. `.zhin/` is now runtime-private state and generic file tools cannot read or enumerate journals, TODO documents, or other authority-owned files.

  BREAKING CHANGE: `todo_read` and `todo_write` no longer accept `chat_id`; TODO state is isolated by the canonical Turn session and moved to `.zhin/todos`.

- 92b0dd7: refactor: complete plugin dual-track elimination (Slices 3–4)

  Remove all `getHostRootPlugin()` call sites (30+ occurrences across security,
  collaboration, media, memory, prompt, and orchestrator modules); dead branches
  collapse to defaults/fallbacks. Expand harness to ban `getHostRootPlugin()` in
  all packages.

  Stub `initAgentModule()` and `registerAI()` as throwing — the Plugin Runtime
  (`zhin runtime start`) is the sole entry path; `basic/cli` assembles the Agent
  stack directly.

  Mark `PluginBase.provide()` / `.inject()` as `@deprecated @internal`; the
  service bus is superseded by Scope + Token (introduced in Slice 2).

  Simplify `host-plugin-registry.ts` to minimal no-op signatures. Move
  `AIServiceRefs` type to `internal/` so live collaboration/orchestrator code
  no longer depends on dead `init/` modules.

  Clean `setHostRootPlugin` / `getHostRootPlugin` mocks from 8 test files;
  update agent README to remove `initAgentModule` usage examples.

- f919b6f: Add one Turn Event source module that owns concurrent worker-to-stream bridging,
  exactly-once terminal emission, error mapping, and worker settlement. Reuse it
  from the existing streaming turn path so future IM ingress adapters do not
  reimplement event queues or release generation leases while work is active.

  Agent surface diagnostics now include root `tools/` convention entries as well
  as `agent/tools/`, matching Plugin Runtime discovery.

- 098e411: Schedule the canonical Agent `TurnEvent` stream through `PromptController` and
  persist synthesized failure, cancellation, and missing-terminal facts before
  returning a `TurnOutcome`.
- e1b7c01: Commit the durable Agent terminal before conversation, session, metrics, and IM
  reply projections. Projection failures are isolated diagnostics and cannot
  rewrite the committed `TurnOutcome`.
- 9b94f87: Replace Message-keyed deferred tool state with a turn-owned deferred controller. Deferred meta tools are now created by the Agent turn, concurrent turns and subagents receive isolated state, and the legacy WeakMap binding API has been removed.
- a7df753: refactor!: Wave 2 架构债清理（ContentPart 终结 + 死面清剿 + agent 结构收敛）

  **AI 层**

  - `preprocessInboundMedia` / `buildSubagentInboundTask` 入参收窄为 canonical 单形态（ContentPart union 臂删除）。
  - 删除死面：`INBOUND_MEDIA_PARTS_EXTRA_KEY`、`userMessageToFilterText`、tool-policy `always/once/never` 别名、ContentPart `face` 变体、`describeVisionPartsAsText`；`processMultimodal` 等公网 shim 标 `@deprecated`（下个大版本删除）。
  - 测试桥归位：`createOpenAiCompletionsStreamFn` 及 wire 转换器移出公共 API（入 agent 测试目录）；`openai-bridge` 只剩 `assistantText`；`legacy-tool-bridge.ts` 正名 `tool-bridge.ts`。
  - 类型修复：`ModelApi = 'ai-sdk' | (string & {})`；`AgentTool.execute` 与实现对齐为三参（删 `as` 强转）。

  **core 层**

  - 死导出整批删除（均零引用）：`AITool`、撞名 `ToolDefinition`、`NoticeType/RequestType`、Interactive 别名全簇、`PermissionService`/`ConfigService` 别名、`getLiveEndpoint`、`qrcode-segment` 整文件；热路径不再自用 deprecated 别名（`resolveInteractiveSegments` 删除，改 `resolveKeyboardSegments`）。
  - im-contract 双 legacy 格式化函数二合一（`formatLegacyMessageRef` 为唯一公开 API）；ai-outbound 的 legacy `kind` 回退分支删除。

  **agent 层**

  - `ZhinAgentPrivate` 58 → 43 成员：死成员/零读取成员删除，deferred 族收敛为 `DeferredTurnState` 模块，三份手工镜像改为权威接口 Pick，`readonly` 名不副实纠偏，AutoContinueHost 单参化。
  - 4 个值导入循环解环（纯函数下沉 collab-utils / ask-user-format / memory-layers）；prompt 双轨收敛（3 个零调用导出 + 死分支删除）；死文件删除；`sandbox-enhanced` 挂 `@deprecated` 摘出公共导出；`tokenUsageToLegacy` 合一、`AGENT_ROLE_CONFIGS` 拆表。

  BREAKING CHANGE：上述删除项均为公共导出面的收窄，详见各条。

- Updated dependencies [c106ecc]
- Updated dependencies [b0f37ae]
- Updated dependencies [c50aca3]
- Updated dependencies [daffd4c]
- Updated dependencies [36c7400]
- Updated dependencies [3f29623]
- Updated dependencies [2916852]
- Updated dependencies [162fa34]
- Updated dependencies [61bfc1c]
- Updated dependencies [e40b048]
- Updated dependencies [f1708c3]
- Updated dependencies [d254a81]
- Updated dependencies [05befc1]
- Updated dependencies [e53444f]
- Updated dependencies [92b0dd7]
- Updated dependencies [a7df753]
  - @zhin.js/permission@1.0.1
  - @zhin.js/im-contract@1.0.3
  - @zhin.js/plugin-runtime@1.1.5
  - @zhin.js/core@1.5.4
  - @zhin.js/ai@1.5.2
  - @zhin.js/tool@1.0.8
  - @zhin.js/mcp-feature@1.0.8
  - @zhin.js/kernel@1.0.7
  - @zhin.js/agent-feature@1.0.8
  - @zhin.js/skill@1.0.8

## 1.1.4

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/logger@1.0.76
  - @zhin.js/schedule@0.0.5
  - @zhin.js/agent-feature@1.0.7
  - @zhin.js/ai@1.5.1
  - @zhin.js/core@1.5.3
  - @zhin.js/kernel@1.0.6
  - @zhin.js/mcp-feature@1.0.7
  - @zhin.js/plugin-runtime@1.1.4
  - @zhin.js/skill@1.0.7
  - @zhin.js/tool@1.0.7

## 1.1.3

### Patch Changes

- 2e41ad5: fix: agent 优化
- Updated dependencies [afc0e66]
  - @zhin.js/core@1.5.2
  - @zhin.js/plugin-runtime@1.1.3
  - @zhin.js/agent-feature@1.0.6
  - @zhin.js/mcp-feature@1.0.6
  - @zhin.js/skill@1.0.6
  - @zhin.js/tool@1.0.6

## 1.1.2

### Patch Changes

- 696ab1b: fix(agent): subagent 延迟加载工具执行报 "Unknown tool" + 父会话 snapshot 污染

  子 Agent / standalone loop 此前只有静态工具集：`load_tool` 报"加载成功"（写 snapshot）但 executor 找不到新加载的工具，模型反复重试空耗 token（实测 15 轮 77s 无法识别图片）。修复：

  - standalone loop 接入与主 loop 相同的延迟加载机制：`load_tool` 命中后从 catalog 并入完整工具、重建 schema 并补全一轮（`refreshTools` + `shouldRecompleteAfterTool`）。
  - deferred runtime 增加 AsyncLocalStorage 隔离通道：子 loop 的 snapshot 从父会话克隆（可见父已加载工具），但其 `load_tool` 变更只活在本 loop，不再写父会话 snapshot。

## 1.1.1

### Patch Changes

- Updated dependencies [c8f4d45]
  - @zhin.js/plugin-runtime@1.1.2
  - @zhin.js/agent-feature@1.0.5
  - @zhin.js/core@1.5.1
  - @zhin.js/mcp-feature@1.0.5
  - @zhin.js/skill@1.0.5
  - @zhin.js/tool@1.0.5

## 1.1.0

### Minor Changes

- 5b94d9c: refactor!: 清除 AI 双栈残留（BREAKING，无兼容层）

  - **删除 legacy 直连 HTTP Provider 栈**：`@zhin.js/ai` 的 `providers/` 目录（OpenAI/Anthropic/Ollama/DeepSeek/Google/Cloudflare/Zhipu/Moonshot 及 openai-sse/base）整体移除。生产 provider 实例早已统一经 `createSdkProviderAdapter`（AI SDK 传输）创建，旧栈为零调用死代码；Provider 类与 `OpenAIConfig` 等配置类型导出同步删除。图像生成走 `SdkProviderAdapter.generateImage`（ai-sdk-image 桥）。
  - **删除已死的 collaboration 入站管线**：`createInboundTurnPipeline` 及其 enrich/route/execute/outbound-stage、`registerAiTrigger`、`extractMediaParts`（旧 `$content` 形状读取）、`processMultimodalTurn` 主实现。`ZhinAgent.processMultimodal` 保留为薄 shim（委托 canonical 路径）；`createInboundTurnPipeline` 保留薄门面（内部走 `agent.process`）。
  - **媒体面统一到 canonical MediaRef**：新增 `normalizeMediaRefsToPayloads`（url fetch / path 读盘 / base64 直取 / 大小预检），orchestrator（bootstrap-executors）、subagent-inbound、analyze-media-tool 全部改吃 canonical refs；`payloadToVisionPart` 产出 `MediaContentBlock`；`normalizeMatchRules` 拆分为独立模块 `routing/match-rules`（行为不变）。

  迁移：若仍从 `@zhin.js/ai` import 具体 Provider 类（如 `OpenAIProvider`），改为配置驱动（`ai.providers` + `createSdkProviderAdapter`）。

### Patch Changes

- 4fbff5d: feat!: 多模态双向 Segment 一贯制（BREAKING，无兼容层）

  全框架唯一媒体表达统一为 canonical `Segment` + `MediaRef{kind: url|path|base64|file, value, mime_type?, file_name?, size?}`，新增 audio/video/file 段类型；所有第二形状（legacy `data.url/file/base64` 字段、`mediaRefFromLegacyData`/`mediaRefToLegacyFields` 桥、双写）全部删除。

  - **core**：`SendContent` 一等支持 `Segment[]`；endpoint 出站载荷只含 canonical 段；`resolveOutboundMediaPolicy` 改为纯声明驱动（adapter definition `segments.outboundMedia`），内置策略表删除，未声明回退 `url-or-text`；`ImageContent` 旧桥删除。
  - **ai**：新增 `MediaContentBlock`/`MediaBlockRef`（Segment 同构）与 `UserMessage.media`（当前 turn 媒体，**不持久化**——存储层自动剥离）；`createUserMessage(text, media?)` 签名变更（`ImageContent` 删除）；provider 边界序列化器 `filterMediaBlocksForProvider` + 能力表（缺省 image-only，不支持类型降级占位文本）；ai-sdk 桥媒体块 → SDK image/file parts。
  - **agent**：入站 turn 注入（`turn/inbound-media.ts`）——commMessage 媒体段 → 当前 turn `UserMessage.media`；图片 path 物化、音频默认 STT（`@zhin.js/speech` 可选，失败降级占位）、视频/文件占位；`publishOutboundElements` 产出 canonical Segment；`transcribeAudioPayload` 导出。
  - **cli**：`bridgeRuntimeMessage` 回复链路媒体段透传，不再压平为文本（`$reply` 直达 normalize → adapter）。
  - **全部 20 个平台适配器**：出站媒体只消费 `data.media`（url 直发 / base64 直发 / 平台上传 / 读盘），入站媒体产出 canonical `data.media`；`segments.outboundMedia` 声明与实际消费逐一核对修正；QQ 入站新增 canonical segments（image/audio/video/file/mention/face/reply），图片/语音/视频不再丢失。

  迁移：适配器/插件产媒体一律用 `{ type, data: { media: MediaRef } }`；发送 legacy `data.url/file/base64` 形状的段会被 warn 丢弃。

- Updated dependencies [1f23bf6]
- Updated dependencies [4fbff5d]
- Updated dependencies [5b94d9c]
  - @zhin.js/ai@1.5.0
  - @zhin.js/core@1.5.0

## 1.0.10

### Patch Changes

- Updated dependencies [d8bf702]
  - @zhin.js/ai@1.4.8
  - @zhin.js/core@1.4.3

## 1.0.9

### Patch Changes

- Updated dependencies [45b3256]
  - @zhin.js/core@1.4.3

## 1.0.8

### Patch Changes

- f346346: fix: 未配置 outputSchema 时不再对 AI SDK `result.output` 做 JSON.stringify，避免 IM 回复出现整段双引号与字面量 `\n`（#590）；出站侧额外解开误包的 JSON 字符串层
- Updated dependencies [f346346]
  - @zhin.js/ai@1.4.7
  - @zhin.js/core@1.4.2

## 1.0.7

### Patch Changes

- @zhin.js/agent-feature@1.0.4
- @zhin.js/mcp-feature@1.0.4
- @zhin.js/skill@1.0.4
- @zhin.js/tool@1.0.4
- @zhin.js/core@1.4.2

## 1.0.6

### Patch Changes

- cdf64e7: 多方向审计修复批（8 面 30+ bug）：

  - **安全**：钉钉 webhook 验签绕过修复（缺 timestamp/sign 一律 403 + ±1h 防重放）；exec-policy fail-closed（换行/`$(`/反引号拒绝、管道逐段过白名单、env dump 复合拆段）；wecom 验签改 timingSafeEqual；config:set 拒绝 `__proto__` 等魔术键、host 键优先防覆写。
  - **P0 功能**：`zhin packages` scoped 包名解析为空导致 rm -rf 风险；命令数字参数解析失败炸断消息链路（dispatch 捕获 continue）；TaskQueue 监听器首个事件自摘除导致 assistant 队列挂死（+超时后完成不覆盖终态）；DatabaseHost 跨世代共享崩溃（define 幂等 + stop 改进程级）；rss 按不存在 id 列删除改业务键。
  - **Runtime/HMR**：native watcher 过滤忽略目录（lib/.zhin 不再触发重载风暴）；host 段配置 patch（http.port 等）存在 installResources 时全量重建；capability 目录非 entry 支持文件升级进程重启；documentTransaction 失败回滚。
  - **CLI 写侧**：config/setup 对 toml 静默假成功改统一 config-file（不支持格式报错）；doctor/onboard 默认配置改新形态 plugins 映射；schedule add 改 --prompt；migrate engines/中文模板误伤/覆盖前备份。
  - **适配器生命周期**：napcat/milky start 失败竞态与僵尸连接、心跳 close 清理、stop-during-connect settle；slack webhook 二次 writeHead + messageChannelMap LRU。
  - **Host/向导**：logs/stats 与 inbox 查询改 DB 侧 count/orderBy/limit 下推；save-yaml 写入前校验；zhipu/moonshot baseUrl 必填预填；.env 写入转义 + 幂等合并；setup 数据库密码不再明文落 config；60s fetch 超时与 JSON 守卫。

- 2d0a159: 审计尾账清零（P2 批）：

  - Runtime：reload 前重读配置文档消除陈旧快照；组合式根 schema 显式报错（不再静默空 view）；ConfigPatch 支持数组数字索引（`endpoints.0.url`）；console 配置读写单一数据源 + 写入串行化；watch tick 防重叠 + fetch 超时。
  - Host/MCP：MCP client stop 成功才标记 + handoff 补 quiescePrevious/resumePrevious（独占端口不再新旧并存）；readJsonBody 超限保留连接回 413；dispatchHttp 统一 HttpBodyError 状态码；inbox endpoint 名仅命中才缓存；create_plugin 工具生成物改 definePlugin 新格式。
  - Agent：CapabilityIngress 按 projection 归属记账（key 振荡不再泄漏/误 purge）；敏感目录 `data` 锚定工作区根（src/data 不再误伤）；passive-group-buffer 死 key 清扫；tool scopes 数组校验。
  - 插件：blackjack 终局「回复 1」复活（getLatestForUser）；60s apiBase 改运行时求值（弃 process.env）；rss \_db lifecycle 清理；group-suite flush 不丢计数 + checkin 串行化防双签；milky SSE start 失败复位。
  - 工具链：applyAdaptersToConfig 改合并（重跑 wizard 不丢手工 endpoint）；html-renderer 提示识别 plugins 映射；create-zhin CLI 项目名校验 + task XML/NSSM 修复；setup --ai 补 @zhin.js/tool；layout 发现支持 .ts。

- 5691aba: 第二轮全量审计修复批（8 面 ~60 bug）：

  - **安全**：email 附件路径穿越修复（basename + downloadPath 约束）；lark/telegram/satori webhook 鉴权（缺密钥告警、timingSafeEqual、±5min 时效窗、chat_type 修正）；onebot wss/webhook 缺 token 告警；qq webhook 改原始字节验签；renderJsx/JSX 转义注入修复；console runtime token 401 死循环。
  - **P0 功能**：sandbox 多 endpoint 解析 + WS 路径隔离；short-url expand（undici opaqueredirect）改 follow；AI 压缩摘要失败不再静默丢历史（熔断恢复生效）；console-ui 实时推送事件名归一化 + IndexedDB schema 对齐；process-monitor 热重载不再误判崩溃。
  - **生命周期**：email IMAP 断线重连 + 在飞锁；onebot11/12 start 失败清理；line replyToken TTL + push 兜底；wechat-mp token 过期重试 + MsgId 去重；weixin-ilink buf 推进/防抖写盘/媒体 TTL/QR abort；satori PONG 看门狗；退避自毁修复。
  - **游戏**：text-adventure 终局 restart 复活 + requires 服务端校验；tic-tac-toe PvP 占用/restart/队列清理/TTL；idiom-chain/word-riddle 闲聊不扣失误；别名中间件不劫持普通聊天。
  - **共享库**：schema falsy 默认值/date/tuple/union 修复；database parseCondition Date/未知操作符、sqlite TEXT 往返、query 分派、belongsToMany 方言、migration dry-run；schedule DST 回拨死循环、重复 id 去重、flush 串行化；game-kit fallback 编号/onboarding 提示/尾缀边界/活引用拷贝。
  - **渲染语音**：fetch 全部超时 + 渲染并发闸；sanitizeHtml form 保文本；STT 扩展名映射 + 删临时文件；TTS 未知 provider 报错；emojiCache LRU 负缓存/fontCache style/clearFonts 恢复；register 错误分类收窄。

- 078e3f7: 架构统一批（AURA）：

  - **EndpointLifecycle 基座**（@zhin.js/adapter 新增 `createEndpointLifecycle`）：WS/SSE 端点的 start 失败复位、仅曾 open 才退避重连（指数+jitter 可配）、stop 不重连、PONG 看门狗、定时器集中清理、陈旧事件防叠套；napcat/milky/onebot11/onebot12/satori 已迁移（删除各自手写状态机），从此同类竞态在结构上不可能再犯。
  - **Generation-store**（@zhin.js/plugin-runtime 新增 `createGenerationStore`）：模块级运行时状态的一等能力，provide 自动挂 lifecycle 反注册（代际结束自动清理）；lottery deps 与 rss db 已迁移，公开 API 兼容。
  - **Resolver 管线收敛**（@zhin.js/runtime）：解析规则统一为 local path → workspace → node_modules 单管线；optional 引用对所有 PackageResolutionError 容错（消除 message 前缀补丁）。
  - **工具目录准入统一**（@zhin.js/agent）：RegisteredToolSource 与 ExternalToolSource 共用同一 `canAccessTool` 准入（platforms/scopes/permissions/hidden 四元组全链路透传），同名覆盖 warn；AgentToolRegistration 补 platforms/scopes。两条注册通道（静态约定 vs 动态注册）职责边界已文档化。

- 3e925d0: 删除 legacy 插件包 `@zhin.js/host-api` 与 `@zhin.js/host-router`（legacy `usePlugin` 插件栈下线）：

  - **包删除**：`@zhin.js/host-api`、`@zhin.js/host-router` 从仓库移除，后续版本不再发布。Console / HTTP Host 由 `@zhin.js/cli`（composition root）用 `@zhin.js/host-http` + `@zhin.js/pagemanager` 自动装配，用户无需、也不能再安装这两个插件。
  - **zhin.js**：移除对 host-api / host-router 的 optional peer 依赖；`shutdown.ts` 不再动态导入 host-api 的 `stopSseHub`（SSE Hub 生命周期由 CLI 装配层管理）。
  - **@zhin.js/mcp / @zhin.js/a2a**：移除对 host-router 的 peer 依赖；legacy `usePlugin` 入口改为本地结构类型（运行时走 `./runtime` 子路径，由 CLI 经 host-http 装配，行为不变）。
  - **@zhin.js/cli**：`config check` / `doctor` / `setup` 不再检查或写入 host 插件；全局实例（~/.zhin）脚手架不再声明 host-api / host-router。
  - **@zhin.js/scaffold-wizard**：移除 `CONSOLE_HOST_PLUGINS` 导出与 `ConsoleConfigDiagnosis.missingHostPlugins` 字段；`zhin-stack-deps` 不再含 host 包；`stack-versions.generated.json` 同步移除。
  - **@zhin.js/agent**：稳定性监控移除 host-api SSE 订阅数采集（`collectStabilityMetrics` 不再支持 `includeSse`，快照不再有 `sseSubscribers`）。

- Updated dependencies [cdf64e7]
- Updated dependencies [2d0a159]
- Updated dependencies [5691aba]
- Updated dependencies [078e3f7]
- Updated dependencies [f0ec5ab]
- Updated dependencies [fa66c4c]
- Updated dependencies [fa66c4c]
- Updated dependencies [6cb6152]
  - @zhin.js/plugin-runtime@1.1.1
  - @zhin.js/tool@1.0.3
  - @zhin.js/mcp-feature@1.0.3
  - @zhin.js/ai@1.4.6
  - @zhin.js/schedule@0.0.4
  - @zhin.js/core@1.4.1
  - @zhin.js/agent-feature@1.0.3
  - @zhin.js/skill@1.0.3
  - @zhin.js/kernel@1.0.5

## 1.0.5

### Patch Changes

- 3ea84a0: Plugin Runtime 插件 agent 工具接线：新增 `agentToolsHostToken`（generation 作用域的 Agent Tools Host），插件 `setup()` 可经闭包向 Agent Host 注册工具（桥接 zod inputSchema → JSON parameters + execute 前校验），解决 Runtime 下插件 `agent/tools` 不被发现、`lottery agent deps not initialized` 的问题。lottery 7 个 `lottery_*` 工具已按此接线（`agent/runtime-tools.ts`）；`/api/introspection/tools` 合并 agent 注册工具。
- 1ddcd70: Console/契约扫尾批：

  - adapter：多 endpoint record name 改为 entry.name（Console 展示/resolve/inbox 按名唯一命中）；`expandEndpointConfigs` 增加缺名/非法字符/重名校验与告警；slack endpoint 补 `name` getter；inbox-installer / agent-host 解析 `slot~entry` 展开 id（activity-feedback 随之恢复）。
  - host-http：`schema:get`/`config:get` 兼容 `data.plugin`；extended RPC 参数顶层与 `data` 合并（cron 写操作修复）；请求审批认 `requestId`、已读认单值 `id`；`endpoint:requests`/`inboxRequests`/`inboxNotices` 行补 camelCase/扁平别名；cron 列表补 `expression/running/plugin/nextExecution/createdAt/context`。
  - cli：装配 `setOrchestrationRuntime`/`setSessionTreeRuntime`（agent-sessions/orchestration 页恢复）；`/api/stats` 补 commands/components 计数；console REST databaseHost.started 改动态 getter；`wrapModel` 支持 orderBy/limit 链式查询；接线 SystemLog 模型 + 日志 transport（logs 页有真实数据，带 7 天/1 万条清理）。
  - plugin-runtime：`DatabaseHostModel.select` 升级为链式 `DatabaseHostSelection`；新增 `system-log`（SystemLog 表定义/写入助手）。
  - agent：导出 `asPrivate`（Runtime Host 装配 session tree runtime 用）。

- Updated dependencies [7db69c1]
- Updated dependencies [3ea84a0]
- Updated dependencies [1ddcd70]
- Updated dependencies [ac9da66]
  - @zhin.js/core@1.4.0
  - @zhin.js/plugin-runtime@1.1.0
  - @zhin.js/agent-feature@1.0.2
  - @zhin.js/mcp-feature@1.0.2
  - @zhin.js/skill@1.0.2
  - @zhin.js/tool@1.0.2

## 1.0.4

### Patch Changes

- 16ec4e8: Harden Plugin Runtime migration boundaries: make process-level registries, the game
  catalog, and game-record storage generation-owned so HMR replacement cannot unregister the
  active generation, discover workspace agents without mutating `process.cwd()`, and
  require authentication for production A2A endpoints.

  Game SessionServices and Group Suite mutable state now live in owner-scoped
  resources. Lottery database, Agent dependencies, and outbound push bindings use
  generation registrations with rollback-safe disposal.

  The Plugin Runtime Console demo scope now follows ADR 0016 and rejects project
  file, environment, and database RPCs, closing both direct and file-manager paths
  that could expose `.env` values.

- cc5c94d: 约定式插件运行时迁移（breaking）：插件与适配器由 `usePlugin()` / `extends Adapter` 迁移为 `definePlugin` / `defineAdapter` + `plugin.ts` + 约定目录（`adapters/`、`commands/`、`components/`、`tools/` 等）。

  - 新增约定式运行时包：`@zhin.js/plugin-runtime`、`@zhin.js/adapter`、`@zhin.js/runtime`、`@zhin.js/host-http`（首版 1.0.0 走 init-publish，不在本 changeset 内 bump）。
  - 全部 20 个平台适配器改为约定式 `defineAdapter`，旧 `usePlugin` / `extends Adapter` / `segment-mapper` 生产入口已删除；onebot11 反向 WSS、onebot12 webhook/wss、milky sse/webhook/wss、satori webhook、kook webhook、qq webhook/middleware 等 slice 1 推迟的连接模式已补齐。
  - 游戏 / 工具 / 服务插件同步迁移到约定目录结构。
  - CLI 增加 plugin-runtime host installer（http/database/outbound/schedule/console 等）。

  后续加固（同批）：

  - CLI：`zhin runtime start --daemon`（pidfile/崩溃拉起/风暴保护），orphan watchdog 防僵尸进程；legacy `zhin dev` / `zhin start` 已移除（含 `zhin restart`），`zhin stop` 兼容新 daemon。
  - 安全：builtin 工具统一走 `security/policy-facade.ts` 的 `runToolPolicies`（声明式策略表，deny 优先）；审计日志 close flush + 背压队列；`splitCompoundCommand` 引号感知、`extractCommandName` 去引号堵绕过。
  - 日志：Logger 双堆栈修复、本地时区、`getLogger` 挂树（`setLevel` 递归生效）、第三方库（log4js/discord）桥接、启动人读总结。
  - 结构：`plugins/games/shared` 迁为 `packages/game-kit`（`@zhin.js/game-kit`）；死目录 `plugins/adapters/common` 删除。
  - 脚手架：`create-zhin-app` / `zhin new` / scaffold-wizard 生成物改为 Plugin Runtime 形态（minimal-bot 同构，新配置格式）。
  - Console：endpoint.list 真实名称与 phase、schema:get-all 按 instanceKey 映射、db:\* 接 DatabaseHost。

  注：按仓库发布惯例（见 1bb345dd2），本次 breaking 迁移统一使用 patch，避免 zhin.js 5.0 级联。

- 447f3e2: 迁移缺口修复（legacy 功能对齐）：

  - html 段出站规范化：经 `@zhin.js/html-renderer` 渲染为 image 段（sandbox 豁免、无渲染器时降级文本），修复真实平台 `[object Object]`。
  - 群聊 @ 触发 AI：适配器入站标注 `metadata.mentioned`（icqq/qq/slack/onebot11/onebot12/napcat/milky/discord/telegram/kook/dingtalk/satori），`matchAiTrigger` 补齐 ignorePrefixes/respondToAt/respondToPrivate/keywords（默认值与 legacy 对齐）。
  - im_transcripts 全量流水恢复写入（chat_history 工具可用）；群聊旁听上下文回迁。
  - `ai.trigger.timeout/thinkingMessage/errorTemplate` 生效；masters/trusted 角色解析对齐 legacy。
  - `Message.sender` 统一为用户 ID（onebot11/12、napcat、milky 原误传显示名）；quote_id 经 metadata 接入 AI 引用上下文。

- Updated dependencies [16ec4e8]
- Updated dependencies [cc5c94d]
- Updated dependencies [447f3e2]
  - @zhin.js/core@1.3.5
  - @zhin.js/schedule@0.0.3
  - @zhin.js/logger@1.0.75
  - @zhin.js/plugin-runtime@1.0.1
  - @zhin.js/kernel@1.0.4
  - @zhin.js/ai@1.4.5
  - @zhin.js/agent-feature@1.0.1
  - @zhin.js/mcp-feature@1.0.1
  - @zhin.js/skill@1.0.1
  - @zhin.js/tool@1.0.1

## 1.0.3

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
- Updated dependencies [872c583]
  - @zhin.js/core@1.3.4
  - @zhin.js/kernel@1.0.3
  - @zhin.js/logger@1.0.74
  - @zhin.js/schedule@0.0.2
  - @zhin.js/ai@1.4.4

## 1.0.2

### Patch Changes

- 5b08052: fix: 架构优化
- 5cc9c03: fix: ai 优化
- 36d6db2: fix: agent 互联
- b9b3881: fix: 增加游戏引擎以及部分游戏
- 7700903: fix: 游戏强化
- Updated dependencies [5b08052]
- Updated dependencies [5cc9c03]
- Updated dependencies [36d6db2]
- Updated dependencies [b9b3881]
- Updated dependencies [7700903]
  - @zhin.js/kernel@1.0.2
  - @zhin.js/core@1.3.3
  - @zhin.js/logger@1.0.73
  - @zhin.js/schedule@0.0.1
  - @zhin.js/ai@1.4.3

## 1.0.1

### Patch Changes

- c4575c9: fix: 输入输出优化,文档优化
- c4575c9: Add optional peer `@zhin.js/speech`: inbound STT (`audio.strategy: transcribe` default), outbound TTS (`segment.tts` + `voice_stt`/`voice_tts` tools), TTS providers edge/openai/azure/custom. Remove `@zhin.js/plugin-voice`; use `speech:` config key instead of `voice:`.
- Updated dependencies [c4575c9]
- Updated dependencies [c4575c9]
  - @zhin.js/core@1.3.2
  - @zhin.js/ai@1.4.2
  - @zhin.js/logger@1.0.72

## 1.0.0

### Patch Changes

- chore: align stable version line to 1.0.x (no API change from 0.3.1)

## 0.3.1

### Patch Changes

- 609da24: fix: 规范安全开发
- 7dfafc2: fix: ai 提示词缓存优化
- 93e58d9: refactor: 网络策略统一、core 导出整理、Disposable 接口、Bot 图标修复

  - 新增 `security/network-policy.ts` 统一 SSRF 防护、域名匹配、网络命令检测
  - `core/index.ts` 移除死导出、统一结构
  - 新增 `Disposable` 接口替代 `as any` dispose 调用
  - `bridge.ts` MCP inputSchema 类型安全
  - 脚手架依赖版本锁定（latest → ^major.minor.0）
  - 修复 icqq/sandbox 客户端缺失 Bot 图标导入

- ae5239c: fix: 核心包瘦身
- Updated dependencies [609da24]
- Updated dependencies [7dfafc2]
- Updated dependencies [93e58d9]
- Updated dependencies [ae5239c]
  - @zhin.js/core@1.3.1
  - @zhin.js/ai@1.4.1

## 0.3.0

### Minor Changes

- db38da4: refactor: remove legacy Agent class (1199 lines), migrate ChatMessage → AgentMessage, extract plugin-context.ts

  - Delete legacy `Agent` class and its tests from `@zhin.js/ai`
  - Extract `userMessageToFilterText()` as standalone utility
  - Migrate `ChatMessage` → `AgentMessage` in prompt, session-io, task-continuation modules
  - Remove Agent-related re-exports from ai/agent/core/zhin packages
  - Extract AsyncLocalStorage + getPlugin into `plugin-context.ts` in core

### Patch Changes

- Updated dependencies [db38da4]
  - @zhin.js/ai@1.3.0
  - @zhin.js/core@1.3.0

## 0.2.1

### Patch Changes

- d8def69: fix: 性能优化
- 2ef4896: fix: 更新概念 Bot=>Endpoint,已适配后续更多的业务场景;统一角色权限
- Updated dependencies [d8def69]
- Updated dependencies [2ef4896]
  - @zhin.js/core@1.2.1
  - @zhin.js/ai@1.2.1
  - @zhin.js/logger@0.1.71

## 0.2.0

### Minor Changes

- 65f4b0a: 架构优化、类型安全提升与构建系统清理

  **kernel** (minor)

  - PluginBase.start() 提取 `mountAllContexts()` / `mountContext()` 可覆盖钩子

  **core** (minor)

  - Plugin.start() 覆盖 `mountAllContexts()` 支持 Context 挂载失败回滚
  - Plugin.stop() 委托 `super.stop()` 消除重复代码
  - Lifecycle 事件类型化：message.receive → Message, request.receive → Request, notice.receive → Notice

  **ai** (minor)

  - BaseProvider 提取 `request()` 公共方法，消除 fetch/fetchText/fetchStream 80% 重复代码
  - 修复 fetch/fetchText 的 AbortController 泄漏

  **agent** (minor)

  - 为 7 个模块级单例添加 reset() 函数支持测试隔离
  - 修复 8 处 `catch (e: any)` → `catch (e: unknown)`

  **host-api / plugins** (patch)

  - handlers-db.ts 移除 11 处 `as never` cast，修复 11 处 catch 类型标注
  - adapter-github / plugin-group-suite / plugin-rss 移除 inject() 的 `as any` cast

### Patch Changes

- e62c23a: fix: update pnpm-lock.yaml and vitest configurations- Added new dependencies for the full-bot example, including multiple Zhin.js adapters and TypeScript.- Updated the test-bot example to include '@puniyu/system-info' and other necessary packages.- Modified vitest configuration to include additional module directories for better dependency resolution.- Enhanced documentation for the KOOK adapter, including new features like typing indicators and system notifications.- Removed unused test assets and scripts from the test-bot example to streamline the project.
- Updated dependencies [65f4b0a]
- Updated dependencies [e62c23a]
  - @zhin.js/core@1.2.0
  - @zhin.js/ai@1.2.0

## 0.1.31

### Patch Changes

- d8547d2: fix: ai 串行改并行
- Updated dependencies [d8547d2]
  - @zhin.js/core@1.1.33
  - @zhin.js/ai@1.1.31

## 0.1.30

### Patch Changes

- 3735e96: fix: 智能家居控制
- 238de62: fix: 内置命令优化
- Updated dependencies [3735e96]
- Updated dependencies [238de62]
  - @zhin.js/core@1.1.32
  - @zhin.js/ai@1.1.30

## Unreleased

### Minor Changes

- **Assistant Runtime（路线 A）**：M1–M5 统一 JobStore、Event Ingress、NotificationRouter、Home Domain、Assistant Profile
  - `assistant.enabled` opt-in；`assistant-jobs.json` SSOT
  - `POST /api/assistant/events`、`GET /api/assistant/jobs`
  - `home_*` 工具、`assistant.profile.yml` Bootstrap 合并
  - `notify.channel` 多通道；`cron_add notify_channel` 参数
  - Profile `morningBrief` / `bedtimeCheck` cron routines → JobStore
  - `assistant.queue` TaskQueue（重试 / 并发 / 死信）
  - `syncSchedulerJobsFromLegacy`；assistant.enabled 时关闭 legacy Scheduler
  - `assistant.home.mcpServer` 与 `ai.mcpServers` 校验；Profile 设备别名合并
  - `CronJobContext` / `context` 已移除（破坏性）；`cron-jobs.json` / `assistant-jobs.json` 必须含 `notify`
  - `zhin cron add --notify-channel`；Console RPC `cron:add` 使用 `notify` / `notifyChannel`（默认 silent）
  - `legacyDualWrite` 默认 false

## 0.1.29

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
- a26e496: fix: 增加群旁听模式
- c8f8207: fix: 增加重启恢复会话功能
- Updated dependencies [c8f8207]
- Updated dependencies [a26e496]
  - @zhin.js/logger@0.1.70
  - @zhin.js/ai@1.1.29
  - @zhin.js/core@1.1.31

## 0.1.28

### Patch Changes

- c78d2cd: fix: cli 更新,文档更新
- Updated dependencies [c78d2cd]
  - @zhin.js/core@1.1.30
  - @zhin.js/ai@1.1.28

## 0.1.27

### Patch Changes

- Updated dependencies [90d9efd]
  - @zhin.js/logger@0.1.69
  - @zhin.js/core@1.1.29
  - @zhin.js/ai@1.1.27

## 0.1.26

### Patch Changes

- 6295cbd: fix: @优化
- 7e14f8d: fix: 统一发个版,优化一些列安全问题
- 996ebb3: fix: ai 优化
- Updated dependencies [6295cbd]
- Updated dependencies [7e14f8d]
- Updated dependencies [996ebb3]
  - @zhin.js/core@1.1.28
  - @zhin.js/logger@0.1.68
  - @zhin.js/ai@1.1.26

## 0.1.25

### Patch Changes

- b0e0a71: fix: 提示词优化,create-zhin 引导优化
  - @zhin.js/logger@0.1.67
  - @zhin.js/core@1.1.27
  - @zhin.js/ai@1.1.25

## 0.1.24

### Patch Changes

- 0db9fed: fix: deno deploy
- f19d2e0: fix: remove multiple runtime support
- 2d24338: fix: ai 优化
- Updated dependencies [0db9fed]
- Updated dependencies [f19d2e0]
- Updated dependencies [2d24338]
  - @zhin.js/core@1.1.26
  - @zhin.js/logger@0.1.66
  - @zhin.js/ai@1.1.24

## 0.1.23

### Patch Changes

- 775427e: fix: edge 支持
- Updated dependencies [775427e]
  - @zhin.js/core@1.1.25
  - @zhin.js/logger@0.1.65
  - @zhin.js/ai@1.1.23

## 0.1.22

### Patch Changes

- 32049f5: fix: init publish
- Updated dependencies [32049f5]
  - @zhin.js/logger@0.1.64
  - @zhin.js/ai@1.1.22
  - @zhin.js/core@1.1.24

## 0.1.21

### Patch Changes

- 8086ccb: fix: ai 增强/优化
- Updated dependencies [8086ccb]
  - @zhin.js/core@1.1.23
  - @zhin.js/ai@1.1.21

## 0.1.20

### Patch Changes

- 3b3e49b: fix: ask 工具修复,icqq skill 优化
  - @zhin.js/core@1.1.22
  - @zhin.js/ai@1.1.20

## 0.1.19

### Patch Changes

- 92da96d: fix skill 激活优化
  - @zhin.js/core@1.1.21
  - @zhin.js/ai@1.1.19

## 0.1.18

### Patch Changes

- 88caeb2: fix: ask user 护栏
- Updated dependencies [88caeb2]
  - @zhin.js/core@1.1.20
  - @zhin.js/ai@1.1.18

## 0.1.17

### Patch Changes

- fcad030: fix: agent ai 优化
- Updated dependencies [fcad030]
  - @zhin.js/ai@1.1.17
  - @zhin.js/core@1.1.19

## 0.1.16

### Patch Changes

- cb9fbf1: fix: ai 增强
- Updated dependencies [cb9fbf1]
  - @zhin.js/ai@1.1.16
  - @zhin.js/core@1.1.18

## Unreleased

### Changed

- 子代理默认继续使用最小工具继承（不自动继承主会话 skill/tool）；可通过 `ai.agent.subagentTools` 显式追加子代理可用工具白名单。

## 0.1.15

### Patch Changes

- Updated dependencies [efad4ef]
  - @zhin.js/ai@1.1.15
  - @zhin.js/core@1.1.17

## 0.1.14

### Patch Changes

- c9dec38: fix: ai 架构优化,文档更新
- Updated dependencies [c9dec38]
  - @zhin.js/core@1.1.16
  - @zhin.js/ai@1.1.14

## 0.1.13

### Patch Changes

- 63d0b88: fix: 定时任务优化
  - @zhin.js/core@1.1.15
  - @zhin.js/ai@1.1.13

## 0.1.12

### Patch Changes

- e28fd7c: fix: 重新发版
- Updated dependencies [e28fd7c]
  - @zhin.js/ai@1.1.12
  - @zhin.js/core@1.1.14

## 0.1.11

### Patch Changes

- 4304825: fix: 重新发版
- Updated dependencies [4304825]
  - @zhin.js/ai@1.1.11
  - @zhin.js/core@1.1.13

## 0.1.10

### Patch Changes

- Updated dependencies [d0250e8]
  - @zhin.js/core@1.1.10
  - @zhin.js/ai@1.1.10

## 0.1.9

### Patch Changes

- 0eba6d6: fix: 完善生命周期,确保生产稳定
- Updated dependencies [0eba6d6]
  - @zhin.js/core@1.1.9
  - @zhin.js/ai@1.1.9

## 0.1.8

### Patch Changes

- 9aa08c3: fix: ai 增强
- Updated dependencies [9aa08c3]
  - @zhin.js/ai@1.1.8
  - @zhin.js/core@1.1.8

## 0.1.7

### Patch Changes

- Updated dependencies [d73a3b7]
  - @zhin.js/ai@1.1.7
  - @zhin.js/core@1.1.7

## 0.1.6

### Patch Changes

- 9577eba: fix: tool 收集 bug,升级 ts 到 6.0.2
- Updated dependencies [9577eba]
  - @zhin.js/ai@1.1.6
  - @zhin.js/core@1.1.6

## 0.1.5

### Patch Changes

- ba30934: fix: web 优化
  - @zhin.js/core@1.1.5
  - @zhin.js/ai@1.1.5

## 0.1.4

### Patch Changes

- bf0dc75: fix: 幻觉优化
  - @zhin.js/core@1.1.4
  - @zhin.js/ai@1.1.4

## 0.1.3

### Patch Changes

- a257f3f: fix: 定时任务提示词优化
  - @zhin.js/core@1.1.3
  - @zhin.js/ai@1.1.3

## 0.1.2

### Patch Changes

- 5073d4c: chore: chore: update TypeScript version to ^5.9.3 across all plugins and packages
  feat: enhance ai-text-as-image output registration with off handler for cleanup
  fix: remove unnecessary logging in ensureBuiltinFontsCached function
  refactor: simplify action handlers in html-renderer tools
  chore: add README files for queue-sandbox-poc and event-delivery packages
  chore: adjust pnpm workspace configuration to exclude games directory
  chore: update tsconfig to include plugins directory for TypeScript compilation
- Updated dependencies [5073d4c]
  - @zhin.js/core@1.1.2
  - @zhin.js/ai@1.1.2

## 0.1.1

### Patch Changes

- c212bf7: fix: 适配器优化
- Updated dependencies [c212bf7]
  - @zhin.js/ai@1.1.1
  - @zhin.js/core@1.1.1

## 0.1.0

### Minor Changes

- 8280fe7: feat: ModelRegistry 模型自动发现与智能选择

  - 新增 ModelRegistry：自动发现 Provider 可用模型，Tier 评分（0-100）智能排序
  - 支持 Ollama 详细元数据（参数量、量化）和 OpenAI 兼容 API 启发式推断
  - 支持 API 聚合/中转服务的 prefix/model-name 格式（如 9router）
  - providers.models 配置现为可选 — 框架自动发现并按评分排序
  - 新增 chatModel / visionModel 配置项，留空自动选择最优模型
  - 自动模型降级：Chat / Vision / Agent 三条路径均支持失败自动切换
  - Agent 新增 modelFallbacks 配置和 chatWithFallback() 降级引擎

### Patch Changes

- Updated dependencies [8280fe7]
  - @zhin.js/core@1.1.0
  - @zhin.js/ai@1.1.0

## 0.0.20

### Patch Changes

- c606a57: fix: ask_user 优化
- Updated dependencies [c606a57]
  - @zhin.js/core@1.0.57
  - @zhin.js/ai@1.0.18

## 0.0.19

### Patch Changes

- 20ab379: fix: ai 优化
- Updated dependencies [20ab379]
  - @zhin.js/ai@1.0.17
  - @zhin.js/core@1.0.56

## 0.0.18

### Patch Changes

- 75709e1: fix: ai 强化,文档梳理
- Updated dependencies [75709e1]
  - @zhin.js/core@1.0.55
  - @zhin.js/ai@1.0.16

## 0.0.17

### Patch Changes

- 16c8f92: fix: 统一发一次版
- Updated dependencies [16c8f92]
  - @zhin.js/ai@1.0.15
  - @zhin.js/core@1.0.54

## 0.0.16

### Patch Changes

- @zhin.js/core@1.0.53
- @zhin.js/ai@1.0.14

## 0.0.15

### Patch Changes

- bb6bfa8: feat: MessageDispatcher 双轨分流（指令+AI）、出站润色管道；技能扫描含插件包 `skills/`
- Updated dependencies [bb6bfa8]
- Updated dependencies [bb6bfa8]
  - @zhin.js/core@1.0.52
  - @zhin.js/ai@1.0.13

## 0.0.14

### Patch Changes

- 607acc4: fix: 视觉模型处理
  - @zhin.js/core@1.0.51
  - @zhin.js/ai@1.0.12

## 0.0.13

### Patch Changes

- 2510365: fix: 文件安全拦截
  - @zhin.js/core@1.0.50
  - @zhin.js/ai@1.0.11

## 0.0.12

### Patch Changes

- Updated dependencies [b00b6c9]
  - @zhin.js/core@1.0.49
  - @zhin.js/ai@1.0.10

## 0.0.11

### Patch Changes

- Updated dependencies [7d09e5e]
  - @zhin.js/core@1.0.48
  - @zhin.js/ai@1.0.9

## 0.0.10

### Patch Changes

- de3e352: fix: 新增 request 和 notice 抽象,新增消息过滤支持
- Updated dependencies [de3e352]
  - @zhin.js/core@1.0.47
  - @zhin.js/ai@1.0.8

## 0.0.9

### Patch Changes

- 7394603: fix: cli 优化, windows 用户体验优化
  fix: 新增消息过滤系统
- Updated dependencies [7394603]
  - @zhin.js/ai@1.0.7
  - @zhin.js/core@1.0.46

## 0.0.8

### Patch Changes

- Updated dependencies [63b83ef]
  - @zhin.js/core@1.0.45
  - @zhin.js/ai@1.0.6

## 0.0.7

### Patch Changes

- 4f2fb55: fix: agent bug
  - @zhin.js/core@1.0.44
  - @zhin.js/ai@1.0.5

## 0.0.6

### Patch Changes

- Updated dependencies [72ec4ba]
  - @zhin.js/core@1.0.43
  - @zhin.js/ai@1.0.4

## 0.0.5

### Patch Changes

- 0999ca6: fix: 提示词优化,60s 技能优化
- Updated dependencies [0999ca6]
  - @zhin.js/ai@1.0.3
  - @zhin.js/core@1.0.42

## 0.0.4

### Patch Changes

- Updated dependencies [5a68249]
  - @zhin.js/core@1.0.41
  - @zhin.js/ai@1.0.2

## 0.0.3

### Patch Changes

- 7ef9057: fix: 架构调整优化
- Updated dependencies [7ef9057]
  - @zhin.js/core@1.0.40
  - @zhin.js/ai@1.0.1

## 0.0.2

### Patch Changes

- 04f76ac: fix: 工具命名格式优化
- Updated dependencies [04f76ac]
  - @zhin.js/core@1.0.39

## 0.0.1

### Patch Changes

- Updated dependencies [ab5c54a]
  - @zhin.js/core@1.0.38
