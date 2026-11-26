---
"@zhin.js/agent": patch
---

「先建定时任务、紧接着改时间」不再多弹一次来源确认（#1250 第 107 批，经仓库所有者批准）：Host 自带的 `schedule_add` 和 `schedule_update` 一样带上 `trusted_output` / `untrusted_failure` 标签。它的成功结果只有新任务的 id、带框架格式化时间的固定提示和固定警告，不回显提示词或标签，因此不再算外部内容；调用失败时错误文字仍算外部内容。插件提供的同名工具仍按各自的声明判断。
