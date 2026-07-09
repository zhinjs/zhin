# 对齐 pi coding-agent Harness（Compaction / 会话树 / 生态）

在 [ADR 0009](./0009-pi-aligned-ai-agent-core.md) 已完成 **pi `packages/ai` + `packages/agent`** 干净室对齐（`Context` + `stream` + `agentLoop`）之后，本 ADR 记录对 [pi `packages/coding-agent`](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) **产品层 Harness** 的借鉴边界与实现决策。

Grill 定稿摘要见本文「已定稿决策」章节（#1–#12）。

## 背景

### ADR 0009 已覆盖 vs 本 ADR 范围

| 层 | pi 包 | ADR 0009 | 本 ADR |
|----|-------|----------|--------|
| LLM 内核 | `packages/ai` | 已对齐 | — |
| 有状态 Agent | `packages/agent` | 已对齐（`prompt`/`steer`/`followUp`） | — |
| 终端 Harness | `packages/coding-agent` | 未覆盖 | **本 ADR** |

### 迁移前问题（本 ADR 要解决）

1. **Compaction 未接线**：[`compaction.ts`](../../packages/im/ai/src/compaction/compaction.ts) 库存在，但生产 `ZhinAgent` → `agentLoop` **未挂 `transformContext`**；ADR 0009 Grill #14 待落地。
2. **`/new` 归档 bug**：[`archiveSessionForContext`](../../packages/im/agent/src/zhin-agent/index.ts) 仅归档 `IMSessionStore`，未归档 `AgentSessionStore` + `ContextRepository`；epoch 重置可能失效。
3. **线性 epoch，无分支**：`agent_messages` 无 `parent_id`；无法从任意历史点 fork 或 `/tree` 跳转（pi 核心 UX）。
4. **Skills 生态偏窄**：无 `.agents/skills` 向上遍历、无 `zhin packages` 包管理；`data/skills` 与 cwd 并列发现易混淆。
5. **Plugin 与 pi ExtensionAPI 缺映射**：`ai.tool.call` 等事件已有，但 Plugin **不能**注册 `beforeToolCall` / 自定义 compaction。

### pi coding-agent 可借鉴 vs 不照搬

| pi 概念 | 借鉴方式 | 不照搬原因 |
|---------|----------|------------|
| L1 micro + L2 LLM compaction | `transformContext` + `agent_summaries` | — |
| `keepRecentTokens` 裁切 | yaml 可配置 | pi `CompactionEntry` JSONL 模型改用 DB |
| 消息级会话树 `/tree` `/fork` | `parent_id` + `active_leaf` | pi TUI 树导航 → IM 文本命令 + Console API |
| Skills + pi-packages | `zhin packages` CLI + `.agents/skills` | pi `/skill:name` → 保留 `activate_skill` |
| ExtensionAPI | Plugin `beforeToolCall` / `transformContext` | 不新加 `ExtensionAPI` 层；不做了 TUI/主题 |

### 不在本 ADR 范围

- pi 内置 sub-agents / plan mode 哲学（Zhin 保留 `spawn_task` / `run_deferred_task`）
- pi TUI 组件、主题、键盘快捷键
- pi 终端独立进程 / `--mode rpc` / 项目 `trust.json`（Zhin 以 IM 常驻 bot + sender 策略为入口）
- vendoring pi 源码或 npm 依赖 `@earendil-works/pi-coding-agent`
- IM 出站链 — 见 ADR 0004

## 决策

### D1. Compaction 生产接线

将 compaction **从遗留 `Agent.run` 路径迁移到 IM 生产 `agentLoop`**：

```typescript
// runAgentLoopTextTurn 内
transformContext: async (messages, signal) => {
  // 1. Plugin transformContext 钩子（链式）
  // 2. L1 microCompactMessages（剥旧 tool result，无 LLM）
  // 3. L2 autoCompactIfNeeded（LLM 摘要 + token 裁切）
  return compactedMessages;
}
```

**策略（对齐 pi 完整策略）**：

| 层级 | 行为 |
|------|------|
| L1 micro | 内存剥旧 tool result，不落库 |
| L2 auto | proactive：`totalTokens > contextWindow - buffer`；溢出：API overflow → compact → **重试一次** |
| 裁切单位 | **token**（`walkKeepRecentTokens`），非仅消息条数 |
| 持久化 | L2 摘要 → `ContextRepository.saveSummary` → `agent_summaries`；**不**引入 pi `CompactionEntry` 表 |

**配置**（`zhin.config.yml`）：

```yaml
ai:
  agent:
    compaction:
      enabled: true      # 总开关
      auto: true         # false 则仅手动 + 溢出恢复
      keepRecentTokens: 20000
```

**用户入口**：

- IM 命令 **`/compact`**（master / trusted）— 手动 L2
- 事件 **`ai.session.compact`** — 接线现有 stub `emitSessionCompactEvent`
- **无** pi 式 `/settings` TUI；配置走 yaml + 控制台

**实现约束**：compaction 模块改用 `AgentMessage[]` + `completeSimple`（废弃对 legacy `ChatMessage` + `AIProvider.chat` 的依赖）。

### D2. Epoch 重置修复

**保持 ADR 0009 epoch-only 语义**：`/new` 归档当前 epoch，下次 @ 创建新 `session_id`，LLM context 归零；`im_transcripts` **不归档**（`chat_history` 仍可检索）。

**修复**：`/new`、`ai.clear`、`ai_clear` 统一调用 [`archiveSessionByKey`](../../packages/im/agent/src/session/session-io.ts)（`contextRepository.archiveSession` + `agentSessionStore.archiveByKey`），**禁止**仅调 `imSessionStore.archiveByKey`。

### D3. 消息级会话树

**数据模型**（扩展 [`agent-db-models.ts`](../../packages/im/ai/src/memory/agent-db-models.ts)）：

| 表/列 | 说明 |
|-------|------|
| `agent_messages.parent_id` | nullable FK → 同 session 前驱消息 |
| `agent_sessions.active_leaf_message_id` | 当前分支叶节点 |
| `agent_summaries.branch_anchor_message_id` | 可选；branch summarization 锚点 |

**Epoch 与树的关系**：

- 每个 `session_id`（epoch）内是一棵消息树
- `/new` 归档整个 epoch（整棵树），新 epoch 从空根开始
- `/fork` 从 `active_leaf` 链上某 user 消息创建子分支
- `/tree` 列出分支点；`/tree N` 移动 `active_leaf`

**`loadContext`**：从 `active_leaf` 沿 `parent_id` 回溯到根 → 拼接 epoch summary + branch summaries + 消息链。

**Branch summarization**：切换分支时，若 abandoned 路径超 token 预算 → L2 摘要写入 `agent_summaries`（带 `branch_anchor_message_id`）。

**并行 turn**（ADR 0009 #12）：`active_leaf` 更新与 `appendMessages` 同受 [`session-write-lock`](../../packages/im/ai/src/memory/session-write-lock.ts) 保护；进行中 turn 保持切换前 `loadContext` 快照。

**Console**：本轮交付 session tree **HTTP API**（`GET .../tree`、`POST .../leaf`）；图形化 UI 后续迭代。

### D4. Skills 发现与 zhin packages

**发现路径**（修改 [`discovery/skills.ts`](../../packages/im/agent/src/discovery/skills.ts)）：

| 路径 | 动作 |
|------|------|
| `cwd/skills/` | 保留 |
| `~/.zhin/skills/` | 保留 |
| `.agents/skills/`（cwd → git root 向上遍历） | **新增** |
| plugin `skills/` | 保留 |
| `data/skills/` | **删除**（破坏性；文档与 CHANGELOG 说明迁移到 `skills/` 或 `.agents/skills/`） |

**包管理**（[`basic/cli`](../../basic/cli/README.md)）：

```bash
zhin packages install npm:@foo/zhin-tools
zhin packages install git:github.com/user/repo@v1
zhin packages list | remove | update
```

- 全局：`~/.zhin/packages/`；项目本地：`.zhin/packages/`（`-l`）
- `package.json` 增加 `zhin` manifest key；npm keyword `zhin-package`
- **保留** `install_skill` 工具（URL → `skills/`）与 `activate_skill`

### D5. Plugin 扩展（吸收 pi ExtensionAPI，不新加层）

**不**新增 `AgentExtension` / 扫描 `extensions/*.ts`；缺口以 Plugin API 补齐：

| pi ExtensionAPI | Zhin Plugin API |
|-----------------|-----------------|
| `registerTool` | `addTool`（已有） |
| `registerCommand` | `addCommand`（已有） |
| `on('tool_call')` | **`plugin.ai.beforeToolCall` / `afterToolCall`**（新增，桥接 agentLoop） |
| 自定义 compaction extension | **`plugin.ai.transformContext`**（新增，链式） |
| `on('session_compact')` | `plugin.on('ai.session.compact')`（已有事件，compaction 接线后触发） |

**本轮不做**：运行时 Plugin `registerProvider`（provider 仍 yaml 静态 + `registerProviderInstance` 初始化）。

对照表写入 [`docs/advanced/pi-coding-agent-mapping.md`](../advanced/pi-coding-agent-mapping.md)。

### D6. 实现方式：干净室 + 单 PR

- **不** vendoring pi `coding-agent` 源码
- **单 PR** 交付五块（用户 Grill #14 定稿）；建议按模块分 commit 便于 review
- 若 CI 超时，**P1 必绿**：compaction 接线 + `/new` 修复

## 后果

### 正面

- 长对话不再因未接线 compaction 而爆 context window
- `/new` 与 ADR epoch-only 语义一致
- 消息树支持 fork/回溯，对齐 pi 调试长任务能力
- Skills 与 Agent Skills 生态目录兼容；`zhin packages` 可分发技能与插件资源
- Plugin 可拦截工具与参与 compaction，无需平行 Extension 体系

### 负面 / 风险

- **DB schema 变更**：`parent_id` / `active_leaf` 需 migration；现有线性消息需兼容（`parent_id` null = 旧数据链式追加）
- **删除 `data/skills`**：现有项目需迁移目录
- **单 PR 体积大**：触碰 ai / agent / core / cli / host；review 与 CI 压力大
- **会话树 + 并行 turn**：`active_leaf` 竞态需锁与测试覆盖

## 完成定义

- [ ] `pnpm build` && `pnpm test` 全绿
- [ ] Compaction：`transformContext` 接线；溢出重试；`/compact`；`ai.session.compact` 事件
- [ ] Epoch：`/new` 双 store 归档；归档后 `loadContext` 为空
- [ ] 会话树：fork / tree 命令；`loadContext` 回溯；branch summarization 单测
- [ ] Skills：`.agents/skills` 遍历；**无** `data/skills`；`zhin packages` CLI 最小 install/list
- [ ] Plugin：`beforeToolCall` / `afterToolCall` / `transformContext` 钩子 + 单测
- [ ] [`docs/advanced/ai.md`](../advanced/ai.md) compaction / 会话树章节
- [ ] [`docs/advanced/pi-coding-agent-mapping.md`](../advanced/pi-coding-agent-mapping.md)
- [ ] [`examples/test-bot`](https://github.com/zhinjs/zhin/tree/main/examples/test-bot) 演示 `/compact`、`/tree`、`/fork`
- [ ] Changeset：minor/major bump 视 API 破坏性而定

## 与现有 ADR 的关系

| ADR | 关系 |
|-----|------|
| 0009 | 本 ADR **扩展**其 Harness 层；#14 compaction 在本 ADR D1 **落地**；#5/#15 epoch-only 在 D2/D3 保留 |
| 0003 | 工具选择与 context budget 仍 centralized；compaction 走 `transformContext` |
| 0004 | IM 出站不变 |
| 0008 | Assistant Runtime Job 执行仍调 ZhinAgent |
| 0007 | `modelHarness.maxIterations` 等与 compaction 独立；共用 `contextWindow` |

## 已定稿决策（Grill 2026-06-03，#1–#12）

| # | 问题 | 决定 |
|---|------|------|
| 1 | 对齐范围 | **五块**：Compaction、Epoch、会话树、Skills/Packages、Plugin |
| 2 | Compaction 触发 | **L1 micro + L2 LLM + proactive + 溢出恢复** |
| 3 | 裁切与持久化 | **token 制**（`keepRecentTokens` 默认 20k）+ **`agent_summaries`**；不引入 `CompactionEntry` |
| 4 | 手动压缩 | **`/compact` + yaml 开关 + `ai.session.compact` 事件** |
| 5 | Epoch 重置 | **修双 store 归档**；语义保持 epoch-only；`im_transcripts` 不归档 |
| 6 | 会话分支 | **完整消息级树**（`parent_id` + `active_leaf`） |
| 7 | 树数据模型 | **消息级 `parent_id`**，非 session 级 fork 图 |
| 8 | 树导航 | **IM `/tree` 文本 + branch summarization + Console API 预留** |
| 9 | Skills/Packages | **`.agents/skills` 向上遍历 + `zhin packages` CLI**；**删除 `data/skills` 发现** |
| 10 | Extension 层 | **不新加**；吸收进 Plugin |
| 11 | Plugin 缺口 | **`before/afterToolCall` + `transformContext` 钩子** + 文档映射 |
| 12 | 交付 | **单 PR**（按模块分 commit） |

## 状态

- **提议日期**：2026-06-03
- **Grill 定稿**：2026-06-03（#1–#12）
- **状态**：已接受，**待实现**
