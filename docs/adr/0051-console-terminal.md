---
sidebar: false
---

# ADR 0051：Console 终端——宿主 Shell 与 SSH

状态：Accepted（2026-11-11）

## 背景

运维时常需要进到 Zhin 宿主机执行命令（看磁盘、查日志、装依赖），或跳到同网段的其他机器。Console 已经有数据库、配置、文件等运维页面，缺一个终端。终端等同于宿主机的完整 Shell 权限，必须默认关闭，并且只有所有者能用。

## 决策

### 1. 开关与配置（Host 顶层 `console` 块）

```yaml
console:
  terminal:
    enabled: false          # 默认关闭；关闭时路由不注册
    shell: /bin/bash        # 省略时：$SHELL，Windows 为 powershell.exe
    cwd: .                  # 相对项目根
    idleTimeout: 900        # 秒，无输入断开
    maxSessions: 4          # 同时会话上限（全局）
    ssh:
      - name: build-box     # 目标 id，浏览器只能按 name 选择
        host: 10.0.0.12
        port: 22
        username: deploy
        privateKeyPath: ~/.ssh/id_ed25519   # 或 passwordEnv / privateKeyEnv / passphraseEnv
        hostFingerprint: SHA256:…            # 可选；填写后严格校验
```

- SSH 目标只能来自这份白名单。凭据只从环境变量或本地密钥文件读取，从不经浏览器传输，也不出现在任何 RPC 响应里。
- 依赖：`node-pty`（宿主 Shell）与 `ssh2`（SSH）都是 CLI 的 `optionalDependencies`，缺失时对应目标显示「不可用」与安装提示。

### 2. 权限

- 需要 `ops.terminal`（ADR 0049；内置角色里只有 `owner` 拥有），来自用户会话或用户 API 令牌。初始化令牌不可用。
- `console.terminal.enabled: false` 时，即使有权限也返回 404。

### 3. 协议

1. `GET {base}/console/terminal/targets`（`ops.terminal`）→ `[{ id: 'local' | <ssh name>, kind: 'local'|'ssh', label, available, reason? }]`
2. `POST {base}/console/terminal/tickets`，`{ target, cols, rows }` → `{ ticket, expiresAt }`。一次性票据，30 秒有效，绑定主体。浏览器 WebSocket 不能带 `Authorization` 头，所以用票据，不把长期令牌放进 URL。
3. `WS {base}/console/terminal?ticket=…`：
   - 服务端 → 客户端：二进制帧为终端输出；文本帧为 JSON 控制消息 `{ type: 'ready' | 'exit' | 'error', … }`
   - 客户端 → 服务端：二进制帧为键盘输入；文本帧 `{ type: 'resize', cols, rows }`、`{ type: 'ping' }`
   - 空闲超时、主体会话被吊销、配置关闭终端：服务端发送 `exit` 后关闭连接，并结束进程。
4. 连接断开即结束会话（不做后台保活，避免无人看管的 Shell）。

### 4. 审计

`console_audit_log` 记录：会话开始（主体、目标、IP）、结束（时长、退出码、原因）。不记录输入输出内容。

### 5. 客户端

Console「运维 → 终端」：目标选择 + xterm.js（含 fit 插件）；多个标签页各自一个会话；断开后显示原因与「重新连接」。

## 落盘位置

- 配置 Schema：`packages/im/runtime/src/host-config-schema.json`（顶层 `console`）
- 后端：`basic/cli/src/plugin-runtime/console/terminal/`（票据、本地 PTY、SSH 会话、WebSocket 路由）
- WebSocket：`HttpHost.ws()`
- 前端：Console `src/pages/ops/Terminal.tsx`

## 后果

- 默认安装不变：关闭时没有路由、不加载 `node-pty` / `ssh2`。
- 开启后，持有所有者凭据即等于持有宿主机 Shell；文档明确提示。
