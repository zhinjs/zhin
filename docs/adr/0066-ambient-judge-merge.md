---
sidebar: false
---

# ADR 0066：插话判断合并——「旁听」用途与「旁听参与判断」决策合成一项，语言模型和决策模型共用一条备用链

状态：已接受（所有者授权按推荐处理，2026-11-17）。依据：zhinjs/zhin#1250 评论 6945954844，所有者原话：「这两块要不就合并为一个功能？感觉说的是同一个事」。所有者已授权「需要拍板的按推荐处理」，本文 D1–D8 均按推荐定稿。核对基线：`origin/feat/friendly-volta-ejc3wl`（`c99701eb821fe8a373342cac5a3099b9a7dfe29e`）；Console 前端核对基线：zhinjs/console `origin/main`（`97801958b90f117f9ca017acca298e77abef7d17`）。实施进度：P0–P3 都还没开始。

关联：[ADR 0047](./0047-ai-provider-subscriptions-and-decision-models.md)（Provider 图、用途、多决策模型；增补「用途备用模型」的切换条件与跳过表，含第 40 批修订）、[ADR 0037](./0037-controlled-landing-phase1-group-ops.md)（冷场计数）、[ADR 0061](./0061-inbound-message-outcomes.md)（`ambient_silent` / `not_addressed` 结局）、[ADR 0062](./0062-one-path-per-task.md) §23（插话按群开关；数据库为事实来源）、[ADR 0057](./0057-config-storage.md)（声明放 yml，运行时状态放数据库）。

## 背景

群里没人叫机器人时，要不要插话现在由两个配置项决定，两者说的是同一件事，却分别配置、互相排斥，Console 上的说明还和实际行为不一致。

### 1. 现在的两套判断（逐项核实）

| # | 现状 | 位置 |
|---|---|---|
| A1 | 用途「旁听」：存储在 `purposes.defaults.ambient`（及 `ambientFallbacks`），导入写法是 `purposes.ambient`。用聊天类语言模型判断，即 `LlmEngagementJudge`，输出 `{ engage, confidence, reason }`，`confidence` 是模型自报的 0..1 | `packages/im/agent/src/plugin-runtime/ingress/ambient-engagement.ts:66-84`；`packages/im/ai/src/provider/types.ts:85-98`；`packages/im/ai/src/provider/plan.ts:232`、`:300` |
| A2 | 决策「旁听参与判断」：`purposes.decisions.ambient`（`mode: off｜shadow｜active`、`profile`、`timeoutMs`、`minConfidence`）。用决策模型判断，即 `DecisionEngagementJudge`，对 `engage` / `stay_quiet` 二选一，输出两个选项的概率 | `ambient-engagement.ts:117-216`；`packages/im/ai/src/provider/graph.ts:148-164`；`packages/im/agent/src/plugin-runtime/decision-runtime.ts:12-39` |
| A3 | 两者互斥：决策为「启用」（`active`）时根本不解析语言模型，只用决策模型 | `packages/im/agent/src/plugin-runtime/ingress/ingress-ambient-stage.ts:71` |
| A4 | 决策为「仅评估」（`shadow`）时，用途「旁听」的语言模型才是真正作决定的主判断，决策模型只陪跑记录，与「仅评估」这个名字表达的意思相反：被评估的其实是决策模型 | `ambient-engagement.ts:228-267`（`ShadowEngagementJudge`、`createAmbientDecisionJudge`）；`ingress-ambient-stage.ts:88-107` |
| A5 | 决策模型没有备用模型：`decision:*` 用途只取一个 Profile；失败时 `DecisionEngagementJudge` 抛错，`AmbientEngagement` 直接记 `judge_failed` 并跳过，这一串消息不再判断 | `packages/im/ai/src/provider/selection.ts:33-35`；`ambient-engagement.ts:213`、`:413-414` |
| A6 | 插话的内容不是判断模型写的：判断通过后只返回原消息文本，交给普通 Agent 回合，回复由「聊天」用途（含适配器 / 账号 / 场景的聊天覆盖）写 | `ingress-ambient-stage.ts:217`；`packages/im/agent/src/plugin-runtime/ingress/ingress-venue-helpers.ts:282-299` |
| A7 | 置信度门槛有两个：`ai.trigger.ambient.minConfidence`（默认 0.7，所有判断都过这一道）和 `purposes.decisions.ambient.minConfidence`（只在决策判断器内部生效） | `ambient-engagement.ts:326`、`:416`；`:151`、`:184-187` |
| A8 | 「只记录不插话」也有两个：`ai.trigger.ambient.mode: shadow`（判断照常、结果不插话），和决策的「仅评估」（决策模型只记录） | `ambient-engagement.ts:327`、`:417`；`:261-266` |
| A9 | Console 模型页「谁在用」只看用途配置里有没有引用这个 Profile，不看是否生效：决策为「启用」时，某个模型显示「谁在用：默认旁听」，但它从来没被调用过，页面上也没有任何提示 | zhinjs/console `console-ui/src/pages/inference/model.mjs:407-469`（`profileUsages`，注释写明「不推测运行时实际调用」） |

### 2. 与需求描述不一致、或需求没提到的现状（以代码为准）

1. **两道门槛不是二选一，而是叠加**：决策为「启用」时，决策判断器先用 `purposes.decisions.ambient.minConfidence` 把「插话」改判为「不插话」（`ambient-engagement.ts:185-187`），返回后 `AmbientEngagement` 再用 `ai.trigger.ambient.minConfidence`（默认 0.7）判一次（`:416`）。实际门槛是两者中较大的那个。改判时的理由文字还写着已经不存在的旧键名 `ai.decisions.ambient.minConfidence`（`:187`）。
2. **用途「旁听」其实已经有备用链**：#1250 chat-purpose-no-fallback 给语言用途加了 `ambientFallbacks`，旁听语言模型在配置了备用时走 `resolvePurposeExecution`（`ingress-ambient-stage.ts:73-78`；`selection.ts:23-26`），按 ADR 0047 增补的规则切换。没有备用链的只是决策模型。用户文档 `docs/ai/index.md:247` 仍写「显式选定模型失败时不自动换模型」，已过时。
3. **`FallbackEngagementJudge` 没有生产调用方**：它按自己的 60 秒退避在多个判断器之间切换（`ambient-engagement.ts:86-115`），只有测试在用（`packages/im/zhin/tests/instance/agent/turn/ambient-engagement.test.ts:204-222`、`:299`）。注释里提到的 `ai.trigger.ambient.judge`（`:250`）早已退役（`packages/im/agent/src/model-runtime/validation.ts:47-50` 把它列为需要迁移的旧字段）。
4. **一致率已经在算，但没人显示**：「仅评估」时 `recordAmbientShadow` 记录两者是否一致（`packages/im/zhin/src/instance/console/assistant-status.ts:265-269`），`ambient` RPC 返回最近 24 小时的 `decisionShadow: { agreed, disagreed }`（`:293-303`），只存在进程内存里。zhinjs/console 声明了这个字段（`console-ui/src/pages/ambient-engagement-model.d.mts:10`），但页面没有显示。比较用的是两边的原始 `engage`，没有经过门槛。
5. **插话状态页显示的判断模型也会错**：`ambientModels` 始终解析语言用途 `ambient`（`packages/im/agent/src/plugin-runtime/inference/host.ts:338-356`），决策为「启用」时同样显示一个没被调用的模型；状态里的 `mode` 只看 `ai.trigger.ambient.mode`（`assistant-status.ts:296`）。
6. **「谁在用」还有两处不准**：决策用途为「关闭」时，它的 Profile 仍显示「决策：旁听参与判断」（`model.mjs:446-450`）；配置里没有 `ai.trigger.ambient` 一节时，旁听根本不运行（`ingress-ambient-stage.ts:160-162`），模型却仍显示「默认旁听」。反过来，旁听没单独选模型而继承部署聊天时（`selection.ts:25-26`），聊天模型的「谁在用」里不出现旁听。
7. **Console 插话页直接写 `ai.trigger.ambient.mode`**：「只观察」开关保存为 `mode: shadow`（zhinjs/console `console-ui/src/pages/ambient-engagement-model.mjs:140`、`:191`）。用途页把决策三态显示为「关闭 / 仅评估 / 启用」（`console-ui/src/pages/inference/Purposes.tsx:305-321`），把旁听语言用途显示为「旁听」（`:246`），把决策显示为「旁听参与判断」（`:37`）。
8. **已有的机制可以复用**：管理视图已有 `purposeEffects`，用来告诉 Console 某个用途选择「生效 / 被忽略及原因」（`packages/im/agent/src/plugin-runtime/inference/management.ts:121-136`，目前只覆盖 `purposes.agents`）；模型跳过表 `ModelAvailabilityRegistry`（`packages/im/ai/src/llm/model-fallback.ts:215`）和失败分类 `classifyProviderError`（`packages/im/ai/src/llm/provider-resilience.ts:443`）也都在。
9. **存储图的字段校验是严格的**：`normalizeProviderGraph` 遇到未知字段直接报错（`graph.ts:19-21`、`:140-142`、`:167`）。新增字段后降级到旧版本，旧版本会读不了新图，迁移必须考虑回退（见「风险」）。

## 决策

### D1：只保留一个「插话判断」，配置放在 `purposes.ambient`

1. 「旁听」用途和「旁听参与判断」决策合成一项，Console 和文档统一叫 **「插话判断」**（英文 *Interjection judge*）。它只决定**要不要说**，说什么由「聊天」用途写（A6）。
2. 这一项只有一个模型选择，语言模型和决策模型都可以选。选语言 Profile 走 `LlmEngagementJudge`，选决策 Profile 走 `DecisionEngagementJudge`。判断器按所选 Profile 的模型类型（`kinds`）分派，不看配置写在哪。
3. **导入写法（`ai.plan.yml`、Console 写入、导出）**：

   ```yaml
   purposes:
     ambient:
       profile: jev-ambient            # 主判断，语言或决策 Profile；省略时继承部署聊天的主项和备用链（现状）
       fallbacks: [deepseek-flash]     # 备用链，可以混合两类模型（D2）
       compare: gpt-mini               # 可选：对照模型，只记录、不作决定（D3）
       minConfidence: 0.7              # 唯一的门槛，0..1，默认 0.7（D4）
       mode: active                    # active：判断通过就插话；shadow：只记录、不插话（D4），默认 active
       timeoutMs: 3000                 # 决策模型成员的单次超时，默认 3000；语言模型成员不用它（D2）
   ```

   - 字符串写法 `ambient: deepseek-flash` 仍然有效，等同于 `{ profile: deepseek-flash }`，与现在的含义相同。
   - 写入这一项总是整项替换（与 0047 增补第 8 条一致）；`null` 清除整项，回到「继承部署聊天、其余取默认值」。
   - 只允许上面 6 个键，其他键报错，错误带 `path`（如 `purposes.ambient.fallbacks[1]`）。
4. **存储形状**：`PurposePolicy` 新增顶层字段 `ambient?: AmbientJudgePolicy`：

   ```ts
   interface AmbientJudgePolicy {
     readonly profile?: string;                 // language 或 decision
     readonly fallbacks?: readonly string[];    // language 或 decision，混合
     readonly compare?: string;                 // language 或 decision
     readonly minConfidence?: number;           // 0..1
     readonly mode?: 'active' | 'shadow';
     readonly timeoutMs?: number;               // 正整数，≤ 2_147_483_647
   }
   ```

   旧的 `defaults.ambient`、`defaults.ambientFallbacks`、`decisions.ambient` 由 D5 迁移后删除。
5. **为什么放在新的顶层键，而不是现有的两个位置**：
   - 不放 `purposes.decisions.ambient`：`decisions` 是「只引用决策 Profile」的用途（ADR 0047 §7 C1、C2），校验、选型前缀 `decision:`、Console 三态开关都按这一点写。把语言模型放进来，要么破坏这一约束，要么给 `decisions` 开一个例外。
   - 不放 `purposes.defaults.ambient`：`defaults` 下的值是「某个用途选哪个模型」，同级的 `chat`、`summary` 都只有模型和备用链；门槛、模式、对照模型是判断策略，混进 `defaults` 会让 `ScopedModelSelection` 的含义变杂。
   - 导入写法沿用 `purposes.ambient` 这个键：用户熟悉它，字符串写法完全兼容；只是对象写法多了策略字段。
6. 校验：`profile`、`fallbacks[i]`、`compare` 的 Profile 必须存在、可见，且模型类型是 `language` 或 `decision`（不能是 `image`）；链内不能重复，不能包含 `profile`；`compare` 不能出现在主项或备用链里。删除一个仍被引用的 Profile 报错并给出路径（与 0047 增补第 7 条一致）。
7. **继承**：没写 `profile` 时，主判断和备用链继承部署聊天（`purposes.chat` 及其 `fallbacks`），与现在一致；此时 `fallbacks` 不能单独写（没有主项的备用链没有意义，报错）。`minConfidence`、`mode`、`compare`、`timeoutMs` 可以在不写 `profile` 时单独设置。
8. **ADR 0047 的调整**：
   - `ambient` 从六类决策用途中移除（`DECISION_PURPOSES`、`DECISION_TASKS`），决策用途剩五类；废弃期内仍接受旧写法并迁移（D5）。
   - §7「LanguageModel 不冒充 DecisionModel、不合成概率」**保持不变**：两类判断器各用各的合同，语言模型不被要求输出概率，决策模型的概率也不改写；合并的是「谁来判断」这个选择，不是模型合同。
   - §7 和清单 C3「没有跨模型降级」**只对插话判断放开**：插话判断允许按 D2 换到另一类模型。其余五类决策用途不变。

### D2：备用链挂在这一项下，两类模型可以混排

1. 链 = `[profile, ...fallbacks]`，每个成员可以是语言模型或决策模型，例如「决策模型超时或失败后，由语言模型接手」。
2. **一次判断就是一次操作**。成员按顺序尝试，共用现有的整次判断预算（`JUDGE_TIMEOUT_MS = 15_000`，`ambient-engagement.ts:289`）；预算用完、调用方取消（被更新的消息顶替、generation 停止）时立即停止，不再换下一个，记 `judge_failed`。
3. **选型阶段**（尝试之前）：按 ADR 0047 增补第 5、6 条，跳过当前在跳过表里的成员（账号 + 原生模型 ID），不计入失败；语言模型成员还要满足「接得住」（输入只有文本，上下文远小于窗口，实际上几乎都满足）。全部成员都在跳过期时，记 `judge_failed`（原因 `all_unavailable`）。
4. **切换条件**（与 ADR 0047 增补第 3、6 条及第 40 批修订保持一致）：

   | 成员失败的类别 | 是否换下一个 | 是否写全局跳过表 |
   |---|---|---|
   | `quota_exhausted`、`billing`、凭据被拒的 `auth` | 换 | 写，时长按 0047 增补第 6 条（含重置提示、日配额到太平洋时间午夜等） |
   | 超时、网络错误、5xx | 换 | 只在本次判断内生效；`TIMEOUT_GLOBAL_WINDOW_MS`（2 分钟）内至少 2 次不同的判断都这样放弃同一模型时，才全局跳过 5 分钟，超时与网络 / 5xx 分开计数（同 0047） |
   | 回答无效：决策模型 `invalid_response`；语言模型输出不是合法 JSON 或缺字段 | 换 | 不写 |
   | 单纯 403、限流（非配额）、内容拦截、上下文超长 | 不换，直接 `judge_failed` | 不写 |
   | 调用方取消、整次预算用完 | 不换，直接 `judge_failed` | 不写 |

   - **「回答无效也换」是插话判断特有的**：0047 的规则面向聊天回合，回答失败的后果是用户看到错误；插话判断不向用户输出任何内容、不调用工具，换一个模型重判没有重复副作用，而回答格式是否稳定恰恰因模型而异。
   - **超时的口径**：语言模型成员内部仍由 `provider-resilience` 在同一模型上重试，它放弃的那一次才算「该成员超时 / 网络失败」（同第 40 批修订）。决策模型成员只有一次 `evaluate`，没有同模型重试，所以它的一次超时（`timeoutMs`，且不超过剩余预算）就等于「放弃」。0047 的「同一操作同一模型连续 2 次超时才换」针对的是会重试的聊天请求，这里不适用；全局跳过仍按 0047 的跨操作阈值，不会因为一个人的一次慢请求把所有群推到备用模型。
   - 决策 Driver 的错误必须能被 `classifyProviderError` 分类（P0 补齐）；分不出类别的按「网络错误」处理：换下一个，不写跳过表。
5. **每个成员只是一个模型**：语言模型成员不再在内部套 `resolvePurposeExecution` 的用途备用链（`ingress-ambient-stage.ts:73-78` 的做法改掉），只有判断器链这一层负责切换，避免两层备用叠加、重复写跳过表。
6. 没有「粘住」：每次判断都从链首开始（跳过表里的成员除外）。主判断恢复后自动用回主判断。
7. `FallbackEngagementJudge` 及其私有的 60 秒退避由新的判断器链取代：退避改由共享的跳过表负责，与聊天、摘要的备用规则一致。
8. **可观测**：
   - 每次切换写一行日志 `ambient_judge_fallback`（原 / 新 Profile、模型类型、原因），并进入模型可用性的 `recentFallbacks[]`（`GET /agent/inference` 已有，`purpose: 'ambient'`）。
   - 判断结果的 `source` 改成结构化：`{ kind: 'language' | 'decision'; profile; model; fallbackFrom? }`；日志、`ambient_decision` 审计 payload 和 `ambient_silent` 结局的 `detail` 用它（只记模型与类别，不记理由原文，与现状一致）。
   - 整条链失败时，`ambient_silent` 结局的原因仍是 `judge_failed`，`detail` 列出每个成员的失败类别。

### D3：「仅评估」改为可选的「对照模型」

1. `compare` 选一个 Profile（两类都可以）。主判断（经过备用链）照常决定；对照模型对**同一份输入**同时判一次，只记录它会怎么判，从不影响结果。
2. 对照模型没有备用链；它失败只记 `compare_failed`，不影响主判断，也不写全局跳过表（不让对照模型的故障影响别的用途）。
3. 两边都等结束再返回（沿用 `ShadowEngagementJudge` 的做法），保证对照请求不会比本次判断活得更久；对照模型的耗时计入同一个 15 秒预算，超时只算对照失败。
4. **一致率**按「经过同一门槛后是否会插话」比较：两边都套用 D4 的同一个 `minConfidence`，比较的是「会不会开口」，不是原始的 `engage`（现在的 `recordAmbientShadow` 比原始值，背景 §2.4）。只有两边都给出了结果才计入。
5. 统计口径：最近 24 小时，按主判断与对照模型分别列出：一致次数、「主判断插话、对照不插」次数、「主判断不插、对照插话」次数、对照失败次数；另附主判断由哪个成员给出（主项 / 第 N 个备用），因为备用接手时比较的对象变了。统计仍放进程内存（与现状一致）；同时在 `ambient_decision` 审计 payload 里加 `compare: 'engage' | 'quiet' | 'failed'`，需要更长时间的对比时从审计日志读。
6. `mode: shadow` 时对照模型照常运行（两边都只记录）。
7. 代价写清楚：开了对照模型，每次判断的模型调用翻倍（只发生在通过冷却、限次、判断间隔之后的那些判断上）。Console 在选择对照模型时提示这一点。

### D4：门槛和「只记录不插话」各只留一个

1. **门槛只有 `purposes.ambient.minConfidence`**（默认 0.7），在判断器链给出结果后由 `AmbientEngagement` 统一判一次。`DecisionEngagementJudge` 内部不再设门槛（去掉 `ambient-engagement.ts:184-187` 的改判）。
2. **两类模型的置信度统一为「判断器对自己给出的选择有多大把握」**，取值 0..1：
   - 语言模型：模型自报的 `confidence`，夹到 [0, 1]；不是有限数字算「回答无效」（D2，换下一个）。
   - 决策模型：所选选项的概率 `probabilities[choice]`。二选一时，选「插话」的 `confidence` 就是 P(插话)。
   - **判定规则**：`engage === true` 且 `confidence ≥ minConfidence` 才插话；选了「不插话」的结果，不管把握多大都不插话。这与现在 `AmbientEngagement` 的规则相同（`:416`），也与决策判断器内部门槛的效果相同，所以合并后对单一判断器的行为不变。
   - 不把语言模型的自报值换算成概率，也不给决策模型的概率做校准（ADR 0047 §7）：同一个 0.7 对两类模型的含义不完全一样，这一点写进文档；对照模型的统计（D3）就是用来看这个差别的。本 ADR 不提供按成员分别设门槛，确有需要另开 ADR。
   - 决策模型二选一时，选「插话」意味着 P(插话) ≥ 0.5，所以门槛低于 0.5 对决策模型等于没设；`zhin doctor` 对 `minConfidence < 0.5` 给一条提示。
3. **「只记录不插话」只有 `purposes.ambient.mode: shadow`**：判断照常运行（含备用链和对照模型），结果只记录，记为 `shadow`（Console 显示「只观察」），不插话。合并原来的 `ai.trigger.ambient.mode: shadow`（A8 前者）；原来决策的「仅评估」（A8 后者）由 D3 的对照模型取代。值沿用 `shadow`，因为日志、结局 facet（`ambient_shadow`）、Console 插话页都已用它。
4. **`ai.trigger.ambient` 只管哪些群开启和节流**：`conversations`、`quietMs`、`cooldownMs`、`maxPerHour`、`conversationWindowMs`、`judgeIntervalMs`。这些是部署声明，留在 `zhin.config.yml`（ADR 0057）；按群开关仍走功能开关（ADR 0062 §23）。`minConfidence` 和 `mode` 废弃（D5）。
5. 判断策略（模型、门槛、模式、对照）放进 Provider 图，是因为它和模型选择一起变化、一起由 Host 管理员在 Console 修改，这符合 ADR 0057「运行时状态放数据库」和 ADR 0062 R1「数据库是唯一事实来源」。

### D5：旧配置自动迁移，旧键有废弃期

1. **迁移时机**：Host 加载 Provider 图时，发现旧字段（`defaults.ambient`、`defaults.ambientFallbacks`、`decisions.ambient` 任一存在）就做一次迁移：按下表算出 `purposes.ambient`，删除旧字段，用一个 CAS 事务写回（revision + 1），同时写一条迁移记录 `{ id: 'adr-0066-ambient-judge', at, before, after, notes }`。`before` 保存迁移前完整的 `purposes`，供回退使用。此时实例会把 `zhin.config.yml` 里的 `ai.trigger.ambient.minConfidence` / `mode` 一并读入（只读文件，不改文件）。
2. **迁移规则**（记 `L` = 旧 `defaults.ambient` 及其 `ambientFallbacks`，`D` = 旧 `decisions.ambient`，`T` = yml 的 `ai.trigger.ambient`）：

   | 旧配置 | `profile` | `fallbacks` | `compare` | `minConfidence` | `mode` | `timeoutMs` |
   |---|---|---|---|---|---|---|
   | 没有 `D`，或 `D.mode = off` | `L` 的主项（没有则不写，继续继承聊天） | `L` 的备用链 | 不写 | `T.minConfidence`（没有则不写，取默认 0.7） | `T.mode`（没有则不写） | 不写 |
   | `D.mode = active` | `D.profile` | **`L` 的主项排第一**，后接 `L` 的备用链；`L` 没有单独配置（继承聊天）时为空 | 不写 | `max(T.minConfidence ?? 0.7, D.minConfidence ?? 0)` | `T.mode` | `D.timeoutMs` |
   | `D.mode = shadow`（仅评估） | `L` 的主项（没有则继续继承聊天） | `L` 的备用链 | `D.profile` | `T.minConfidence` | `T.mode` | `D.timeoutMs` |

   说明：
   - `D.mode = active` 时原来的旁听语言模型**变成第一个备用**，不能悄悄丢掉。这是唯一的行为变化：以前决策模型失败就不插话（A5），现在由这个语言模型接手。旁听继承部署聊天时**不**自动把聊天模型加成备用（那会让聊天模型多出一类调用），迁移报告里建议用户自己决定。
   - `active` 一行的门槛取两者中较大的，正好等于现在两道门槛叠加的效果（背景 §2.1），迁移后不插话的消息不会变成插话。
   - `shadow` 一行丢弃 `D.minConfidence`：它原来只影响陪跑记录，不影响插话；报告中注明。
   - `off` 一行不迁移 `D.profile`（它本来就不被调用）；报告中注明，Profile 本身不删除。
3. **迁移失败**（算出的结果校验不通过，例如引用的 Profile 已不可见、CAS 冲突重试 3 次仍失败）：不写数据库，本次 generation 在内存里按同一张表转换后运行，行为与迁移成功时相同；记一条错误日志 `ambient_judge_migration_failed`（原因、路径），`zhin doctor` 报错（✗）并给出修复办法；下次加载再试。
4. **`zhin doctor` 提示一次迁移结果**：迁移成功后的第一次 `zhin doctor` 显示一条 ℹ 记录：迁移了什么（逐行列出上表的取值与来源）、哪些值被丢弃及原因、迁移时间和回退命令；显示后在迁移记录上写 `noticedAt`，之后不再显示（`zhin doctor --verbose` 仍可查看）。实例启动时同样写一行日志 `ambient_judge_migrated`，只写一次。
5. **回退**：新增 `zhin ai purposes revert ambient-judge`：只有当 `purposes.ambient` 自迁移后没被改过（与迁移记录的 `after` 相同）时，才把 `purposes` 恢复为 `before`；否则拒绝并说明。降级到旧版本前必须先回退（见「风险」）。
6. **废弃期**：
   - **导入**（`ai.plan.yml`、Console、旧脚本写入 `purposes.decisions.ambient`）：P1 发布的那个 minor 和下一个 minor 内接受，按上表与目标图里的 `purposes.ambient` 合并转换，导入结果带警告（含路径）；之后报 `invalid-plan`，路径 `purposes.decisions.ambient`，提示改写 `purposes.ambient`。导出只写新形状。
   - **yml 的 `ai.trigger.ambient.minConfidence` / `mode`**：迁移时读入一次；之后这两个键不再生效，实例每个 generation 启动时警告一次，`zhin doctor` 警告（⚠）并可用 `zhin doctor --fix` 从配置文件删除（走现有的配置写入锁与原子写）。废弃期同上，期满后 `zhin doctor` 改为报错（✗），启动日志仍只警告、不阻止启动。Console 插话页不再写这两个键。
   - 存储图里的旧字段**一直**按上表自动迁移（迁移是一次性的，代价很小），不随废弃期结束而失效。
7. 自我变更（ADR 0040）、聊天里的 `config set ai.trigger.ambient.*`（ADR 0062）不能再写 `minConfidence` / `mode`，从可写字段名单中移除。

### D6：用途说明与文档

1. Console 用途页的说明文字：「插话判断：群里没人叫机器人时，决定要不要插话。只决定说不说，说什么由『聊天』用途写。可以选普通语言模型或决策模型（如 TypeSafe），两类可以混排成备用链。」
2. 用户文档（中英文）：`docs/ai/index.md` 的「群聊旁听」一节改为「插话」：yml 示例去掉 `minConfidence` / `mode`，「判断模型」一小节改写为插话判断（含 D2 的切换表、D4 的置信度说明，删去「显式选定模型失败时不自动换模型」）；`docs/ai/structured-decisions.md` 的用途从六类改为五类，并说明插话判断可以选决策模型；`docs/ai/provider-upgrade.md` 补废弃键；新增 `docs/migrations/ambient-judge.md`（及英文版），内容为 D5 的迁移表、回退和废弃期。
3. 代码注释同步：删去 `ai.trigger.ambient.judge`、`ai.decisions.ambient` 等旧名（背景 §2.1、§2.3）。

### D7：Console 只显示真正生效的配置

1. 本仓库：`purposeEffects`（管理视图，背景 §2.8）新增键：
   - `ambient`：`{ status: 'effective' | 'ignored', reason?, chain: [{ profile, kind }], compare? }`。`ignored` 的原因：`ambient-not-configured`（配置里没有 `ai.trigger.ambient` 一节）、`no-conversations`（没有任何群开启，且没有功能开关打开）。继承部署聊天时 `chain` 列出实际使用的聊天模型，并标 `inheritedFrom: 'chat'`。
   - `decisions.<task>`：`mode: off` 时 `{ status: 'ignored', reason: 'mode-off' }`。
2. 插话状态（`ambient` RPC）：`judges` 改为实际的判断器链（成员、类型、是否在跳过期），不再只解析语言用途（背景 §2.5）；`mode` 读 `purposes.ambient.mode`；新增 `compare`（D3 第 5 条的统计），`decisionShadow` 在废弃期内保留并填同样的数据，之后删除。
3. zhinjs/console 需要做的部分见「分阶段实施」的 P3。

### D8：不做的事

- 不按群、按适配器设置不同的插话判断模型：插话判断只有部署级的一项。按群只开关（ADR 0062 §23）。需要时另开 ADR。
- 不让判断模型直接写插话内容（A6 的分工不变）。
- 不改冷却、次数、判断间隔、对话窗口的算法和默认值。

## 被否决的备选方案

| 方案 | 否决理由 |
|---|---|
| A. 只改名字和文档，保留两套 | 互斥、两道门槛叠加、两个「只记录」、决策模型没有备用、「谁在用」显示没被调用的模型——这些都是结构问题，改名解决不了；而且「仅评估」的方向本身就是反的（A4），只能靠文档解释 |
| B. 只保留语言模型这一套，删掉决策「旁听参与判断」 | 结构化决策模型（如 TypeSafe）判断快、便宜、输出概率，是现有用户已经在用的选择；删掉会强迫他们换回语言模型，也和 ADR 0047「多决策模型」的方向相反 |
| C. 只保留决策这一套，删掉用途「旁听」 | 大多数部署没有决策模型，旁听默认继承聊天模型就能用；只留决策会让这些部署失去插话功能，而且决策模型没有备用链的问题依旧 |
| D. 把语言模型也放进 `purposes.decisions.ambient` | 破坏「`decisions` 只引用决策 Profile」的约束（ADR 0047 §7），校验、选型前缀和 Console 三态都要开例外；门槛、模式在 `decisions` 下与其他五类决策的含义也不同 |
| E. 迁移时把继承来的聊天模型自动加为备用 | 让聊天模型多出一类调用、多花额度，用户没有选过它；按「不悄悄改变」的原则，只迁移用户明确配置过的模型 |
| F. 把语言模型的自报置信度换算成概率（或给决策概率做校准）后再比较 | 需要按模型维护校准数据，ADR 0047 §7 也禁止合成概率；统一为「对自己的选择有多大把握」并用对照模型统计差别，更简单、可解释 |

## 风险

1. **行为变化**：
   - 迁移后，原来「决策启用 + 单独配置了旁听语言模型」的部署，决策模型失败时会由语言模型接手插话，而以前是不插话。这正是所有者要的效果，但用户会看到插话变多。迁移报告和 changeset 写明；不想要的话从备用链里删掉即可。
   - D2 让决策模型在超时、网络错误、5xx、回答无效时换下一个；如果备用是语言模型，插话判断的延迟和费用会变（语言模型更慢、更贵）。日志 `ambient_judge_fallback` 和 Console 的 `recentFallbacks` 可以看到切换频率。
   - 「仅评估」迁移为对照模型后，主判断不变，行为不变；一致率的口径改为「经过门槛后会不会开口」，数值会和旧的 `decisionShadow` 不同。
   - 去掉决策判断器内部门槛后，迁移表取了两者中较大的值，对单一判断器行为不变；但如果用户之后只改了一个值，就只有这一个值生效。
2. **迁移失败**：不写数据库，内存里按同一规则运行（D5 第 3 条），插话行为与迁移成功时一致；`zhin doctor` 报错并给出原因和路径，修好引用后下次加载自动重试。
3. **降级**：存储图字段校验是严格的（背景 §2.9），迁移后降级到旧版本，旧版本会因为不认识 `purposes.ambient` 而读不了整张图，所有模型调用都会失败。应对：降级前必须运行 `zhin ai purposes revert ambient-judge`（D5 第 5 条）；changeset 和迁移文档写明；迁移记录保留 `before`，即使 `purposes.ambient` 被改过，也可以人工从记录里恢复。
4. **yml 与数据库的先后**：迁移只读一次 yml。迁移之后用户在 yml 里改 `minConfidence` 不会生效，只会收到警告。启动日志和 `zhin doctor` 都会指出，Console 插话页给出「在插话判断里设置」的链接。
5. **对照模型的费用**：开了对照模型，判断调用翻倍（D3 第 7 条）；默认不开，迁移只在原来就是「仅评估」时才设置（原来就已经两边都调用，费用不变）。

## 分阶段实施

发布级别按 `.changeset/version-policy.json`：默认 patch；新增公开导出、公开类型新增字段或行为变更需要所有者批准后升 minor，批准记录写进 `approvedNonPatchReleases`。下表的「需要 minor」都需要所有者批准；本 ADR 的接受不等于批准这些 minor。

### P0：判断器统一接口和备用链（不改变配置，不改变行为）

| 项 | 内容 |
|---|---|
| 要改的文件 | `packages/im/agent/src/plugin-runtime/ingress/ambient-engagement.ts`（`EngagementJudgment.source` 结构化；新增 `EngagementJudgeChain`：按跳过表选型、按 D2 的表切换、共用 15 秒预算；新增 `createEngagementJudgeMember()` 按 Profile 的模型类型构造 `LlmEngagementJudge` / `DecisionEngagementJudge`；`FallbackEngagementJudge` 标为废弃并改为链的薄包装）；`ingress-ambient-stage.ts`（用链取代 `resolvePurposeExecution` 的嵌套备用，语言成员只用单个 Profile）；`packages/im/ai/src/llm/model-fallback.ts`（判断器链复用 `ModelAvailabilityRegistry` 的跳过与跨操作计数，`ModelFallbackEvent` 允许 `purpose: 'ambient'` 与新原因 `invalid_response`）；决策 Driver 的错误补齐 `classifyProviderError` 可识别的类别（`packages/im/ai/src/providers/` 中的决策 Driver） |
| 行为 | 链的成员仍由现有配置决定：决策「启用」时链里只有决策模型（与现在相同，失败仍是 `judge_failed`）；其他情况是语言用途的主项与 `ambientFallbacks`（与现在的切换结果相同，只是改由判断器链这一层负责）。「回答无效换下一个」此时只作用于已有的语言备用链 |
| 测试 | 新增 `packages/im/zhin/tests/instance/agent/turn/ambient-judge-chain.test.ts`（D2 表中每一类失败的换 / 不换、跳过表写入与跨操作阈值、预算用完即停、取消不换、全部在跳过期记 `all_unavailable`、决策 → 语言混排）；`ambient-engagement.test.ts`、`ambient-profile-model.test.ts` 补 `source` 结构与原有备用链结果不变；`packages/im/ai/tests` 补决策 Driver 错误分类 |
| 发布 | `@zhin.js/agent` minor（新增公开导出 `EngagementJudgeChain`、`createEngagementJudgeMember`，`EngagementJudgment.source` 类型变化）；`@zhin.js/ai` minor（`ModelFallbackReason` 新增 `invalid_response`、`ModelFallbackEvent.purpose` 新增取值，均为公开类型）。都需要所有者批准 |

### P1：配置合并和迁移（行为变更）

| 项 | 内容 |
|---|---|
| 要改的文件 | `packages/im/ai/src/provider/types.ts`（`AmbientJudgePolicy`、`PurposePolicy.ambient`；`DecisionPurpose` 去掉 `ambient`，废弃期内旧值只在迁移读路径出现）；`graph.ts`（规范化与校验 D1 第 6、7 条，带路径的错误）；`plan.ts`（导入对象写法、`null`、废弃期内转换 `purposes.decisions.ambient` 并返回警告、导出新形状）；`selection.ts`（`ambient` 用途从新字段取链与继承）；新增 `packages/im/agent/src/plugin-runtime/inference/ambient-judge-migration.ts`（D5 的迁移表、迁移记录、CAS 写回、失败时的内存转换、回退）并在图加载路径调用（`management.ts` / `host.ts`）；`packages/im/agent/src/decision/config.ts`（`DECISION_TASKS` 去掉 `ambient`）；`ingress-ambient-stage.ts`、`ambient-engagement.ts`（链、门槛、模式改读 `purposes.ambient`；`DecisionEngagementJudge` 去掉内部门槛；`AmbientEngagement` 不再读 `config.minConfidence` / `mode`）；`packages/im/ai/src/types.ts`（`AmbientEngagementConfig.minConfidence` / `mode` 标 `@deprecated`）；`packages/im/agent/src/model-runtime/validation.ts`（yml 废弃键的警告）；`packages/im/runtime/src/host-config-schema.json`（两键描述改为「已废弃」）；`packages/im/zhin/src/instance/feature-self-service.ts` 与自我变更策略（可写字段名单去掉两键）；`basic/cli/src/commands/ai.ts`（`zhin ai purposes revert ambient-judge`） |
| 测试 | `packages/im/ai/tests` 的图与 plan 测试：对象 / 字符串写法、`null`、未知键、链内重复、`compare` 在链内、image Profile、删除被引用的 Profile 报路径、无 `profile` 时写 `fallbacks` 报错、废弃期内 `decisions.ambient` 的转换与警告、期满报错；迁移测试：D5 表的每一行（含 `active` 时语言模型成为第一个备用、继承聊天时不加、门槛取较大值、`shadow` 变对照、`off` 不迁移 Profile）、CAS 冲突、校验失败时内存转换且不写库、迁移记录与 `noticedAt`、回退成功与「已改过则拒绝」；`ambient-engagement.test.ts`：门槛只判一次、`mode: shadow` 来自新字段；CLI 回退命令测试 |
| 发布 | `@zhin.js/ai` minor（公开类型 `PurposePolicy.ambient`、`AmbientJudgePolicy`，`DecisionPurpose` 变窄）；`@zhin.js/agent` minor（行为变更：决策启用时原旁听模型接手；新增导出迁移函数）；`@zhin.js/cli` minor（新增子命令）；`@zhin.js/runtime` patch（schema 描述）；`zhin.js` patch（随依赖）。changeset 写明行为变化、废弃期和「降级前先回退」。都需要所有者批准 |

### P2：对照模型和一致率

| 项 | 内容 |
|---|---|
| 要改的文件 | `ambient-engagement.ts`（`CompareEngagementJudge` 取代 `ShadowEngagementJudge`：同一输入、两边都等、套同一门槛后比较、对照失败不影响主判断）；`ingress-ambient-stage.ts`（按 `purposes.ambient.compare` 装配；`ambient_decision` 审计 payload 加 `compare`）；`ports.ts`（`AgentAssistantStatusPort.recordAmbientCompare` 取代 `recordAmbientShadow`，旧方法废弃期内保留）；`packages/im/zhin/src/instance/console/assistant-status.ts`（`AmbientStatus.compare` 统计，`decisionShadow` 废弃期内填同样数据） |
| 测试 | `ambient-engagement.test.ts`：对照模型不影响结果、失败记 `compare_failed`、一致率按门槛后比较、备用接手时按成员分开计数、`mode: shadow` 时对照照常运行；`packages/im/zhin/tests/instance/console/assistant-status.test.ts`：24 小时窗口、四类计数、`decisionShadow` 兼容；审计 payload 不含理由原文 |
| 发布 | `@zhin.js/agent` minor（端口新增方法、公开类型变化）；`zhin.js` minor（`AmbientStatus` 新增 `compare` 字段，`ambient` RPC 返回值变化）。都需要所有者批准 |

### P3：Console、doctor 和文档

| 项 | 内容 |
|---|---|
| 要改的文件 | `packages/im/agent/src/plugin-runtime/inference/management.ts`、`packages/im/agent/src/model-runtime/purpose-effect.ts`（`purposeEffects` 新增 `ambient`、`decisions.<task>` 键，`PurposeIgnoredReason` 新增 `ambient-not-configured` / `no-conversations` / `mode-off`）；`inference/host.ts`（`ambientModels` 返回实际判断器链）；`basic/cli/src/commands/doctor.ts`（迁移结果提示一次、迁移失败报错、yml 废弃键警告与 `--fix` 删除、`minConfidence < 0.5` 提示）；文档见 D6（`docs/ai/index.md`、`docs/ai/structured-decisions.md`、`docs/ai/provider-upgrade.md`、新增 `docs/migrations/ambient-judge.md`，以及对应英文版） |
| 测试 | 管理视图测试：`purposeEffects.ambient` 的生效 / 两种忽略原因 / 继承聊天、`decisions.*` 的 `mode-off`；`ambientModels` 在决策启用时返回决策模型；`basic/cli` doctor 测试：提示只出现一次、`--verbose` 可再看、`--fix` 删除两键且保留其他键、迁移失败为 ✗；文档测试（如有链接检查）通过 |
| 发布 | `@zhin.js/agent` minor（`InferencePurposeEffect` / `PurposeIgnoredReason` 公开类型扩展）；`@zhin.js/cli` patch（doctor 新检查，无新导出）。minor 需要所有者批准 |

依赖：P0 → P1 → P2；P3 依赖 P1，可与 P2 并行（`ambient` 状态里的 `compare` 依赖 P2）。P1 是主要的行为变更；P0 与 P1 最好在同一个版本里发布，避免中间版本出现「链已存在但配置还不能混排」的状态。

### zhinjs/console 仓库要做的部分

Console 前端在 zhinjs/console（ADR 0052）。本仓库提供 P1–P3 的数据，前端另开 issue：

1. **模型页「谁在用」只列真正生效的配置**：`profileUsages`（`console-ui/src/pages/inference/model.mjs:407-469`）改为结合 `purposeEffects`：被忽略的引用不列（或灰显并说明原因，如「插话未开启」「决策已关闭」）；插话判断按「插话判断」「插话判断（第 N 个备用）」「插话判断（对照）」列出；继承聊天时，在聊天模型上列「插话判断（跟随聊天）」。旧实例没有 `purposeEffects.ambient` 时保持现状。
2. **用途页把两项合成一项**：`Purposes.tsx` 去掉「旁听」（`:246`）和决策列表里的「旁听参与判断」（`:37`），新增「插话判断」一项：一个模型选择（语言和决策 Profile 都列出，按类型分组）、备用链（可混排）、对照模型、门槛、「只观察（不插话）」开关、决策模型超时；说明文字用 D6 第 1 条。
3. **显示一致率**：用途页和插话页显示「与对照模型一致 N%（共 M 次，最近 24 小时）」，并列出两种不一致的次数和对照失败次数；读 `ambient` 状态里的 `compare`，没有时回退读 `decisionShadow`。
4. **插话页**：「只观察」开关改写 `purposes.ambient.mode`，不再写 `ai.trigger.ambient.mode`（`ambient-engagement-model.mjs:140`、`:191`）；门槛输入移到插话判断；状态卡显示实际的判断器链（主项 / 备用 / 是否在跳过期）。
5. 迁移提示：用途页在迁移记录存在且 `noticedAt` 为空时显示一次「插话判断已从旧配置迁移」横幅，链接到迁移说明。

## 验收标准

1. 决策「启用」+ 单独配置了旁听语言模型 `L` 的旧配置：升级后 `purposes.ambient` 的 `profile` 是决策 Profile、`fallbacks[0]` 是 `L`，`minConfidence` 等于两道旧门槛中较大的值；决策模型超时时由 `L` 判断，日志有 `ambient_judge_fallback`。
2. 决策「仅评估」的旧配置：升级后主判断是原旁听语言模型，`compare` 是原决策 Profile，插话行为不变；Console 显示一致率。
3. 决策模型返回 429 配额用完：换到备用，并写入跳过表；返回普通 429 限流：不换，记 `judge_failed`。
4. 门槛只判一次：`DecisionEngagementJudge` 不再改判；同一份判断，语言模型和决策模型在 `engage === true && confidence ≥ minConfidence` 时才插话。
5. yml 里留着 `ai.trigger.ambient.mode: shadow`：迁移后 `purposes.ambient.mode` 为 `shadow`；之后删掉 yml 里这一行不改变行为；`zhin doctor --fix` 能删掉它。
6. 决策「启用」的部署，Console 模型页不再显示没被调用的语言模型为「默认旁听」；配置里没有 `ai.trigger.ambient` 时，插话判断的模型显示为「插话未开启」。
7. 迁移后运行 `zhin ai purposes revert ambient-judge`，图恢复为迁移前的 `purposes`；改过 `purposes.ambient` 后运行则被拒绝。
