# full-bot L4 验收

`examples/full-bot` 为 **L4 全维度参考实例**（非 Stable 黄金路径）。自动化：`pnpm check:l4`；手工步骤如下。

## 自动化（CI / 本地）

```bash
# 仓库根
pnpm check:l4
```

覆盖：编排 E2E、语义记忆、MCP 鉴权、full-bot 配置契约、NapCat/KOOK L4 契约（实机项 `L4_SKIP_PLATFORM=1` 时 skip）；`pnpm check:orchestration-ssot` 纳入 Executor 契约与 IM 终态测试。

## Orchestration SSOT v1（手工项）

与 [ADR 0027](https://github.com/zhinjs/zhin/blob/main/docs/adr/0027-agent-run-orchestration-kernel.md) 对齐；自动化见 `pnpm check:orchestration-ssot` / `pnpm check:l4`。

### A. 终态权威（Kernel-only）

- [ ] `local` / `scene_mention` / `remote_mesh` 成功、失败、取消均落在 Kernel `completed` / `failed` / `cancelled`，无永久 `waiting_result`
- [ ] `pnpm check:orchestration-ssot` 通过

### B. IM 终态反馈（观众 #1）

- [ ] **私聊 spawn_task**（路由到非 `zhin` Agent）：Sandbox 发 `ai: <触发 vision 路由的文本>`，应收到子 Agent 文本结果
- [ ] **空 summary**：子 Agent 返回空文本时，IM 应收到固定 fallback：`任务已完成，但没有可展示的文本结果。`
- [ ] **失败**：子 Agent 抛错时，IM 应收到 `trigger.errorTemplate` 错误回复（非仅日志）
- [ ] **remote_mesh**：`executor: remote:local` 任务委托后轮询至 `completed` 或失败终态（见下文 §3）
- [ ] **（可选）群 scene_mention**：ICQQ 多 Bot 群协作时，被 @ 方公开实质回复后 Kernel `completeTask`（见 [五角色高级配方](/advanced/five-agent-recipe)）

### C. API / Console 投影（v1 = API；v1.1 = UI）

- [ ] `GET /api/agent/orchestration/runs?sessionKey=` 与 DB 一致
- [ ] `GET /api/agent/orchestration/runs/:runId` 含 tasks + events
- [ ] Remote Console「编排」页可查看 Run / Task / Event（full-bot `client/` 入口）

## 手工验收

### 1. Sandbox + Mission 编排

1. `cd examples/full-bot && cp .env.example .env && pnpm dev`
2. Remote Console 连接 Host（端口默认 `8069`），沙盒发 `ai: 启动 Mission 编排测试`
3. 主 Agent 应 `orchestration_start`；MissionRunner 自动推进 Plan 任务
4. 手动 `spawn_task` 指向 missions run 应被拒绝
5. `orchestration_status` 应显示 Mission State（phase、spec_paths）

### 2. 语义记忆

在 AI 回合中（或工具直调）：

- `memory_upsert(key=capability:hard_orchestration_v1, content=shipped)`
- `memory_search(query=hard_orchestration_v1)` 应召回 `shipped`

或激活 `memory-consolidate` skill 后让 Agent 写入。

### 3. loopback remoteAgents

配置已含 `remoteAgents[].id: local` 指向本机 `/mcp`。添加 `executor: remote:local` 任务后，应委托成功并由 `RemoteTaskPoller` 轮询至 completed（需 MCP 与主 Agent 就绪）。

### 4. MCP 鉴权

```bash
curl -s -X POST http://127.0.0.1:8069/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"agent.delegate_task","arguments":{}}}'
```

无 `Authorization: Bearer` → **401**。

带正确 Bearer → 200（或业务层错误，非 401）。

### 5.（可选实机）NapCat 或 KOOK

1. 填写 `.env` 中 `ONEBOT11_*` 或 `KOOK_TOKEN`
2. 取消 `zhin.config.yml` 对应 `endpoints` 注释
3. 群 @bot 或私聊触发 AI 回合

CI 不依赖实机；本地验证不设 `L4_SKIP_PLATFORM` 时可跑适配器 optional smoke。

## 可观测

- REST：`GET /api/agent/orchestration/runs?sessionKey=`
- Console：编排 / 会话树（与 `orchestration_status` 同源）
