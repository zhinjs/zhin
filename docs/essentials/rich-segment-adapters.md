# Rich Segment 适配器矩阵

Rich Segment 在 **Adapter.renderSendMessage** 首步由 `resolveRichSegments` 渲染为标准 IM 段；Endpoint 可选 **materializeOutboundMedia** 将 base64/本地文件转为平台 URL。

Install tiers：[Rich media](/getting-started/#install-tierszhinjs-4x)（`@zhin.js/html-renderer`）、[Speech](/getting-started/#install-tierszhinjs-4x)（`@zhin.js/speech`）。

## 内置 kind 与默认 mode

| kind | 默认 mode | 可选 mode |
|------|-----------|-----------|
| `qrcode` | `image` | image, text, origin |
| `html` | `text` | image, text, origin |
| `markdown` | `text` | image, text, origin |
| `tts` | `audio` | audio, text, origin |

## Adapter policy 一览

| Adapter | html | markdown | qrcode | tts | 备注 |
|---------|------|----------|--------|-----|------|
| icqq / napcat / onebot11 / onebot12 / milky | image | image | image | audio | OneBot 系 |
| kook | image | origin | image | audio | 默认 registry + override |
| qq | image | origin | image | audio | QQ 官方 |
| telegram / discord / slack / line | image | image | image | audio | 国际 IM |
| lark / dingtalk / wecom | image | image | image | audio | 国内企微 |
| weixin-ilink | text | origin | image | audio | 微信 iLink |
| wechat-mp | text | text | text | text | 受限出站 |
| satori | image | image | image | audio | 协议适配 |
| email | origin | image | image | text | 邮件 HTML 原样 |
| github | text | text | text | text | 通知文本 |

未列出的 adapter 使用 `OUTBOUND_RICH_SEGMENT_POLICY_IM_DEFAULT`（与 registry 默认一致）。

## 降级行为

- policy `image` 但未装 `@zhin.js/html-renderer` → 降级 `text`（warn once）
- policy `audio` 但未装 `@zhin.js/speech` → 降级 `text`（warn once）
- 平台不支持 audio → adapter policy 设为 `text`

日志：`stage: rich_segment` 含 `kind`、`mode`、`fallback`。详见 [AI 内容链](/advanced/ai-content-chain)。

## 扩展

```typescript
import { OUTBOUND_RICH_SEGMENT_POLICY_IM_FULL } from '@zhin.js/core';

class MyAdapter extends Adapter {
  static override outboundRichSegmentPolicy = OUTBOUND_RICH_SEGMENT_POLICY_IM_FULL;
}
```

CI：`pnpm check:rich-segments` 校验各 adapter 声明 policy 与契约测试文件。
