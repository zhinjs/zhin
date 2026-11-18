---
"@zhin.js/client": patch
---

内嵌的 `AdapterConsolePage` 在宿主接管账号（`hostAccounts`）时，不再渲染空的页面导航和空的账号区块。原来这两个空元素各占一个区块间距，Console 的「管理连接」区块因此多出约 48px 空白。
