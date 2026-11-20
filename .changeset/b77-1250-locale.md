---
"@zhin.js/plugin-runtime": minor
"@zhin.js/core": minor
"zhin.js": minor
"@zhin.js/console-protocol": minor
"@zhin.js/client": minor
"@zhin.js/console-contract": minor
"@zhin.js/page": minor
"@zhin.js/host-http": minor
"@zhin.js/agent": patch
"@zhin.js/command": patch
"@zhin.js/adapter": patch
"@zhin.js/runtime": patch
"@zhin.js/gateway": patch
"@zhin.js/cli": patch
"@zhin.js/contract": patch
"@zhin.js/pagemanager": patch
"@zhin.js/scaffold-wizard": patch
"create-zhin-app": patch
"@zhin.js/adapter-sandbox": patch
"@zhin.js/adapter-bilibili": patch
"@zhin.js/adapter-juejin": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/process-monitor": patch
"@zhin.js/plugin-content-moderation": patch
"@zhin.js/plugin-earthquake": patch
"@zhin.js/plugin-nettools": patch
"@zhin.js/plugin-rss": patch
"@zhin.js/plugin-game-hub": patch
"@zhin.js/plugin-blackjack": patch
"@zhin.js/plugin-dice-duel": patch
"@zhin.js/plugin-dungeon-expedition": patch
"@zhin.js/plugin-guess-number": patch
"@zhin.js/plugin-idiom-chain": patch
"@zhin.js/plugin-roulette": patch
"@zhin.js/plugin-rps": patch
"@zhin.js/plugin-text-adventure": patch
"@zhin.js/plugin-tic-tac-toe": patch
"@zhin.js/plugin-word-riddle": patch
---

统一显示语言类型、语言解析与列表分隔（zhinjs/zhin#1250 第 77 批）。

- 新增：`@zhin.js/plugin-runtime` 导出 `formatList(locale, items, { separator? })`（`list` 默认 `、` / `, `，`comma` 为 `，` / `, `，`semicolon` 为 `；` / `; `；只拼接，英文不加 `and`），经 `zhin.js` 主入口与 `zhin.js/i18n` 再导出；`queryLocale()` 严格解析 `?locale=`；`projectLocale()` 从 `@zhin.js/core/runtime` 移入（core 不再导出）。
- 命令的语言回退改走与消息相同的项目语言（先取 generation 投影的项目语言，再取根配置 `locale`）；之前命令只读根配置。消息自带的语言不合法时回退项目语言，而不是固定的 `zh-CN`。
- Console 接口：`/conversations/workspaces/commands`、`/conversations/outcomes`、`/entries`、`/console/api/pages`、Console 首页与插件市场搜索的 `?locale=` 之前把非法值当作中文（或忽略），现在与任务、权限说明接口一样严格：不支持或重复的值返回 400（`invalid_locale`）。缺省行为不变。400 响应由 `@zhin.js/host-http` 新增导出的 `invalidLocaleResponse()` 统一给出（实例路由与插件市场共用，错误文案中英文一致：`locale 只能是 zh-CN 或 en（locale must be zh-CN or en）`；插件市场之前只有英文）。页面标题按 `titleI18n[locale]` 精确取值：`titleI18n` 的键只能是 `zh-CN` / `en`，不再按 `zh` / `en-US` 等前缀或其他键猜测。
- 删除别名类型（不留兼容）：`@zhin.js/client` 的 `PluginUiLocale`（改为再导出 `@zhin.js/console-protocol` 新增的 `ConsoleLocale`），`@zhin.js/console-contract` 的 `PageKeywordLocale` 与 `DeclarativeUiLocale`（合并为本包零依赖的 `ConsoleLocale`），`@zhin.js/page` 对这两个类型的再导出；内部别名 `PlatformGuidanceLocale`、`CreateLocale`、`SandboxLocale`、`AdapterConsoleLocale` 一并删除。其余内联的 `'zh-CN' | 'en'` 改用 `Locale` / `ConsoleLocale`。
- 语言判定改用 `resolveLocale()`：Agent 未执行工具提示与协作补充文案不再按 `en` 前缀猜测（`en-US` 之类的值回退中文；实际传入的都是已解析的语言）；系统提示的平台说明在缺少语言时改为中文（之前英文）；重启回执、消息结局文案、create-zhin、ICQQ 辅助脚本、成语接龙动作词同样改用统一解析。成语接龙的开局动作词（`chainStartAction`）之前把任何不以 `zh` 开头的值（如 `en-US`、`fr`）当作英文、给出 `pinyin` / `char`；现在只有 `en` 给出英文，其余不支持的值与缺省一样回退中文的「同音」/「同字」（`zh-CN` 与 `en` 不变）。B 站与掘金 Console RPC 删除各自的 `localeOf`。
- 列表分隔统一用 `formatList`，输出不变：命令建议、回复兜底的工具列表、工具审批卡、群规豁免、账号命令字段、Console 提醒、地震订阅地区与数据源告警、游戏大厅、轮盘、文字冒险、猜词选项、内容审核动作、网络工具与 RSS 任务详情。`@zhin.js/command` 与 Agent 文案表中的分隔符条目（`suggestionSeparator`、`toolSeparator`、`listSeparator`、`detailSeparator`、猜词 `separator`）删除。
