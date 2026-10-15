---
"@zhin.js/workroom": patch
"@zhin.js/cli": patch
---

data-governance（payload vault、disclosure manifest/authority、payload lifecycle）与 `workroom-data-*`、`workroom-payload-*` 运行时装配导出从 `@zhin.js/workroom` 包根移到冻结的 `./data-governance` 子路径（C4c）。这是仅移出包根导出：默认 Workroom 装配（旧 Kernel 路径）仍然创建它们，行为不变，留到 C2 之后处理；新 Room 核心不依赖它们。`LegacyEmbeddedPayloadDetectedError` 与明文载荷拒绝（journal payload composition）仍在包根且行为不变。`@zhin.js/cli` 的导入方改为从子路径导入；没有新增可选加载器（`workroom/*` 目录外只有 type 导入）。
