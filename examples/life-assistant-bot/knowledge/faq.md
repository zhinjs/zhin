# 常见问题

## 如何添加新知识？

在 `knowledge/` 目录下创建 `.md` 文件即可。下次查询时自动发现。

## 如何更换 AI 模型？

在 Console 模型管理中选择聊天 Profile，或在个人 Session 中切换模型；保存后下一回合生效。

## 如何接入真实 IM？

在 `zhin.config.yml` 的 `plugins` 中添加适配器（如 `@zhin.js/adapter-icqq`），
在 `endpoints` 中配置账号信息。详见 [适配器文档](https://zhin.js.org/adapters/)。
