---
'@zhin.js/agent': patch
---

原生文件工具不再淹没上下文：grep/glob 默认跳过 node_modules、.git、.opencode、.zhin、dist、coverage 等目录并遵循 .gitignore（路径直接指向这些目录时仍可搜索）；grep 拒绝 `.*`、`^` 等匹配所有行的模式并给出改用 read_file / glob / list_dir 的提示，跳过二进制与超大文件；grep 匹配数、输出字节、单行长度，glob 文件数，list_dir 条目数与 read_file 行数均有上限，截断时提示如何缩小范围或继续读取。
