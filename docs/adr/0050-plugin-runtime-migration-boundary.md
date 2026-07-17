# ADR 0050: Plugin Runtime 迁移与 Compatibility 边界

## 状态

Accepted；迁移阶段规范。

## 背景

Greenfield Runtime 已具备 Plugin tree、Feature discovery、generation transaction 和 HMR。旧 Plugin 广泛使用模块级 `usePlugin()` 与 `add*()`；若通过一个全局 facade 原样复刻，旧 registry、隐式当前 Plugin 和不可追踪生命周期会进入新架构，最终无法删除。

## 决策

### D1. 不发布 Compat Runtime

CLI 对可静态证明的 callback 直接生成原生 `defineCommand()` / `defineMiddleware()`
definition。无法证明的语义由迁移 Skill 改写为显式 Resource/Context；不发布 legacy adapter。

### D2. 自动迁移必须可静态证明

CLI 使用 TypeScript AST，不执行作者模块。只有模块顶层注册、静态 identity、callback/render 形状和自由变量都属于明确安全子集时才生成 Command、Middleware 或 Component 文件。无法证明的项产生带源码位置的 manual diagnostic。

### D3. Extraction 与 Cutover 分离

`migrate --write` 只新增约定式 capability 文件，不修改旧 source、entry 或 manifest。全部目标先预检并写 temporary，再用排他 hard-link 发布；并发目标冲突不会覆盖文件，失败会清理本次输出。

entry/manifest cutover 由 `migrate cutover --check|--write` 承担。它从 capability 目录推导 Feature dependency，以原 `package.json` 文本做乐观并发校验，排他发布正式 `plugin.ts`，最后原子替换 manifest。manifest 是 commit record；内容一致的 prepared entry 可以安全重试。这样自动输出可 review，旧版本仍可运行，回滚不依赖反向 codemod。

### D4. TypeScript 是迁移工具的可选 Peer

默认 Runtime 和 Zhin 安装不携带 TypeScript。只有调用 `zhin runtime migrate` 的开发环境
需要安装 TypeScript peer，避免把编译器体积带入生产闭包。

### D5. 公共 API 进入 Snapshot 门禁

所有 Plugin Runtime package root 与公开 subpath 的 `index.ts` exports 记录在
`tests/snapshots/plugin-runtime-api.json`。变更 snapshot 必须作为显式架构审查的一部分。

## 后果

- 可以批量提取简单 Command、Middleware 和 Component，同时准确量化 manual backlog。
- 复杂旧能力不会被伪兼容；它们必须迁移为 Token/Resource/Feature。
- extraction、cutover、双版本行为对照仍是三个明确阶段，不将半迁移状态伪装成完成。
- runtime 不承担旧 callback 兼容成本；迁移 Skill 是旧代码升级入口。
