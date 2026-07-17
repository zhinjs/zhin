# ADR 0050: Next 迁移与 Compatibility 边界

## 状态

Accepted；迁移阶段规范。

## 背景

Greenfield Runtime 已具备 Plugin tree、Feature discovery、generation transaction 和 HMR。旧 Plugin 广泛使用模块级 `usePlugin()` 与 `add*()`；若通过一个全局 facade 原样复刻，旧 registry、隐式当前 Plugin 和不可追踪生命周期会进入新架构，最终无法删除。

## 决策

### D1. Compat 只做纯 Definition 转换

`@zhin.js/next-compat` 可以把旧 callback 参数形状转换为标准新 Feature definition，但不能注册、发现或持有能力。它不提供 `usePlugin()`、`getPlugin()`、Context lookup 或双写。

### D2. 自动迁移必须可静态证明

CLI 使用 TypeScript AST，不执行作者模块。只有 pattern、builder chain、action 和自由变量都属于明确安全子集时才生成 capability 文件。无法证明的项产生带源码位置的 manual diagnostic。

### D3. Extraction 与 Cutover 分离

`migrate --write` 只新增约定式 capability 文件，不修改旧 source、entry 或 manifest。全部目标先预检并写 temporary，再用排他 hard-link 发布；并发目标冲突不会覆盖文件，失败会清理本次输出。

entry/manifest cutover 是后续独立 transaction。这样自动输出可 review，旧版本仍可运行，回滚不依赖反向 codemod。

### D4. TypeScript 是迁移工具的可选 Peer

默认 CLI、Runtime 和 Zhin 安装不携带 TypeScript。只有调用 `@zhin.js/next-cli/migrate` 或 `zhin-next migrate` 的开发环境需要安装 TypeScript peer，避免把编译器体积带入生产闭包。

### D5. 公共 API 进入 Snapshot 门禁

所有 Next package root 与公开 subpath 的 `index.ts` exports 记录在 `packages/next/api-surface.json`。变更 snapshot 必须作为显式架构审查的一部分，避免迁移期间公共面持续漂移。

## 后果

- 可以批量提取简单 Command，同时准确量化 manual backlog。
- 复杂旧能力不会被伪兼容；它们必须迁移为 Token/Resource/Feature。
- extraction 后仍需 package dependency、manifest 和 entry cutover，不将半迁移状态伪装成完成。
- compat 包最终可在旧插件清零后整体删除。
