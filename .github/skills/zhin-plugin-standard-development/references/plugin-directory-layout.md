# 插件目录骨架参考

这个参考用于选择最小、可发现的插件结构。不要预建空能力目录；只有真实能力存在时才创建对应入口。

## 最小插件

```text
my-plugin/
├── package.json
├── plugin.ts
└── schema.json        # 可选：插件配置
```

`plugin.ts` default-export `definePlugin()`，只负责资源装配与生命周期。业务能力放在约定目录，普通依赖模块可放 `src/`。

## 模块化插件

```text
my-plugin/
├── package.json
├── plugin.ts
├── schema.json
├── commands/
│   └── status/index.ts
├── middlewares/
│   └── audit/index.ts
├── handlers/
│   └── message-receive/index.ts
├── components/
│   └── status-card/index.tsx
├── schedules/
│   └── daily-report/index.ts
├── pages/
│   └── dashboard/index.tsx
└── src/
    ├── service.ts
    └── domain.ts
```

能力入口 default-export 对应的 `define*` 定义。命令目录可继续嵌套，路径就是用户路由；其他 TypeScript 能力使用单层 `<name>/index.ts`。共享业务逻辑放 `src/`，不要把 helper 伪装成能力入口。

## 带 Agent 能力的插件

```text
my-plugin/
├── AGENTS.md
├── tools/
│   └── health/index.ts
├── hooks/
│   └── audit/index.ts
├── skills/
│   └── diagnostics/
│       ├── SKILL.md
│       └── tools/
│           └── inspect/index.ts
└── agents/
    └── operator/
        ├── agent.json
        ├── system.md
        ├── boundaries.md
        ├── conventions.md
        ├── tools/
        │   └── restart/index.ts
        └── skills/
            └── recovery/
                ├── SKILL.md
                └── tools/
                    └── diagnose/index.ts
```

根 `tools/` 对插件全局披露。Agent、Skill、Agent-Skill 下的 Tool 只有所属能力激活后才披露。不要创建空 Skill 或把领域专用 Tool 提升到根目录。

## MCP 与适配器

```text
my-plugin/
├── adapters/
│   └── platform/index.ts
└── mcps/
    └── service/index.ts
```

分别 default-export `defineAdapter()` 与 `defineMcp()`。平台协议实现放适配器；通用插件不要承载平台生命周期。

## 选择原则

- 只有装配逻辑：保留最小插件。
- 有用户可调用能力：添加对应约定目录。
- 有共享实现：放入 `src/`，由能力入口导入。
- 有 Agent 能力：按归属放入 `tools/`、`skills/`、`agents/`、`hooks/`，保持渐进披露。
- 没有某类能力：不要创建占位目录或空文件。

已有经典插件迁移时使用 `migrate-zhin-plugin-runtime`；只做结构治理时使用 `zhin-plugin-refactoring`。
