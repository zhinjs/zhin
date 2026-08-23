---
title: 故障排查中心
outline: [2, 3]
---

# 故障排查中心

> 本页由结构化故障目录生成。每个问题都遵循“症状 → 原因 → 操作 → 验证”，请勿跳过最后的验证。

先从症状定位条目。一次只改变一个条件，并保留启动日志、Trace 与 generation 信息。

## 快速定位

- [Console 无法连接 Runtime](#console-cannot-connect)
- [Console 返回 401 或 403](#console-auth-failed)
- [Endpoint 一直离线](#endpoint-offline)
- [刷新后消息或通知缺失](#messages-missing-after-refresh)
- [配置启动时被拒绝](#configuration-rejected)
- [Agent 无模型或 Provider 不可用](#agent-provider-unavailable)
- [工具等待审批或被策略拒绝](#tool-approval-stuck)
- [群、频道或仓库没有路由到 Workroom](#workroom-not-routing)
- [容器反复重启或健康检查失败](#container-not-healthy)

<section id="console-cannot-connect">

## Console 无法连接 Runtime

### 症状

Console 持续显示离线或重连中，页面数据不再更新。

### 原因

- Runtime 未启动，或 Console 访问的 host、port、base 与 Runtime 不一致。
- 反向代理没有转发 SSE，或缓存/缓冲了事件流。

### 操作

- 运行 `npx zhin doctor`，再检查启动日志中的 HTTP 监听地址。
- 确认代理对 `/api/events` 禁用缓冲并保持长连接。

### 验证

- 执行 `curl -i http://127.0.0.1:8086/pub/health` 应返回成功状态；Console 顶栏应恢复为“已连接”。

</section>

<section id="console-auth-failed">

## Console 返回 401 或 403

### 症状

登录后请求仍被拒绝，或部分写操作显示无权限。

### 原因

- Console Token 与当前 generation 的 `http.token` 不一致。
- 当前是只读 Demo 会话，或 Token 没有该操作需要的 scope。

### 操作

- 重新从部署环境读取 `HTTP_TOKEN`，不要从浏览器历史或旧配置复制。
- 生产环境修改 Token 后发布新 generation，并重新登录。

### 验证

- 使用 `curl -H "Authorization: Bearer $HTTP_TOKEN" http://127.0.0.1:8086/api/system/stats` 验证同一 Token。

</section>

<section id="endpoint-offline">

## Endpoint 一直离线

### 症状

适配器已经安装，但 Endpoint 页面显示离线且无法收发消息。

### 原因

- 实例配置未通过对应插件 Schema，或凭据为空。
- 平台网络不可达、Webhook 地址错误，或账号被平台拒绝。

### 操作

- 在 Console Endpoint 详情查看最近错误，再对照[自动生成配置字段参考](/configuration/generated)。
- 按平台文档重新验证凭据、回调地址与网络出口。

### 验证

- 重载后 Endpoint 状态应变为 online，并用真实私聊发送一条探针消息确认收发双向成立。

</section>

<section id="messages-missing-after-refresh">

## 刷新后消息或通知缺失

### 症状

实时消息可见，但刷新、断网重连或 SSE 恢复后历史不完整。

### 原因

- 当前 Endpoint/Channel 选择与消息所属空间不一致。
- 服务端事件 Journal 出现 gap，客户端需要通过权威 HTTP API 重建投影。

### 操作

- 重新选择目标 Endpoint 与 Channel，并等待恢复提示完成。
- 确认数据库持久化目录可写，且反向代理没有缓存历史 API。

### 验证

- 发送一条带唯一文本的消息，刷新页面并重启 Runtime；该消息仍应由 HTTP 历史接口恢复。

</section>

<section id="configuration-rejected">

## 配置启动时被拒绝

### 症状

启动报 `Invalid Plugin config`、未知顶层字段或环境变量展开错误。

### 原因

- 字段名、类型或枚举值与当前安装版本的 Schema 不一致。
- `${VAR}` 未设置，展开为空后触发校验失败。

### 操作

- 运行 `npx zhin doctor`，根据错误路径修正字段。
- 使用[自动生成配置字段参考](/configuration/generated)核对当前源码与 Schema。

### 验证

- `npx zhin doctor` 应通过，随后 `npx zhin runtime start` 不再出现配置校验错误。

</section>

<section id="agent-provider-unavailable">

## Agent 无模型或 Provider 不可用

### 症状

Agent 工作台无法开始回合，提示 Provider、模型或 API Key 不可用。

### 原因

- Provider 的环境变量为空，被 Runtime soft-prune。
- Agent 绑定的模型名不属于当前 generation 发布的 Provider。

### 操作

- 在 Console 能力目录确认 Provider 与模型已发布，再核对部署环境的 API Key。
- 修正 Agent binding 后发布新 generation，不要只修改磁盘配置。

### 验证

- 在实验台发起最小文本回合，Trace 应依次出现 turn start、model response 与 completed。

</section>

<section id="tool-approval-stuck">

## 工具等待审批或被策略拒绝

### 症状

Agent 回合停在工具步骤，显示待审批、拒绝或取消。

### 原因

- 工作目录或工具不在当前安全策略允许范围。
- 审批请求没有处理，或取消信号已经终止回合。

### 操作

- 在 Agent 工作台检查 cwd、安全策略与审批详情，只批准明确理解的副作用。
- 取消后的任务创建新回合，不要重放可能已经产生副作用的工具调用。

### 验证

- 用只读工具执行探针任务；Trace 中工具终态与回合终态应一致，且审批记录可追溯。

</section>

<section id="workroom-not-routing">

## 群、频道或仓库没有路由到 Workroom

### 症状

消息进入普通聊天，或任务没有出现在预期 Workroom 看板。

### 原因

- Catalog 中缺少该 interaction space 的精确绑定，或绑定仍指向旧 Agent。
- 同一 Bot 可服务多个 Workroom，但群/频道/仓库标识填写错误或发生冲突。

### 操作

- 在 Console Workroom 配置中核对 Bot、Endpoint、空间 ID、成员角色与 Agent binding。
- 保存 Catalog 后发送一条新消息；历史消息不会被重新解释。

### 验证

- 新消息应在对应 Workroom 创建 task/run，并在详情中显示命中的空间与 Agent。

</section>

<section id="container-not-healthy">

## 容器反复重启或健康检查失败

### 症状

Compose/Kubernetes 报 unhealthy、CrashLoopBackOff 或持久目录权限错误。

### 原因

- `.zhin`、`data` 挂载点不可由 node 用户写入。
- 必需 Secret、项目配置或镜像 Tag 未正确发布。

### 操作

- 检查 `docker compose logs zhin` 或 `kubectl logs deploy/zhin` 的首个错误。
- 按[生产部署](/operations/production)确认目录属主、Secret 与不可变镜像 Tag。

### 验证

- `docker compose ps` 或 `kubectl rollout status deploy/zhin` 应稳定成功，并通过健康接口。

</section>
