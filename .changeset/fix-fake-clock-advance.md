---
"@zhin.js/testing": patch
---

`FakeClock.advance()` 在某个 cron 任务抛错时仍会把时钟停在目标时间（try/finally）；该窗口内剩余未执行的任务会被跳过而不是延后补跑，错误照常向上抛出。
