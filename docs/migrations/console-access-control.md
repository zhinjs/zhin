---
title: 升级到 Console 访问控制
---

# 升级到 Console 访问控制

Console 不再只认配置文件里的令牌。用户、角色、会话和 API 令牌都存进项目数据库（未配置数据库时为 `.zhin/data.sqlite`），每个 Console 接口都按权限检查，所有被拒绝的请求和写操作都记审计日志。设计见 [ADR 0049](../adr/0049-console-rbac.md)。

升级到 `@zhin.js/cli` 1.2 及以上后，按下面的顺序处理。

## 1. 先初始化：创建第一个所有者

升级后第一次启动时，数据库里还没有用户。此时 `http.token` 是**初始化令牌**：它只能用来创建第一个所有者，不能读状态、改配置。创建完成后它在所有接口上失效。

两种方式，做的是同一件事：

- **Console 向导**：打开 Console，填入 Host 地址和 `http.token`，按提示选择数据库（可保持默认 SQLite）并创建所有者，之后用这个账号登录。
- **命令行**：在项目目录执行

  ```bash
  zhin console init
  ```

  脚本或容器里用非交互形式：

  ```bash
  printf '%s\n' "$OWNER_PASSWORD" | zhin console init --yes --owner admin --password-stdin
  ```

`http.token` 留在配置里也没关系：初始化之后它不再被接受。没有配置 `http.token` 的本地 Host 在初始化前对所有人开放（和以前一样），所以公网部署务必先配好 `http.token` 再启动。

忘记密码或所有者被锁：停下 Host，用离线命令 `zhin console user passwd <用户名>`、`zhin console user enable <用户名>` 或 `zhin console user create <用户名> --role owner` 恢复。没有在线的超级凭据。

## 2. 把 `http.tokens` 换成用户和 API 令牌

`http.tokens` 已删除。配置里还有它时 Host 拒绝启动，并提示删除。

| 以前 | 现在 |
| --- | --- |
| `http.token`（full） | 初始化令牌；之后用所有者账号登录 |
| `http.tokens[]` 里 `scope: user` 的成员 | 在 Console「访问控制」里为他创建用户，绑定合适的角色（`viewer` 只读、`operator` 运营、`admin` 管理员），可限定到某个适配器或账号 |
| `http.tokens[]` 里 `scope: demo` 的演示令牌 | 演示模式已删除。给演示环境开一个 `viewer` 账号 |
| `http.tokens[].permissions` 里的插件权限（如 `onebot11:read`） | 目前只有全局所有者满足插件自定义的页面权限；其他角色按内置权限目录授权 |

删除 `http.tokens` 后再启动。

## 3. 自动化改用 API 令牌

CI、监控、`zhin doctor --live`、`zhin config --host`、`zhin plugin … --host` 等以前用 `http.token` 或 `ZHIN_HTTP_TOKEN` 的地方，改为：

1. 用一个账号登录 Console，在「访问控制 → API 令牌」签发令牌，可以只勾选需要的权限（例如就绪探测只要 `status.view`）。令牌只在签发时显示一次。
2. 把它放进环境变量 `ZHIN_CONSOLE_TOKEN`：

   ```bash
   export ZHIN_CONSOLE_TOKEN=<API 令牌>
   zhin doctor --live https://bot.example.com/api --json
   ```

API 令牌的权限不会超过签发它的用户；用户被禁用或删除时令牌一起失效，也可以单独吊销。`/pub/health`、`/pub/ready` 仍然公开，不需要令牌。

## 4. 适配器反向 WebSocket 不受影响

OneBot 11 / 12、NapCat、Milky 的反向 WebSocket（`connection: wss`）只认适配器自己的 `access_token`，与 Console 账号无关，升级后客户端配置不用改。

- 配了 `access_token`：客户端必须以 `Authorization: Bearer <access_token>` 或 `?access_token=` 携带它。
- **没配 `access_token`：只接受本机（127.0.0.1 / ::1）连接**。客户端在另一台机器或容器里时，请为该 endpoint 配上 `access_token`。

Webhook 和其他插件自己的路由同样自行鉴权。

## 5. 个人推理主体

`ai.personalPrincipals` 以前按 `http.tokens[].principalId` 把令牌绑定到个人推理配置。`http.tokens` 删除后，Console 里的推理管理一律以 Host 管理员身份进行（需要 `agent.configure` 权限），暂时不能从 Console 切换到某个个人推理主体。

## 6. Console 终端（可选）

新的 Console 终端默认关闭。需要时在配置里开启，并且只有所有者（`ops.terminal`）能用：

```yaml
console:
  terminal:
    enabled: true
```

字段见[配置参考](../configuration/generated.md)。开启后，持有所有者凭据就等于持有宿主机 Shell。

## 检查清单

- [ ] 已创建所有者，能用账号登录 Console
- [ ] 配置里没有 `http.tokens`
- [ ] 自动化使用 `ZHIN_CONSOLE_TOKEN` 里的 API 令牌
- [ ] 跨机器连接的反向 WebSocket endpoint 都配了 `access_token`
