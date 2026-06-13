# 常见问题

## 如何添加新知识？

在 `knowledge/` 目录下创建 `.md` 文件即可。下次查询时自动发现。

## 如何更换 AI 模型？

修改 `zhin.config.yml` 中 `ai.agents.zhin.model` 字段。

## 如何接入真实 IM？

在 `zhin.config.yml` 的 `plugins` 中添加适配器（如 `@zhin.js/adapter-icqq`），
在 `endpoints` 中配置账号信息。详见 [适配器文档](https://zhin.js.org/adapters/)。
