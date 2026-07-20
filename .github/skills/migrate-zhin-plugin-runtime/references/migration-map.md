# 迁移映射

| 旧写法 | 新 SSOT |
|---|---|
| `addCommand(new MessageCommand(...))` | `commands/**/*.ts` + `defineCommand()` |
| `addMiddleware(fn)` | `middlewares/*.ts` + `defineMiddleware()` |
| `addComponent(fn)` | `components/*.ts(x)` + `defineComponent()` |
| `addTool()` / Tool registry | `tools/*.ts` + `defineAgentTool()` |
| Skill registry | `skills/<name>/SKILL.md` |
| Agent registry | `agents/<name>.agent.md` |
| MCP registry | `mcp/*.ts` + MCP Feature definition |
| Console entry route metadata | `pages/*.tsx` + `definePage()` |
| 自定义 nav/footer 注册 | `pages/$nav.tsx` / `pages/$footer.tsx` |
| 模块级 Plugin 注册 | `package.json#zhin` + `definePlugin()` entry |
| 全局可变能力 registry | generation-scoped Feature projection |

## Command 路由

```text
gh issue list
  -> commands/gh/issue/list.ts

gh pr <title:string=defaultTitle>
  -> commands/gh/pr/[title:string=defaultTitle].ts
```

新 action 接收 `CommandContext`：旧 `message` 对应 `context.input`，旧
`result.params/result.args` 对应 `context.params/context.args`。

## Plugin 与配置

- Root 项目和每个 Plugin package 都可拥有同一套能力目录。
- `plugins/*` 只表示当前 monorepo 携带的一级 child package；逻辑子树由 manifest mount。
- child 可来自 workspace 或 npm，但都必须同时存在 package dependency 与 `zhin.plugins`。
- 每个 package 的 `schema.json` 只声明自己的字段；Root 按 Plugin instance tree 物化配置。
- 旧闭包读取的数据库、env 或共享连接应提升为 owner Resource/Context，再由能力执行上下文读取。

## 不能自动迁移

- callback 捕获入口文件局部变量或隐式 Plugin Context。
- 动态 MessageCommand pattern、matcher、权限链或运行时条件注册。
- 注册与 disposer 依赖分支执行顺序。
- ComponentContext 或模板字符串空白可能被代码生成改变。
- 同一能力由旧 registry 与新目录双写。

遇到这些情况时，先为旧行为补测试，再把依赖改成显式 config/resource/context，最后迁移能力。
