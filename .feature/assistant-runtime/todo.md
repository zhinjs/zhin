# Assistant Runtime — 待办跟踪

**状态：路线 A 已闭环**（HA 实机验收单独跟踪）

详细说明见 [assistant-runtime.md](../../docs/architecture/assistant-runtime.md)。

---

## M0 — 文档与契约 ✅

- [x] ADR 0008、架构路线图、todo/plan、文档索引

---

## M1 — 统一 JobStore ✅

- [x] JobStore / JobScheduler / JobWorker / TaskQueue 接入
- [x] 迁移、CLI、测试、CHANGELOG

---

## M2 — Event Ingress ✅

- [x] POST /api/assistant/events、鉴权、文档、dogfood

---

## M3 — NotificationRouter ✅

- [x] 多通道 notify、defaults、task-executor 委托

---

## M4 — Home Domain ✅（代码）

- [x] REST + home_* 工具 + policy + 文档
- [x] Profile `devices` 别名合并 + MCP 通道校验（`home-mcp-bridge.ts`）
- [x] **HA 实机 dogfood**（2026-06-25）：见 [assistant-home-setup.md](../../docs/advanced/assistant-home-setup.md)、`examples/life-assistant-bot/ACCEPTANCE.md`（#483）

---

## M5 — Assistant Profile ✅

- [x] schema / loader / heartbeat + 早报 + 睡前巡检 routines
- [x] create-zhin 示例、test-bot、文档、测试

---

## 横切 ✅

- [x] `assistant.enabled` 默认 false
- [x] 失败 notify、GET /api/assistant/jobs
- [x] `pnpm check:architecture` assistant 反向依赖检查
- [x] CHANGELOG

---

## 个人部署 Dogfood ✅（非 HA）

- [x] test-bot assistant + profile + 早报/睡前 Job（profile 同步至 JobStore）
- [x] Event Ingress、defaults.notify ICQQ
- [x] 客厅灯 alias（profile `devices`，待 HA 启用后生效）

---

## 后续能力 ✅（路线 A 范围内已交付）

- [x] TaskQueue 重试 / 死信 / 并发（`assistant.queue`，JobWorker → `enqueueAndWait`）
- [x] scheduler-jobs.json 迁入 JobStore（`syncSchedulerJobsFromLegacy`；assistant.enabled 时关闭 legacy Scheduler）
- [x] `assistant.home.mcpServer` 与 `ai.mcpServers` 对齐校验
- [x] 移除 `CronJobContext` / `context`（破坏性）；Job 必须带 `notify`

---

## 延后（非本路线阻塞）

| 项 | 说明 |
|----|------|
| HA 实机 dogfood | ✅ 2026-06-25（#483）；REST 主路径 |
| HA 纯 MCP 模式（无 REST） | 需 Agent binding + MCP Server，REST 仍为主路径 |
