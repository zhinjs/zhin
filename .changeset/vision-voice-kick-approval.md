---
"@zhin.js/agent": patch
"@zhin.js/runtime": patch
"@zhin.js/cli": patch
"@zhin.js/speech": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter": patch
"@zhin.js/plugin-content-moderation": patch
"@zhin.js/tool": patch
"@zhin.js/ai": patch
"@zhin.js/core": patch
---

支持多模态感知备用模型和 ICQQ 原创表情识图；增强语音回复的使用指引与错误提示，让已启用的 TTS 回复无需逐次审批。ICQQ 踢人工具使用 human 策略，每次都要求独立人工审批，不能由自动审核或历史授权替代。

内容审核支持按账号和群显式开启广告、辱骂审核：提醒、警告、10 分钟禁言，通知通过 @ 对应成员说明处理结果，30 分钟无新违规重置；提醒/警告是否撤回原消息由模型结合上下文决定。入群 10 分钟内的明确广告可直接踢出，执行前刷新权限和入群时间；审核、通知或平台操作结果不确定时不盲目重试。
