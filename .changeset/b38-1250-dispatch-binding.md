---
"@zhin.js/feature-kit": patch
"@zhin.js/command": patch
"@zhin.js/core": patch
---

中间件 / handler 里 `context.project<CommandIndex>(commandFeatureId).dispatch({ input, source: context.input })` 不再抛 `Message author binding belongs to another generation operation`（#1250 第 38 批）：命令表是按投影时的快照视图建的，和消息操作实际运行的已提交快照不是同一个对象；未显式传 `snapshot` 时，`dispatch` 改用 `source` 消息自己的操作快照（新的内部钩子 `readOperationInputSnapshot`），并带上该操作的资源。命令仍以原消息的真实发送者执行并照常检查 `permit`；传入别的快照、或拿着不属于该消息 generation 的命令表调用，仍然拒绝，报错会说明应在当前上下文里调用 `context.project()`。
