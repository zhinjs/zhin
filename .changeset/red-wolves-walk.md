---
"@zhinjs/plugin-group-manage": patch
"@zhinjs/plugin-schedule": patch
"@zhinjs/plugin-qa": patch
"@zhinjs/core": patch
"test": patch
"zhin": patch
---

fix: 移除内置数据库，改为提供内置level和redis数据库驱动，用户可根据自身情况自行安装level或redis到本地，选择对应数据库适配器即可
