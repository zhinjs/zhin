---
"zhin.js": patch
---

Console 群聊插话状态（`plugin.root.ambient` RPC）返回值新增可选字段 `judgeToday`（`YYYY-MM-DD`）：实例时钟在 `judgeTimeZone` 下的今天，与 `judgeDaily` 按同一 `dayKeyOf` 切天，没有任何判断调用时也返回（#1250 第 48 批）。Console 的「最近 7 天」窗口应以它为准（保留截止日 = `judgeToday` 往前 6 天），不再用浏览器时钟推算，避免浏览器与实例时钟有偏差时漏掉实例上的今天、或把已清理的日期显示成 0。
