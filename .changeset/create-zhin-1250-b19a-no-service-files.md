---
"create-zhin-app": minor
---

#1250 第 19a 批（ADR 0062 §2）：新项目不再生成 `<name>.service`、`com.zhinjs.<name>.plist`、`install-service.ps1`、`<name>-task.xml`，也不再加入 PM2；需要开机自启时运行 `npx zhin service install`。PM2 改为可选：`--with pm2`。8068 端口被占用时（例如同一台机器上另一个 Zhin 项目正在运行）改用其后第一个空闲端口，并说明占用者是不是 Zhin 网关。
