---
"@zhin.js/console-ui": minor
---

ADR 0063 D28–D33（zhinjs/console#125 第三阶段，组件库一侧），外观有意改变：

- **空状态**：`EmptyState` 改为 64px 线稿插画 + 一句说明 + 至多一个操作。新增 `illustration`（`messages`、`tasks`、`logs`、`table`、`record`、`not-found`、`generic`，1.5px 描边、`brand-text` 单色）与 `action`（`{ label, onSelect?, href?, variant?: 'soft' | 'primary', icon? }` 或元素）；新增 `EmptyIllustration`、`EMPTY_ILLUSTRATIONS`。原有属性不变；没传 `illustration` 时图标改为 `brand-text`，不再是 opacity 0.3 的灰图标。不再单独显示「暂无数据」：只给 `title` 时只显示标题，`empty.noData` 的文案改为「这里还没有内容」/「Nothing here yet」，新增各插画的默认说明。
- **表单**：`Input`、`Textarea`、`SelectTrigger` / `SelectField`、`SearchableSelectField` 新增 `variant="ghost"`（平时无边框，悬停、聚焦或展开时才有边框；类型 `ControlVariant`，新增导出类型 `InputProps`、`TextareaProps`、`SelectTriggerProps`）。新增 `DateField`（`YYYY-MM-DD`）与 `DateTimeField`（`YYYY-MM-DDTHH:mm`）替代原生日期框：本地时间 ISO 值、可清空、键盘操作、`min` / `max`，基于 Popover + 月历，不引入新依赖；新增日期纯函数 `parseDateValue`、`parseDateTimeValue`、`formatDateValue`、`formatDateTimeValue`、`calendarMonth`、`addDays`、`addMonths`。
- **图标**：组件库内的 lucide 图标统一 `strokeWidth 1.75`（原为 2），新增 `CONSOLE_ICON_STROKE_WIDTH`、`CONSOLE_ICON_SIZE`（控件 16、导航 18）。
- **代码标识**：新增 `InlineCode`（`tone`：`subtle` / `plain`）与 `console-code` 类，等宽、极浅底色、无边框；`CodeText` 外观与之相同。
- **焦点与动效**：鼠标操作对话框、菜单、下拉与日期选择后不留焦点环（视觉回归检查）；抽屉、底部抽屉与骨架屏动画只在 `prefers-reduced-motion: no-preference` 下运行。
- **字体**：`--console-font-sans` / `--console-font-mono` 字体栈不变（Inter / JetBrains Mono 优先），文档写明本包不打包字体、由宿主加载。
