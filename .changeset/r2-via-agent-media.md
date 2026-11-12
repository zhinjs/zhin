---
"@zhin.js/agent": patch
---

`ai.imageStorage`（Cloudflare R2）的上传改由 `@zhin.js/agent-media/core` 的 S3 存储实现，不再直接依赖 `aws4fetch`。配置格式、对象命名、公开 URL、25 MiB 上限、只允许 PNG / JPEG / GIF / WebP 的规则，以及只把精确的自有地址视为已发布图片的判断，都保持不变。
