---
"@zhin.js/command": patch
---

`CommandIndex.execute()` 不再因为没有入站来源而对声明了 `execution` 的命令一律返回 `operation_unavailable`：程序化调用按命令维度应用 `maxConcurrent` / `cooldownMs`（不做发送者预算，也不发送进度提示），并在执行结束时释放。权限 permit 检查仍保持 fail-closed，`dispatch` 行为不变。
