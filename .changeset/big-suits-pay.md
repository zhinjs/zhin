---
"test-bot": patch
"@zhin.js/agent": minor
"@zhin.js/core": minor
"@zhin.js/ai": minor
---

feat: ModelRegistry 模型自动发现与智能选择

- 新增 ModelRegistry：自动发现 Provider 可用模型，Tier 评分（0-100）智能排序
- 支持 Ollama 详细元数据（参数量、量化）和 OpenAI 兼容 API 启发式推断
- 支持 API 聚合/中转服务的 prefix/model-name 格式（如 9router）
- providers.models 配置现为可选 — 框架自动发现并按评分排序
- 新增 chatModel / visionModel 配置项，留空自动选择最优模型
- 自动模型降级：Chat / Vision / Agent 三条路径均支持失败自动切换
- Agent 新增 modelFallbacks 配置和 chatWithFallback() 降级引擎
