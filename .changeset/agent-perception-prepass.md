---
'@zhin.js/ai': patch
'@zhin.js/agent': patch
'@zhin.js/cli': patch
---

feat(agent): 多模态感知预处理 `ai.multimodal.perception`。主模型收不了的图片 / 视频 / PDF，由配置的感知模型（如 Gemini Flash-Lite）经 provider 韧性层描述后，以 `[图片描述]` 等不可信外部内容注入，并写入会话历史；按字节 sha256 缓存，每回合有上限，失败回到原占位。描述会让回合进入“已接触外部内容”状态（高危动作需审批），`media_resolution` 事件带上来源模型。不配置时行为不变；配置错误时启动失败，`zhin config check` 同样报错。

fix(agent): 模型 fallback 跳过不支持本回合媒体类型的候选（已接收的图片不会在 fallback 时悄悄变成占位）；带图片的回合仍以绑定的模型（`ai.agents.<name>.model`）为第一候选。
