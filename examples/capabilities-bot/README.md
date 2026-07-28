# capabilities-bot

`definePlugin` 能力展示样板：**一个插件 + 一个 `zhin.config.yml` 即可启动**。

## 运行

```bash
cd examples/capabilities-bot
pnpm dev        # zhin runtime start
```

启动后（`--once` 冒烟可直接看装配输出）：

- Console: `http://127.0.0.1:18099`（token `capabilities-dev-token`），plugins 页可见 `Capabilities Bot` 卡片（metadata 生效）
- `stats` / `whoami` 命令已注册（introspection → commands）
- 心跳每 5 分钟打一行日志；`pushOnBoot: true` 时向 sandbox 私聊推上线消息

## 能力 → 代码对照

| 能力 | 位置 |
|------|------|
| 实例视图 / 配置视图 | `plugin.ts` setup ①②；`commands/whoami.ts` |
| schema.json（默认值 + 校验） | `schema.json` ↔ `zhin.config.yml` 的 `plugin:` 段 |
| 数据库表 + 命令侧模型复用 | `plugin.ts` ③ ↔ `commands/stats/` |
| 定时任务 + lifecycle 回收 | `plugin.ts` ④ |
| Agent 工具注册（可选降级） | `plugin.ts` ⑤（`showcase_greet`） |
| 主动出站 + handoff 时序 | `plugin.ts` ⑥⑦ |
| setup 返回 Dispose | `plugin.ts` ⑧ |
| metadata（Console 卡片） | `plugin.ts` `metadata` |
| npm 包子插件 | `package.json` plugins → `@zhin.js/adapter-sandbox` |

硬依赖门控（`requires: [databaseHostToken]`）见 `docs/concepts/plugin-model.md` 的 Host Resources 一节；
`./` 本地目录子插件见同文档「挂载子插件」。
