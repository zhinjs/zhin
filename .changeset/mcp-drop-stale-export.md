---
"@zhin.js/mcp": patch
---

移除指向不存在模块的 `./adapter-tools-helper` 子路径导出：发布包里从未包含 `lib/adapter-tools-helper.js`，导入该子路径只会得到 `ERR_MODULE_NOT_FOUND`。
