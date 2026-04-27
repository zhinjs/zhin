# Agent 系统提示词 — 上下文块契约与 Debug 形状

对应 `packages/agent/src/zhin-agent/prompt.ts` 中 **§1–§10** 分段架构（与文件头注释一致）。

## 块顺序（稳定段 → 动态段）

| ID（debug） | 章节 | 稳定性 | 说明 |
|-------------|------|--------|------|
| `§1_identity_environment` | Identity & Environment | 每轮重建 | persona、CWD、Node、时区、内存文件提示 |
| `§2_system` | System | 固定模板 | 输出格式、注入警惕、压缩提示 |
| `§3_doing_tasks` | Doing tasks | 固定模板 | 工具优先、安全编码 |
| `§4_action_safety` | Action safety | 固定模板 | 只读/破坏性分界、ask_user |
| `§5_tools` | Tools | 固定模板 | 专用工具优先、并行调用 |
| `§6_style` | Style | 固定模板 | 简洁、语言跟随 |
| `§7_skills` | Available Skills | **动态** | 有技能 XML 或 registry 时出现 |
| `§8_active_skills` | Active Skills | **动态** | 已激活技能上下文 |
| `§9_memory` | Memory | **动态** | 文件记忆 MEMORY.md / 当日笔记 |
| `§10_bootstrap` | Bootstrap | **动态** | 额外注入 |

块之间使用 `SECTION_SEP`（`packages/agent/src/zhin-agent/config.ts` 导出）拼接。

## 用户消息与历史

- 多轮历史由 **`buildUserMessageWithHistory`** 包装，内含 **`HISTORY_CONTEXT_MARKER`** 与 **`CURRENT_MESSAGE_MARKER`**（`config.ts`），与上述系统段分离；不计入上表 § 编号，但在 token 预算中占用显著比例。

## Debug 导出（运行时）

调用 **`describePromptSectionsForDebug(ctx)`**（`prompt.ts` 导出，`@zhin.js/agent` re-export）得到非空段的 `{ id, approxChars }[]`，用于：

- 观测「渐进披露」下各段体积；
- 对照业界经验（上下文过长时质量下降），做日志或排障，**不**改变默认 prompt 语义。

## Tier 映射（Harness 上下文架构）

| Tier | 本仓库载体 |
|------|------------|
| 1 常驻 | `AGENTS.md` + 本文 + [im-queue-outbound-invariants.md](./im-queue-outbound-invariants.md) |
| 2 按需 | `docs/architecture-overview.md`、`docs/architecture/*` |
| 3 深读 | 具体包内源码、`docs/advanced/*` |
