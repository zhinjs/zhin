---
'@zhin.js/agent': patch
---

Make the canonical Turn Tool Runtime enforce file and Bash policy before execution. File writes, sensitive reads, unsafe shell commands, shell mutations, and shell reads of sensitive paths now use the shared policy facade and fail closed from authenticated Turn principal roles.
