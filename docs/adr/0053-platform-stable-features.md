# ADR 0053: Platform Stable Features（用户依赖面收敛）

## 状态

Accepted

## 背景

Plugin Runtime 将 Command / Adapter / Component / Middleware 拆成独立 Feature Provider 包（[ADR 0048](./0048-plugin-monorepo-and-feature-provider-packages.md)）。
用户项目若必须在 Root 的 `dependencies` + `zhin.features` 中重复声明这些包，依赖面会膨胀，并与 [ADR 0019](./0019-install-size-layering.md) 的 IM 安装叙事冲突。

## 决策

### D1. Stable Features 写在 `@zhin.js/core`

`@zhin.js/core` 声明 adapter / command / component / middleware 的依赖与 `zhin.features`，并提供 `@zhin.js/core/feature/*` 创作面再导出。直装 core 或经 `zhin.js` 均可继承。

### D2. `zhin.js` 是安装 facade，不直列 Stable Feature 包

`zhin.js`：

- **dependencies**：`@zhin.js/core` + logger / plugin-runtime 等薄封装
- **不**再直列 adapter / command / component（由 core 提供；`zhin.js/command` 经 `@zhin.js/core/feature/command` 再导出）
- **`zhin.plugins`**：声明默认 Host 子插件 `host-router`（`router`）与 `host-api`（`host`），且 **`optional: true`**
- **optional peers**：`host-*` / `html-renderer` / `speech` / `agent` / `ai` / `runtime`

> `host-*` 是 **plugin**（`usePlugin`），进 `zhin.plugins` 而非 `zhin.features`。  
> 若把 Host + html-renderer 提成硬依赖，production 闭包会从 ~8MB 膨胀到 **>100MB**，破坏 ADR 0019；因此保持 optional peer，装了才解析挂载。

### D3. Root 继承规则

当 `zhin.platformFeatures !== false`：

1. **Features**：从 `@zhin.js/core` 继承（直列或经 `zhin.js`）
2. **Plugins**：若 Root 依赖 `zhin.js`，再继承 facade 的 `zhin.plugins`（同 `instanceKey` 以 Root 为准；`optional` 未安装则跳过）
3. 解析：Feature 失败时回退到 core；继承的 child plugin 从 facade 包解析

### D4. `@zhin.js/runtime` 由 CLI 持有

用户项目不必直列 `@zhin.js/runtime`。

## 后果

- 推荐用户装 `zhin.js`：继承 Stable Features；Host / html-renderer 按需加装。
- 进阶用户可只装 `@zhin.js/core`：仅 Stable Features。
- `create-zhin-app` 需要 Console 时写入 host peers + 保证 optional 插件可解析。

## 相关

- [ADR 0019](./0019-install-size-layering.md)
- [ADR 0048](./0048-plugin-monorepo-and-feature-provider-packages.md)
- [ADR 0052](./0052-plugin-runtime-package-boundary.md)
