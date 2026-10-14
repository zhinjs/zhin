---
'@zhin.js/agent': patch
'@zhin.js/cli': patch
'@zhin.js/core': patch
'@zhin.js/interaction': patch
---

修复 IM 审批静默拒绝：审批结果区分「用户拒绝 / 审核器拒绝 / 超时 / 无审批通道」，并以不诱导重试的文案返回给模型；审批提示支持回复 y/同意、n/拒绝；超时不再被当作用户拒绝记忆；owner 读取工作区内 package.json、锁文件等非机密项目文件不再需要确认（.env、密钥等仍需确认，写入审批不变）。
