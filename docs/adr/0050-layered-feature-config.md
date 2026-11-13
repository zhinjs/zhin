---
sidebar: false
---

# ADR 0050：功能配置三级覆盖——全局 < 适配器 < 账号

状态：Accepted（2026-11-11）

## 背景

插件配置只有一份全局视图：`context.config` 来自配置文档里插件自己的块，启用 / 禁用只有顶层 `disable_plugins`，而且切换会重启进程。实际运营中，同一个功能在不同平台、不同账号上要有不同的设置（某个 QQ 账号不开 RSS，某个 Telegram 账号每次只推 1 条）。现有零散先例——activity-feedback 的 `defaults / platforms / endpoints`、命令前缀解析器——各自实现，语义也不一致（activity-feedback 的 `enabled` 允许下级重新打开）。

## 决策

### 1. 层级与标识

| 层级 | 键 | 来源 |
|---|---|---|
| `global` | — | 插件自己的配置块 |
| `adapter` | 适配器**实例别名**（配置文档里的顶层键，如 `qq`、`tg-main`） | `overrides.adapters.<alias>` |
| `endpoint` | `<别名>/<endpointId>`（如 `qq/bot-1`） | `overrides.endpoints.<别名>/<endpointId>` |

消息上的 `conversation.endpoint {adapter, id}` 通过 `AdapterIndex` 映射回实例别名与 endpointId，得到解析键。

### 2. 插件声明支持的层级

在插件配置 Schema 根上的 `x-zhin-config`：

```json
{ "type": "object", "x-zhin-config": { "levels": ["global", "adapter", "endpoint"] }, "properties": { … } }
```

- 省略 `levels` 等同 `["global"]`：只支持全局配置，`overrides` 不可写，Console 不显示适配器 / 账号层。
- 单个属性可用 `"x-zhin-config": { "levels": ["global"] }` 收窄为仅全局（如数据库连接、API 密钥）；属性不能放宽插件根声明。
- 没有配置 Schema 的插件：只支持启用 / 禁用的三级开关（见下），没有字段覆盖。
- 有配置 Schema 但省略 `levels` 的插件只有全局层：Console 的适配器 / 账号（及会话）页面不列出它（2026-11-12 修订，见「后果」）。

### 3. 存储

覆盖写在插件自己的配置块里，保留键 `overrides`（与 `commandNamespace`、`disabledCommands` 一样由 composer 注入 Schema、在 `pickOwnFields` 之前剥离）：

```yaml
rss:
  maxItems: 5
  overrides:
    adapters:
      qq: { enabled: false }
    endpoints:
      "tg-main/news": { maxItems: 1 }
```

- `overrides.adapters.*` / `overrides.endpoints.*` 的值是插件 Schema 的**部分对象**（所有字段可选，仅允许 `levels` 包含对应层级的字段），外加保留字段 `enabled: boolean`。
- 校验：覆盖值按插件 Schema 的对应子集用 Ajv 校验；指向不存在的适配器别名或账号的键保留并给出警告（账号可能稍后添加），不报错。
- 全局层的启用 / 禁用仍是 `disable_plugins`，不新增第二种写法。它是插件生命周期而非功能开关：Console 上由管理网关作为启停事务执行（停实例 → 写入 → 启动，失败回滚），权限为 `plugin.manage`（ADR 0054 §4，2026-11-13 修订）。

### 4. 解析规则

**启用（自上而下，上级优先）：**

```
effectiveEnabled = !disable_plugins.includes(plugin)
                && overrides.adapters[alias]?.enabled !== false
                && overrides.endpoints[alias/id]?.enabled !== false
```

启停是逐级的单向选择（2026-11-12 修订，适用于全部层级，含 ADR 0055 的会话层）：

- 只有当上面所有层级都启用时，某一层才可以**停用**；任一上级（全局 / 适配器 / 账号）停用了插件，其下所有层级即被锁定：不能启用，自己的开关显示为「已被〈层级〉停用」并锁定。
- 被锁定的层级不能修改自己的 `enabled`（启用与停用都拒绝），`feature.set-enabled` 返回 HTTP 409 `{ success: false, code: 'locked', lockedBy: 'global'|'adapter'|'endpoint', error }`，`error` 固定为「已被{全局|适配器|账号}层停用，下级开关已锁定」；群内命令回复是哪一层锁定的。上级之后才停用时，下级先前存下的 `enabled: false` 保留不动（整层删除覆盖时也保留该开关）。
- 下级永远不存「启用」：在下级启用 = 删除该层的开关（仅在未锁定时允许）。手写的下级 `enabled: true` 不起作用，校验器给出警告。

**其他字段（自下而上，下级优先）：**

```
effective = deepMerge(global, overrides.adapters[alias], overrides.endpoints[alias/id])
```

- 普通对象逐键深合并；数组与标量整体替换；`null` 表示「显式清空」，不是「继承」。
- 每个字段的来源可以单独查询（`global` / `adapter` / `endpoint`），供 Console 显示「继承自…」「已覆盖」。

### 5. 运行时 API

- `context.config`：保持不变，仍是全局视图（不含 `overrides`）。
- `context.configFor(target)`：`target` 是消息、`{ adapter, endpointId }` 或解析键；返回该账号的有效配置（已合并、已校验、冻结）。结果按 `(配置代次, 解析键)` 缓存，配置应用后失效。
- `context.isEnabledFor(target)`：返回有效启用状态。

### 6. 自动门禁

插件在某账号上 `effectiveEnabled === false` 时，Runtime 在分发处直接跳过，插件代码不需要自己判断：

- 命令匹配与执行（`commands/`）
- 中间件链（`middlewares/`）
- 消息与事件处理器（`handlers/`，限带 `conversation.endpoint` 的事件）
- Agent 工具披露与调用（`tools/`、技能私有工具）——该账号会话里看不到，也调不到
- 定时任务、后台轮询等不经过消息的能力：由插件用 `isEnabledFor` 自行判断（例如 RSS 推送前按目标账号过滤）

门禁失败视为「功能不存在」：命令不回复「已禁用」，与当前全局禁用的行为一致。

### 7. 生效方式

- 只改 `overrides`：原地生效（`in-place`），不重启、不重载插件——`configFor` 缓存失效即可，下一条消息读到新值。
- 改全局字段：沿用字段现有的 `x-zhin-config.effect`。
- 改 `disable_plugins`：重启实例。Console 上由网关事务完成（停实例、写入、启动，启动失败回滚，ADR 0054 §4）；适配器 / 账号层的 `enabled` 走原地生效。

### 8. Console 接口（RPC，`feature.*`）

| 类型 | 权限 | 说明 |
|---|---|---|
| `feature.list` | `feature.view` | 全部功能：`{ plugin, displayName, levels, hasSchema, globalEnabled }` |
| `feature.matrix` | `feature.view` | 行为功能、列为全局 + 每个适配器实例：每格 `{ enabled, lockedBy?: 'global'\|'adapter', overridden: boolean }` |
| `feature.get` | `feature.view` | `{ plugin, level, key? }` → `{ schema, values, effective, sources: { [path]: level }, enabled, lockedBy? }`；机密字段值以掩码返回 |
| `feature.set-override` | `feature.configure` | `{ plugin, level: 'adapter'\|'endpoint', key, patch }`：写入覆盖（合并 patch，`undefined` 删除字段） |
| `feature.remove-override` | `feature.configure` | `{ plugin, level, key, paths? }`：删除整层或指定字段，回到继承 |
| `feature.set-enabled` | `feature.toggle`；`global` 层 `plugin.manage` | `{ plugin, level, key?, enabled }`：`global` 层写 `disable_plugins`，由网关拦截并作为启停事务执行（ADR 0054 §4，实例拒绝该层，409 `gateway-required`）；其余层写 `overrides.*.enabled`（`true` 时删除该键，而不是写 `true`） |

所有写入走 `ConsoleConfigurationStore` 现有的修订号与原子写入路径。RBAC 作用域（ADR 0049）按 `level` + `key` 检查。

## 落盘位置

- Schema 关键字、保留键注入与覆盖校验：`packages/im/runtime/src/`（`config-composer.ts`、`application-plugin-declaration.ts`）
- 解析器（纯函数，带来源追踪）：`packages/im/runtime/src/layered-config.ts`
- `configFor` / `isEnabledFor`：`packages/im/plugin-runtime`（插件上下文）
- 分发门禁：`packages/im/core/src/plugin-runtime/im/`（命令、中间件、处理器索引）与 `packages/im/agent`（工具披露）
- `feature.*` RPC：`packages/im/zhin/src/instance/console/console-feature-rpc.ts`；全局开关：`packages/host/gateway/src/http/plugin-switch-rpc.ts`
- 现有 activity-feedback 的 `platforms / endpoints` 保持兼容，文档标注推荐迁移到 `overrides`

## 后果

- 没有配置 Schema 的插件零改动即可获得各层启停开关；有配置 Schema 的插件要用 `x-zhin-config.levels`（`Schema.object({...}).featureLevels(levels, …)`）声明支持的层级后，才会出现在下级层并获得开关，再按字段用 `levels` / `.fieldLevels()` 决定哪些字段可覆盖。官方插件（适配器除外）已全部声明全部四级，由 `tests/contracts/plugin-feature-levels.test.ts` 保证。（2026-11-12 修订：原表述「插件作者零改动即可获得三级启停」与 Console 只列出声明了该层级或无 Schema 的插件的行为矛盾。）
- 启停语义统一为「上级禁用，下级不能开」。
- 配置文件里的 `overrides` 是普通 YAML，手改与 Console 改等价。
