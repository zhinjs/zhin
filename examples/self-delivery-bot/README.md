# Self-Delivery Bot (`@zhin.js/harness`)

基于 `@zhin.js/harness`（`createHarness`、`InMemoryEngagementJournal`、`writeBoard` / `readBoard`、`ask`）的自交付流水线示例（ADR 0048）。

## 协作流水线（`src/pipeline.ts`）

1. **`planner`**：接收 Issue 编号与验收标准，写入黑板 `plan`（`artifact`）与 `todo:implement`（`todo`）。
2. **`builder`**：由 `planner` 通过 `ask` 同步调用，读取黑板 `plan`，生成补丁草稿并写入黑板 `draft`（`artifact`）。
3. **`reviewer`**：由 `planner` 通过 `ask` 同步调用，读取黑板 `plan` 与 `draft`，逐条核对验收标准并写入黑板 `review`（`note`）。
4. **`planner`**：根据审阅结果将 `todo:implement` 更新为 `done`，并返回流水线汇总与 `EngagementSummary`。

## 命令与测试

- `delivery doctor`：检查自交付目录配置与就绪状态（默认 fail-closed）。
- `delivery <issue> <criteria...>`：触发指定 Issue 的自交付流水线。

```bash
pnpm --filter @zhin.js/self-delivery-bot test
```
