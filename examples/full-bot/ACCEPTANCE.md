# full-bot L4 验收

`examples/full-bot` 为 **L4 全维度参考实例**（非 Stable 黄金路径）。自动化：`pnpm check:l4`；手工步骤如下。

## 自动化（CI / 本地）

```bash
# 仓库根
pnpm check:l4
```

覆盖：Agent Harness、语义记忆、MCP 鉴权、full-bot 配置契约、NapCat/KOOK L4 契约（实机项 `L4_SKIP_PLATFORM=1` 时 skip）。

## Agent Harness 协作验收（手工项）

与 [ADR 0048](https://github.com/zhinjs/zhin/blob/main/docs/adr/0048-agent-harness.md) 对齐；自动化见 `pnpm check:l4`。

### A. 状态权威（Harness Journal + Guard Kernel）

- [ ] 协作邮件（`ask` / `delegate` / `tell` / `result`）与黑板写入（`board_write`）均记入 Engagement Journal
- [x] `pnpm check:l4` 通过

### B. IM 终态反馈（观众 #1）

- [ ] **私聊协作**（入口 Agent `ask` / `delegate` 其他 Agent）：Sandbox 发 `ai: <触发 vision 路由的文本>`，应收到入口 Agent 整理后的文本结果
- [ ] **空 summary**：被委派的 Agent 返回空文本时，IM 应收到固定 fallback：`任务已完成，但没有可展示的文本结果。`
- [ ] **失败**：被委派的 Agent 抛错时，IM 应收到 `trigger.errorTemplate` 错误回复（非仅日志）
- [ ] **Remote A2A**：远程 Agent 通过 `a2a.mailbox.peers` 接入，Mail 携带签名的 Authority 与预算；不恢复旧 poller

### C. API / Console 投影（v1 = API；v1.1 = UI）

- [ ] `GET /api/agent/engagements` 与 Engagement Journal 一致（需要 `agent.view`）
- [ ] `GET /api/agent/engagements/:engagementId` 含事件与黑板
- [ ] Remote Console 协作图谱页可查看 Engagement；本示例自带的 `pages/workroom/index.ts` 是示例页面，数据来自 `plugin.ts` 的 `workroom-summary` RPC

## 手工验收

### 1. Sandbox + 协作边界

1. `cd examples/full-bot && cp .env.example .env && pnpm dev`
2. Remote Console 连接 Host（端口默认 `8069`），确认协作图谱只读，没有 `agent.view` 的账号读取 `/api/agent/engagements` 得到 403
3. 协作工具（`ask` / `delegate` 等）只在本回合确实有其他可联系的 Agent 时出现
4. 一次协作结束后，`zhin trace --engagements --list` 能看到对应的 Engagement
5. 显式数据库激活失败时候选 generation 必须失败

### 2. 语义记忆

在 AI 回合中（或工具直调）：

- `memory_upsert(key=capability:workroom_kernel_v1, content=shipped)`
- `memory_search(query=workroom_kernel_v1)` 应召回 `shipped`

或激活 `memory-consolidate` skill 后让 Agent 写入。

### 3. MCP 与 A2A 鉴权

MCP / A2A 只接受两种 Bearer（`packages/im/zhin/src/instance/protocol-host-installer.ts` 的 `bearerAllowed`）：

- **协议令牌**：`mcp.token` / `a2a.token`（本示例来自 `.env` 的 `MCP_TOKEN` / `A2A_TOKEN`）；
- **Console API 令牌**：给账号（或其角色）授予**全局**权限 `mcp.access` / `a2a.access` 后签发的 API 令牌（Console「访问控制 → API 令牌」，签发时可只勾选 `mcp.access` / `a2a.access`）；令牌的权限不超过签发账号。

`HTTP_TOKEN`（`http.token`）只是初始化令牌：创建首个所有者之前可以通过，之后处处拒绝，不能当作 MCP / A2A 凭据。

MCP 工具（非 Agent Mesh）：

```bash
curl -s -X POST http://127.0.0.1:8069/mcp \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${MCP_TOKEN}" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

- 带 `MCP_TOKEN` → 200；换成带 `mcp.access` 的 API 令牌同样 200。
- 无 `Authorization: Bearer` → **401**（本示例 `allowUnauthenticatedLocalhost: false`）。
- 创建所有者后用 `HTTP_TOKEN` → **401**；只有 `status.view` 等、缺 `mcp.access` 的 API 令牌 → **401**。

A2A Agent Card：

```bash
curl -s http://127.0.0.1:8069/a2a/zhin/.well-known/agent-card.json \
  -H "Authorization: Bearer ${A2A_TOKEN}"
```

- 带 `A2A_TOKEN`，或带 `a2a.access` 的 API 令牌 → 200。
- 无 Bearer → **401**（配置了 `a2a.token` 时；未配置且非生产时只放行本机回环）。
- 创建所有者后用 `HTTP_TOKEN` → **401**。

### 4.（可选实机）NapCat 或 KOOK

1. 填写 `.env` 中 `ONEBOT11_*` 或 `KOOK_TOKEN`
2. 取消 `zhin.config.yml` 对应 `endpoints` 注释
3. 群 @bot 或私聊触发 AI 回合

CI 不依赖实机；本地验证不设 `L4_SKIP_PLATFORM` 时可跑适配器 optional smoke。

## 可观测

- REST：`GET /api/agent/engagements`
- CLI：`zhin trace --engagements`
- Console：协作图谱只读投影 / 会话树
