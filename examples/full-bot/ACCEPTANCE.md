# full-bot L4 验收

`examples/full-bot` 为 **L4 全维度参考实例**（非 Stable 黄金路径）。自动化：`pnpm check:l4`；手工步骤如下。

## 自动化（CI / 本地）

```bash
# 仓库根
pnpm check:l4
```

覆盖：Workroom Kernel、语义记忆、MCP 鉴权、full-bot 配置契约、NapCat/KOOK L4 契约（实机项 `L4_SKIP_PLATFORM=1` 时 skip）；`pnpm check:workroom-ssot` 验证 Journal/CAS 唯一权威。

## Workroom SSOT v1（手工项）

与 [ADR 0027](https://github.com/zhinjs/zhin/blob/main/docs/adr/0027-agent-run-orchestration-kernel.md) 对齐；自动化见 `pnpm check:workroom-ssot` / `pnpm check:l4`。

### A. 状态权威（Kernel-only）

- [ ] local Assignment 的 progress、执行完成、失败与取消均成为 Workroom Journal event；`execution_completed` 不等于 `accepted`
- [x] `pnpm check:workroom-ssot` 通过

### B. IM 终态反馈（观众 #1）

- [ ] **私聊 spawn_task**（路由到非 `zhin` Agent）：Sandbox 发 `ai: <触发 vision 路由的文本>`，应收到子 Agent 文本结果
- [ ] **空 summary**：子 Agent 返回空文本时，IM 应收到固定 fallback：`任务已完成，但没有可展示的文本结果。`
- [ ] **失败**：子 Agent 抛错时，IM 应收到 `trigger.errorTemplate` 错误回复（非仅日志）
- [ ] **Remote A2A**：尚未进入生产路径；接入后必须复用相同 Assignment lease/fence/report 契约，不恢复旧 poller

### C. API / Console 投影（v1 = API；v1.1 = UI）

- [ ] `GET /api/agent/workroom/runs?projectId=` 与 Journal replay 一致
- [ ] `GET /api/agent/workroom/runs/:runId` 含 tasks + assignments
- [ ] Remote Console「Workroom」页可查看 Run / Task / Assignment（`pages/workroom.tsx`）

## 手工验收

### 1. Sandbox + Workroom boundary

1. `cd examples/full-bot && cp .env.example .env && pnpm dev`
2. Remote Console 连接 Host（端口默认 `8069`），确认 Workroom 查询必须提供显式 `projectId`
3. 普通 Agent 工具目录不得出现通用 Workroom transition 工具
4. 普通 `spawn_task` 不应创建或修改 Workroom Run
5. 未配置 Database Host 时文件 Journal 回归通过；显式数据库激活失败时候选 generation 必须失败

### 2. 语义记忆

在 AI 回合中（或工具直调）：

- `memory_upsert(key=capability:workroom_kernel_v1, content=shipped)`
- `memory_search(query=workroom_kernel_v1)` 应召回 `shipped`

或激活 `memory-consolidate` skill 后让 Agent 写入。

### 3. MCP 与 A2A 鉴权

MCP 工具（非 Agent Mesh）：

```bash
curl -s -X POST http://127.0.0.1:8069/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

无 `Authorization: Bearer` → **401**（非 localhost 宽松时）。

A2A Agent Card：

```bash
curl -s http://127.0.0.1:8069/a2a/zhin/.well-known/agent-card.json \
  -H "Authorization: Bearer ${HTTP_TOKEN}"
```

无 Bearer → **401**（配置了 `http.token` 时）。

### 4.（可选实机）NapCat 或 KOOK

1. 填写 `.env` 中 `ONEBOT11_*` 或 `KOOK_TOKEN`
2. 取消 `zhin.config.yml` 对应 `endpoints` 注释
3. 群 @bot 或私聊触发 AI 回合

CI 不依赖实机；本地验证不设 `L4_SKIP_PLATFORM` 时可跑适配器 optional smoke。

## 可观测

- REST：`GET /api/agent/workroom/runs?projectId=`
- Console：Workroom Journal 只读投影 / 会话树
