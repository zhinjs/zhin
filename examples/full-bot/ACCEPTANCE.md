# full-bot L4 验收

`examples/full-bot` 为 **L4 全维度参考实例**（非 Stable 黄金路径）。自动化：`pnpm check:l4`；手工步骤如下。

## 自动化（CI / 本地）

```bash
# 仓库根
pnpm check:l4
```

覆盖：编排 E2E、语义记忆、MCP 鉴权、full-bot 配置契约、NapCat/KOOK L4 契约（实机项 `L4_SKIP_PLATFORM=1` 时 skip）。

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
