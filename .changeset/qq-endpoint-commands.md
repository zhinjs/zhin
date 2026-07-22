---
"@zhin.js/adapter-qq": minor
---

恢复 legacy 的聊天命令添加 endpoint 能力（随适配器发布）：`qq endpoint add [name]`（手机 QQ 扫码绑定 → 凭据写 `.env` 的 `QQ_<NAME>_APPID/SECRET` → 追加 `plugins.qq.endpoints` 配置，重启生效）、`qq endpoint cancel`（中止绑定）、`qq endpoint list`（运行中 + 配置内 endpoints）、`qq endpoint remove <name>`（移除配置项）。add/cancel/remove 受 `master` 限制（顶层或 `endpoints[i]` 声明时仅 master 可执行，未配置则放行）；schema 新增顶层共享字段 `master`。绑定协议（create_bind_task / poll_bind_result / AES-256-GCM 解密）自 legacy 移植，二维码当前以链接文本下发（QQ 出站富媒体待迁移）。
