---
"@zhin.js/workroom": patch
"@zhin.js/cli": patch
---

scheduler / preemption / priority authority 与 portfolio（journal、admission、capacity control outbox、sponsor、runtime 装配）导出从 `@zhin.js/workroom` 包根移到 `./scheduler`、`./portfolio` 子路径并冻结（C4b）。这是仅移出包根导出：默认 Workroom 装配（旧 Kernel 路径）仍然创建它们，行为不变，留到 C2 之后处理；新 Room 核心不依赖它们。`@zhin.js/cli` 的导入方改为从子路径导入，并新增 `loadWorkroomSchedulerPackage`。
