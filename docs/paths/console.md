# Console 管理路径（约 1 小时）

目标：在浏览器里管 bot——发消息、改配置、看日志、管多个账号。
Console 是独立站点 [console.zhin.dev](https://console.zhin.dev)，
你的 bot（Host）只暴露 API，不 serving 任何页面。

## 1. 连接你的 bot（3 分钟）

bot 启动后（默认 `http://127.0.0.1:8086`）：

1. 打开 [console.zhin.dev](https://console.zhin.dev)
2. Host 填 `http://127.0.0.1:8086`
3. Token 填 `.env` 里的 `HTTP_TOKEN`

就这三步，没有账号系统。token 即权限，别泄露。

## 2. 仪表盘速览（10 分钟）

| 页面 | 你能做什么 |
|------|-----------|
| 概览 | 插件数 / endpoint 在线数 / 运行时长 / 内存 |
| 插件 | 每个插件的能力卡片（命令/工具/页面/适配器），点进去改配置 |
| Endpoints | 每个账号的连接状态，点进去看好友/群/收发消息 |
| 配置 | 表单改任意插件配置（热重载），或直接编辑整份 YAML |
| 日志 | SystemLog 落库的运行日志，按级别过滤 |
| 数据库 | 浏览/编辑 bot 的 SQLite 表 |
| 定时任务 | cron 任务的启停/新建/删除 |

## 3. 多账号管理（15 分钟）

一个适配器插件挂多个账号（endpoint）——QQ 五个小号、QQ 官方主 bot + 沙箱 bot，
在「插件」页是**一张卡片、下面一排 endpoint**，各自显示在线状态。

加账号有两种方式：

- **配置文件**：`plugins.<adapter>.endpoints` 数组加一项，重启
- **聊天命令**（部分平台）：QQ 官方在聊天里发 `qq.endpoint add`，
  手机扫码即完成绑定（凭据自动写 `.env`，配置自动追加，重启生效）

## 4. 收发消息实测（10 分钟）

「Endpoints」页点进任意 endpoint：

- 好友 / 群列表（平台支持时）
- 选会话发消息（走与 bot 回复完全相同的出站链路）
- 入站消息实时推送（SSE），不用刷新

## 5. 远程 / 生产姿势（10 分钟）

- **改 CORS**：`http.corsOrigins` 加上你的 Console 来源
- **demo 只读模式**：公开演示时用 demo token（只读 RPC，写操作全禁）
- **反向代理**：Console 和 API 可以同域——把 `/api`、`/entries` 反代到 bot 的 8086

## 你现在已经会的

- Console = 纯前端站点 + 你的 bot 提供 API，token 即权限
- 多账号 = 一张插件卡片下多个 endpoint
- 日常运维（日志/配置/定时任务/发消息）不需要 ssh、不需要改代码

## 下一步

- 自己写 Console 页面 → 插件 `pages/` 目录（参考 sandbox 适配器）
- 真实多平台部署参考 → [多平台社区 Bot 案例](../showcase/community-bot.md)
