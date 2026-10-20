# 插件能力地图

所有能力都由 Plugin Runtime 发现和装配。`plugin.ts` 负责资源与生命周期，不手写能力注册。

| 能力 | 入口 | 用途 |
|------|------|------|
| 命令 | `commands/**/index.ts` + `defineCommand()` | 用户显式触发、参数解析、权限入口 |
| 中间件 | `middlewares/<name>/index.ts` + `defineMiddleware()` | 有序入站处理或发送前改写 |
| Handler | `handlers/<name>/index.ts` + `defineHandler({ event })` | fire-and-forget 事件观察 |
| 组件 | `components/<name>/index.tsx` + `defineComponent()` | 可复用消息渲染 |
| 定时任务 | `schedules/<name>/index.ts` + `defineSchedule()` | 静态周期任务；动态任务可在 `plugin.ts` 注入 Schedule Host |
| Console 页面 | `pages/<name>/index.tsx` + `definePage()` | Console 页面；`nav`、`footer` 是布局槽 |
| Adapter | `adapters/<name>/index.ts` + `defineAdapter()` | 平台连接、入站与出站协议 |
| MCP | `mcps/<name>/index.ts` + `defineMcp()` | MCP 服务定义 |
| Tool | `tools/<name>/index.ts` + `defineAgentTool()` | 插件对外披露的结构化 Agent 能力 |
| Skill | `skills/<name>/SKILL.md` | 按需加载的领域指令与私有能力 |
| Agent | `agents/<name>/agent.json` + 3 个核心 Markdown | 具名子 Agent 的身份、边界和规范 |
| Hook | `hooks/<name>/index.ts` + `defineHook()` | Agent 生命周期 Hook |

## 配置、资源与生命周期

- `schema.json` 声明插件自己的配置，能力通过 owner-scoped `context.config` 读取。
- `plugin.ts` 的 `setup(context)` 使用 `context.resources.provide()` 装配共享服务。
- 可选 Host 先 `context.resources.has(token)`，再 `use(token)`。
- disposer 通过 `context.lifecycle.add()` 注册，或由 `setup()` 返回。
- 共享可变状态属于 generation-owned Resource，不使用模块级单例。

## AI 能力归属

Tool 有四个披露层级：

```text
tools/<name>/index.ts
agents/<agent>/tools/<name>/index.ts
skills/<skill>/tools/<name>/index.ts
agents/<agent>/skills/<skill>/tools/<name>/index.ts
```

默认只披露插件根 Tool、Skill 和 Agent 描述。加载 Skill 或进入具名 Agent 后，再披露对应私有 Tool。一个能力只放在最窄的有效归属中。

Agent 必须使用目录格式：

```text
agents/<name>/
├── agent.json
├── system.md
├── boundaries.md
└── conventions.md
```

`workflows/`、`tools/`、`skills/`、`hooks/`、`knowledge/` 按需增加。不要使用单文件 `.agent.md`，也不要创建没有实际内容的 Skill。

## 事件选择

- 需要顺序、拦截或改写：使用 Middleware。
- 只观察事件且不影响主链：使用 Handler，并显式声明 dotted event 名。
- Agent 生命周期扩展：使用 Hook。
- 需要释放连接或监听器：在 `plugin.ts` 注册生命周期清理。

## 选择原则

- 用户主动输入触发：Command。
- 每条消息都经过且顺序重要：Middleware。
- 独立事件副作用：Handler。
- 固定周期执行：Schedule。
- AI 领域能力：优先放入对应 Agent 或 Skill，确实通用时才放根 Tool。
- 平台协议与连接：Adapter。
- 共享服务与外部 SDK：Resource + `src/` helper。
