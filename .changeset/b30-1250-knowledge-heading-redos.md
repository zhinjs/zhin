---
"@zhin.js/agent": patch
---

知识库标题提取（`markdownHeadings`）改为逐字符扫描，不再使用会在大量连续制表符上回溯的正则（CodeQL js/polynomial-redos）。另外按 CommonMark 处理单独的 `\r` 换行（以前只用 `\r` 换行的文件提取不到标题），只有空白、没有文字的 `#` 行不再被当成标题。
