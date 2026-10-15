# @zhin.js/plugin-reminder

## 1.0.1

### Patch Changes

- 681abf3: 补齐 ScheduleContext，保留命名目录定时任务并使用现有持久状态保存业务数据。

  新增持久提醒与公开插件测试夹具，完善群运营的关键词、欢迎和状态卡片；统一 CLI 与 Console Host 的安装状态、应用计划和显式业务验证。

  增加目标端点渲染预览、实际出站降级诊断与过期交互反馈，修复已加载插件入口变更被误判为进程重启的问题。

  收紧验证计划与 Console 凭据的访问边界，修复插件安装计划、更新校验、handler 打包、跨进程配置锁及预览取消；完善流式测试载荷、词库容量、线程查询和重叠统计刷新回归。

- a3a7b53: Add Agent skill `reminder` and tools `reminder_create` / `reminder_list` / `reminder_cancel` over the existing ReminderService. Document when to use personal reminders versus native `schedule_add`.
  - @zhin.js/skill@1.1.5
  - @zhin.js/tool@1.1.5
