# 适配器

适配器用于连接不同的聊天平台。每个适配器管理一个或多个 Bot 实例，负责消息收发和平台特定的 API 调用。

## 平台适配器文档

各平台的安装、配置与 API 说明已拆分为**独立文档页**，内容与 `plugins/adapters/*/README.md` 自动同步：

👉 **[平台适配器索引](/adapters/)** — 按 Stable / Advanced / Experimental 分类，17 个适配器各一篇

**档位说明**：Experimental **不等于**没有测试；表示部署差异大、**无全量 CI/实机对外承诺**，使用前请自行验证环境。

### Stable

| 适配器 | 包名 | 文档 |
|--------|------|------|
| Sandbox | `@zhin.js/adapter-sandbox` | [Sandbox](/adapters/sandbox) |

### Advanced

| 适配器 | 包名 | 文档 |
|--------|------|------|
| ICQQ (QQ) | `@zhin.js/adapter-icqq` | [ICQQ](/adapters/icqq) |
| QQ 官方 | `@zhin.js/adapter-qq` | [QQ 官方](/adapters/qq) |
| OneBot v11 | `@zhin.js/adapter-onebot11` | [OneBot v11](/adapters/onebot11) |
| KOOK | `@zhin.js/adapter-kook` | [KOOK](/adapters/kook) |
| Discord | `@zhin.js/adapter-discord` | [Discord](/adapters/discord) |
| Telegram | `@zhin.js/adapter-telegram` | [Telegram](/adapters/telegram) |
| Slack | `@zhin.js/adapter-slack` | [Slack](/adapters/slack) |
| 钉钉 | `@zhin.js/adapter-dingtalk` | [钉钉](/adapters/dingtalk) |
| 飞书 | `@zhin.js/adapter-lark` | [飞书](/adapters/lark) |
| 微信公众号 | `@zhin.js/adapter-wechat-mp` | [微信公众号](/adapters/wechat-mp) |

### Experimental

| 适配器 | 包名 | 文档 |
|--------|------|------|
| NapCat | `@zhin.js/adapter-napcat` | [NapCat](/adapters/napcat) |
| OneBot v12 | `@zhin.js/adapter-onebot12` | [OneBot v12](/adapters/onebot12) |
| Milky | `@zhin.js/adapter-milky` | [Milky](/adapters/milky) |
| Satori | `@zhin.js/adapter-satori` | [Satori](/adapters/satori) |
| Email | `@zhin.js/adapter-email` | [Email](/adapters/email) |
| GitHub | `@zhin.js/adapter-github` | [GitHub](/adapters/github) |

完整索引与档位说明亦见 **[平台适配器索引](/adapters/)**。

修改适配器文档请编辑对应包内 `README.md`，再运行 `pnpm sync:adapter-docs`。

## Process（进程适配器）

**不是** `@zhin.js/adapter-*` 插件，而是 `@zhin.js/core` 内置的 **核心服务**（[`adapter-process.ts`](https://github.com/zhinjs/zhin/tree/main/packages/im/core/src/built/adapter-process.ts)）。

| 项 | 说明 |
|----|------|
| 启用 | 默认在 `services` 中含 `process`；可从列表移除以关闭 |
| `context` | `process`（自动注册 bot，**通常无需**写 `bots:` 条目） |
| 输入 | 仅当 stdin 为 **TTY** 或设置 `ZHIN_BIND_STDIN=1` 时绑定终端 |
| 与 Sandbox | Sandbox = WebSocket + Remote Console；Process = 本机 stdin，**Stable 调试请用 Sandbox** |

```yaml
services:
  - process   # 默认已含；非 TTY 环境（如 CI）可省略或关闭
```

Deno Deploy 等环境会自动跳过 process 绑定。

## 多平台同时运行

```yaml
plugins:
  - "@zhin.js/adapter-icqq"
  - "@zhin.js/adapter-kook"
  - "@zhin.js/adapter-discord"

bots:
  # ICQQ：先 `icqq login`，name 与 QQ 号一致
  - context: icqq
    name: "${ICQQ_ACCOUNT}"

  - context: kook
    name: kook-bot
    token: "${KOOK_TOKEN}"
  
  - context: discord
    connection: gateway
    name: discord-bot
    token: "${DISCORD_TOKEN}"
```

所有平台共享同一套插件和命令，消息处理逻辑完全统一。各平台 bot 字段详见 [平台适配器索引](/adapters/)。

## 适配器工具与技能

适配器不仅负责消息收发，还可以向 AI Agent 提供平台特有的工具。

### 群管理能力（自动检测）

群管理是 IM 系统的通用能力。Adapter 基类声明了 `IGroupManagement` 接口中的可选方法规范，适配器只需覆写自己平台支持的方法，`start()` 会自动检测并生成 Tool + 注册 Skill，无需任何手动调用：

```typescript
class IcqqAdapter extends Adapter<IcqqBot> {
  async kickMember(botId: string, sceneId: string, userId: string) {
    const bot = this.bots.get(botId)
    return bot!.kickMember(Number(sceneId), Number(userId), false)
  }

  async muteMember(botId: string, sceneId: string, userId: string, duration = 600) {
    const bot = this.bots.get(botId)
    return bot!.muteMember(Number(sceneId), Number(userId), duration)
  }

  async start() {
    this.registerPlatformTools() // 仅注册平台特有工具
    await super.start()          // 自动检测群管方法 → 生成 Tool → 注册 Skill
  }
}
```

目前多数 IM 适配器（ICQQ、OneBot11、Milky、QQ 官方、Telegram、Discord、KOOK、Slack、钉钉、飞书等）以及 Satori、OneBot 12 等协议适配器均已接入，详见 [平台适配器索引](/adapters/)。

### 平台特有工具（addTool）

对于标准群管以外的平台特有操作（如 ICQQ 的头衔、群公告、戳一戳，Discord 的角色管理等），仍通过 `addTool()` 手动注册，它们会被自动收录到同一个 Skill 中：

```typescript
private registerPlatformTools() {
  this.addTool({
    name: 'icqq_set_title',
    description: '设置群成员的专属头衔',
    parameters: { /* JSON Schema */ },
    requiredAnyRole: ['group_owner'],
    execute: async (args) => { /* ... */ },
  })
}
```

详见 [工具与技能](/advanced/tools-skills)。
