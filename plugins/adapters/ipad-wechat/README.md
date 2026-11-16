# @zhin.js/adapter-ipad-wechat

通过 `@wchats/ipad` SDK（iPad 协议，本地签名模块 `@wchats/ipad-sign`）接入**个人微信**：私聊、群聊的文本、图片与群 @。Plugin Runtime 约定式 `defineAdapter`，SDK 在进程内运行，无需额外的协议服务。

## 与其他微信适配器的区别

| 项 | ipad-wechat | weixin-ilink | wechat-mp |
|---|---|---|---|
| 账号类型 | 个人微信 | 个人微信（ClawBot） | 微信公众号 |
| 群聊 | 支持 | 不支持 | 支持 |
| 登录 | 扫码 / 恢复已保存会话 | 扫码 / `botToken` | AppId/Secret |
| 依赖 | `@wchats/ipad` + `@wchats/ipad-sign` | 无 | 无 |

## 前置条件

- Node.js 24（SDK 要求 `>=24 <25`）
- 平台：macOS arm64 / x64、Linux x64 / arm64（仅 glibc）。签名模块自带这四个平台的原生文件
- `@wchats/ipad` 与 `@wchats/ipad-sign` 由 wchats 在 GitHub Packages **私有分发**，需要获得访问权限（对 `wchats` 组织包的 `read:packages` 令牌）

## 安装

Bot 项目根目录的 `.npmrc` 指向 GitHub Packages，令牌放在环境变量里：

```ini
@wchats:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
```

```bash
pnpm add @zhin.js/adapter-ipad-wechat @wchats/ipad@0.0.1 @wchats/ipad-sign@0.0.1
```

两个 SDK 包是可选 peer 依赖：没有安装时插件仍能加载，账号启动时报错并提示安装。两者版本必须成对。

## 最小配置

```yaml
configVersion: 2
plugins:
  ipad-wechat: "@zhin.js/adapter-ipad-wechat"
ipad-wechat:
  # dataDir: data/ipad-wechat
  endpoints:
    - id: my-wechat
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `dataDir` | `data/ipad-wechat` | SDK 状态根目录，每个账号用 `<dataDir>/accounts/<实例>`。**同一目录同时只能交给一个进程**；里面有会话与签名状态，按密钥对待 |
| `loginTimeoutMs` | `600000` | 扫码 / 恢复登录超时 |
| `qrPollIntervalMs` | `1000` | 扫码状态轮询间隔（100–30000） |
| `heartbeatIntervalSeconds` | SDK 默认 | 业务心跳间隔 |
| `reconnect` | `true` | 长链断开由 SDK 自动重连 |
| `ignoreSelfMessages` | `true` | 忽略本账号在其他设备发的消息 |
| `downloadImages` | `true` | 收到图片先下载到 `<账号目录>/media/inbound`（保留 24 小时） |
| `verification` | — | 设备验证页（见下） |

## 登录

启动账号即调用 SDK 的 `run()`：有已保存会话就恢复，否则扫码登录。

- 二维码出现在 Console 的登录面板，同时写到 `<账号目录>/login-qrcode.png`（权限 0600）。
- SDK 确认首个业务心跳（`online.ready`）后账号才算在线。
- 停止账号只做本地停止和关闭，**从不调用微信退出登录**。

### 设备验证（滑块 / 人脸）

微信要求验证新设备时，SDK 的登录以 `verification_required` 结束。没有配置 `verification` 时，账号启动失败并提示；配置后适配器用 SDK 的 `createVerificationServer()` 打开 HTTPS 验证页：

```yaml
ipad-wechat:
  endpoints:
    - id: my-wechat
      verification:
        key: ./verification/key.pem
        cert: ./verification/cert.pem
        host: 0.0.0.0                       # 手机访问
        port: 8443
        publicOrigin: https://192.168.1.10:8443
```

验证链接是本次挑战的凭据：只显示在 Console 登录面板，并写到 `<账号目录>/verification-url.txt`（0600，完成后删除），不写日志。证书 SAN 必须匹配 `publicOrigin`，手机要信任签发者。需要官方人脸页跳转（验证代理）时，先用 SDK 自带的登录示例在同一账号目录完成首次登录，再启动适配器走恢复。

## 能力

| 能力 | 支持 |
| --- | --- |
| 收：私聊、群聊文本 | ✓（群聊发送者为群成员 wxid） |
| 收：图片 | ✓ 下载后作为本地图片段；失败时降级为 `[图片]` |
| 收：语音、视频、表情、链接等 | 文本占位（`[语音]` …），SDK 原始消息在 `event` 里 |
| 发：文本、群 @ | ✓（`mention` 段转成 `@名字` + SDK `at` 列表） |
| 发：图片 | ✓（https URL 交给 SDK；base64 / 本地路径读成字节） |
| 发：语音、视频、文件、引用回复、撤回 | ✗（`reply` 段被忽略） |
| 好友 / 群 / 群成员列表 | ✓（整目录扫描结果缓存 10 分钟） |

消息投递语义沿用 SDK：

- **入站**：SDK 的消息监听返回即 ACK。适配器在 Zhin 接纳消息后才返回；输入关闭期间等待而不是失败；账号停止时不 ACK，消息由 SDK 在下次运行时重新投递。
- **出站**：每次发送使用新的 `operationId`，拿到终态结果（成功或被拒）后确认回收；**结果未知时报告 `unknown`，不会换新 ID 重发**。

其余 SDK 交付（`sync.command`、`sync.error`、`init.page`、`longlink.*`、`session.blocked`）作为平台事件转发；长链 `error` 事件会结束本次运行（与 SDK 在线示例一致）。需要 SDK 独有功能（朋友圈、群公告、邀请等）时，可通过 Endpoint 的 `sdkClient` 拿到底层客户端。

## 故障排查

| 现象 | 可能原因 |
|---|---|
| 启动报 `cannot load @wchats/ipad` | 没有安装 `@wchats/ipad` / `@wchats/ipad-sign`，或 `.npmrc` 未指向 GitHub Packages、令牌缺少 `read:packages` |
| `SIGN_NATIVE_UNAVAILABLE` | 当前平台没有签名模块的原生文件（只支持 macOS arm64/x64、Linux x64/arm64 glibc；Alpine 等 musl 不支持） |
| `STATE_IN_USE` | 同一 `dataDir` 被另一个进程占用；每个账号目录同时只能有一个运行实例 |
| 启动失败并提示 `verification` | 微信要求设备验证；按上文配置 `verification`，或先用 SDK 登录示例在同一目录完成首次登录 |
| 二维码过期 | 在 Console 重新启动账号，会生成新的二维码 |
| 发送报 `unknown` | 发送结果未知（例如写入时断线）；SDK 不会重发，请确认对方是否收到后再手动重试 |
| 群里 @ 没有高亮 | 出站 `mention` 段没有带 `name` 时会用 wxid 代替昵称 |

## 开发

测试使用 `tests/fake-sdk.ts` 的内存假客户端，不需要安装 SDK，不加载原生模块、不联网：

```bash
pnpm vitest run plugins/adapters/ipad-wechat
```
