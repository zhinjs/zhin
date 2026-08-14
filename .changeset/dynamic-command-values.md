---
'@zhin.js/command': patch
---

feat(command): 支持 shortcut 和 params.default 的动态函数取值

引入 `CommandDynamicValue` 统一类型，shortcut 预填值、`params.default`、`defaultValue` 均可接受 `(session: CommandSession) => value` 形式的函数，在分发时从运行时上下文（adapter、endpoint、scene、sender）动态解析。

- 新增 `CommandDynamicValue` 类型和 `resolveDynamicParams()` 集中解析函数
- 新增 `CommandSession` 和 `resolveCommandSession()` 用于从 Message 提取上下文
- 帮助文本中函数值显示为 `<dynamic>` 而非函数源码
- 三条分发路径（shortcut、normal、host/execute）统一调用 `resolveDynamicParams`
