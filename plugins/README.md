# Zhin.js Plugins

这里收录 Zhin monorepo 中的官方适配器、服务、业务插件和小游戏。每个插件的安装、配置与平台限制见对应目录的 README。

- `adapters/`：平台适配器（ICQQ、QQ、Slack、Discord、Telegram 等）。
- `services/`：可选运行时服务。
- `features/`：Feature 扩展。
- `utils/`：提醒、RSS、日历、记账等业务插件。
- `games/`：多人游戏与游戏入口。

## 开发

在仓库根目录安装依赖，优先验证当前插件：

```bash
pnpm install
pnpm --filter @zhin.js/plugin-reminder build
```

新插件从[第一个插件](../docs/getting-started/first-plugin.md)和 [Plugin Runtime](../docs/authoring/define-plugin.md) 开始。插件属于根 pnpm workspace，无需另建 submodule。

## 语言与内容

语言设置与时区独立。项目默认简体中文，可选择英文；`language zh-CN` / `language en` 是稳定的个人语言切换入口，调用时使用项目实际命令前缀。个人语言在同一 Bot 账号下跨私聊、群聊和频道共享，个人切换需要 SQL 存储。详见[本地化配置](../docs/configuration/localization.md)。

官方插件按当前操作语言显示命令说明、错误、表单说明和即时结果。确认、取消与补问流程固定开始时的语言，只接受该语言对应的交互词；平台 ID、配置键、稳定的命令路由与第三方协议值不翻译。

后台提醒和订阅保存创建时语言：聊天任务使用创建者当时的语言，Console 管理员任务使用项目语言。Console 界面语言只改变展示，不会修改既有任务或触发重发。定时报告使用任务注册时的项目语言，已有报告和作者正文保留原语言。

新闻、RSS 正文、歌词、用户自定义欢迎语、教学回复、二维码内容、第三方返回内容以及已有报告不会自动翻译。国际化覆盖框架生成的标题、状态和操作指引，不额外调用模型，也不改写用户或来源站点的内容。

## Language and source content

Official plugin feedback supports Simplified Chinese and English. Follow the [localization guide](../docs/en/configuration/localization.md) for project and personal preferences. Language never selects a timezone or changes permissions, delivery targets, task schedules, or retry behavior.

Confirmation flows keep their initial language. Reminder and RSS notifications keep the language captured when created. Saved reports retain their original language and authored text. Source articles, lyrics, user-defined responses and third-party payloads remain unchanged; localization does not introduce translation calls.
