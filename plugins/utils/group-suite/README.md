# @zhin.js/plugin-group-suite

Plugin Runtime 群运营能力包，提供签到积分、消息统计、关键词回复与群问答。所有能力
由 `commands/`、`middlewares/` 和 `agent/` 约定目录发现，不注册 legacy Plugin 回调。

## 安装与拓扑

```bash
pnpm add @zhin.js/plugin-group-suite
```

父插件在 `package.json#zhin.plugins` 中声明子插件：

```json
{
  "package": "@zhin.js/plugin-group-suite",
  "instanceKey": "group-suite"
}
```

配置位于该实例的层级节点：

```yaml
plugins:
  group-suite:
    keywordReply: false
    basePointsMin: 10
    basePointsMax: 30
    streakBonus: 5
    streakCap: 50
    rankSize: 10
    teachMaxPerGroup: 200
    teachCooldownMs: 3000
    teachAllowRegex: true
    teachPageSize: 10
```

完整约束以 [`schema.json`](./schema.json) 为 SSOT。数据优先写入 Runtime
`DatabaseHost`；未配置数据库时使用插件实例私有的内存存储，适合测试。

数据库、关键词、教学冷却和消息统计缓冲统一封装为 owner-scoped
`GroupSuiteRuntime`。commands/middlewares 只通过 Capability Context 解析该资源；因此同一
进程中的多个实例、HMR 新旧 generation 不会共享可变状态。

## 能力

| 路径 | 说明 |
|---|---|
| `checkin` / `mypoints` / `rank` | 签到、积分与排行 |
| `stats` / `stats-week` / `stats-rank` / `mystats` | 消息统计 |
| `teach` / `teach-regex` / `teach-list` / `forget` | 群问答管理 |
| `keyword-add` / `keyword-list` / `keyword-remove` | 关键词回复管理 |
| `middlewares/*` | 入站统计、关键词和问答匹配 |
| `agent/tools/group_announce.ts` | 可选 Agent 群公告工具 |

本 major 不包含 Adapter side-event 欢迎/撤回、AI 群日报或 HTML 报表。这些旧能力
需要独立的事件与渲染 Feature，已从 schema 移除，避免出现“可配置但不生效”的字段。

## 验证

```bash
pnpm --filter @zhin.js/plugin-group-suite build
pnpm --filter @zhin.js/plugin-group-suite test
```
