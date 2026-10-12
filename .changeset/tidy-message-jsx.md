---
"@zhin.js/jsx": patch
"@zhin.js/core": patch
"zhin.js": patch
"@zhin.js/components": patch
"create-zhin-app": patch
---

修正 JSX 的默认语义为消息排版：内置小写标签无需导入并提供属性类型，标签与属性映射为 Segment；只有显式 html / Html 子树序列化为 HTML。支持注册组件标签、原生 share 与平台 card，以及 Button onClick 回跳与返回值自动回复；同步脚手架、示例和文档。
