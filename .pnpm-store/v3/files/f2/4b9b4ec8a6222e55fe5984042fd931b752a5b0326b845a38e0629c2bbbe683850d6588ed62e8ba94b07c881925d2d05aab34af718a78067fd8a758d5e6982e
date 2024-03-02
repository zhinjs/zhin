# icqq

[![npm version](https://img.shields.io/npm/v/icqq/latest.svg)](https://www.npmjs.com/package/icqq) [![dm](https://shields.io/npm/dm/icqq)](https://www.npmjs.com/package/icqq) [![node engine](https://img.shields.io/node/v/icqq/latest.svg)](https://nodejs.org) [![group:860669870](https://img.shields.io/badge/group-860669870-blue)](https://jq.qq.com/?_wv=1027&k=xAdGDRVh) [![discord](https://img.shields.io/static/v1?label=chat&message=on%20discord&color=7289da&logo=discord)](https://discord.gg/D7T7wPtwvb)

- QQ（安卓）协议基于 Node.js 的实现，支持最低node版本为 v14
- 若你不熟悉 Node.js 或不会组织代码，可通过 [template](https://github.com/icqqjs/icqq-template)或[demo](./demo) 创建一个简单的应用程序
- [Type Docs](https://icqqjs.github.io/icqq/docs/)（文档仅供参考，具体类型以包内d.ts声明文件为准）
- [从 OICQ v1.x 升级](https://github.com/takayama-lily/oicq/projects/3#column-16638290)（v1 在 OICQ 的 master 分支）
- 如果你仍在使用 OICQ v1.x，又不想升级，可以使用 [oicq-icalingua-plus-plus](https://github.com/icalingua-plus-plus/oicq-icalingua-plus-plus)

ICQQ 是 [OICQ](https://github.com/takayama-lily/oicq) 的分支。ICQQ 的存在少不了 OICQ 作者 [takayama-lily](https://github.com/takayama-lily) 与 OICQ 的其它贡献者们，在此特别鸣谢！

---

## 与oicq2的差异

- `createClient`将不再传递uin，改为在`login`时传入，如果你希望密码登录，请**一定**参考[密码登录教程](https://github.com/icqqjs/icqq/wiki/%E5%AF%86%E7%A0%81%E7%99%BB%E5%BD%95%E6%B5%81%E7%A8%8B)
- 支持频道(基础的消息收发能力)
- 支持群精华消息的添加和移除
- 消息类型添加ForwardElem
- 支持监听指定群/好友的消息

**安装:**

```bash
> npm i icqq  # or > yarn add icqq
```

**快速上手:**

```js
const { createClient } = require("icqq");
const client = createClient({ platform: 3, ver: '2.1.7', sign_api_addr: 'http://127.0.0.1:8080/' });

client.on("system.online", () => console.log("Logged in!"));
client.on("message", e => {
  console.log(e);
  e.reply("hello world", true); //true表示引用对方的消息
});

client.on("system.login.qrcode", e() => {
    //扫码后按回车登录
    process.stdin.once("data", () => {
      client.login();
    });
  })
client.login();
```

注意：

- 扫码登录仅能使用Watch协议登录下进行，如需扫码登陆，请在creatClient时按照上方示例代码传入platform，其他协议暂时无法登陆
- 建议使用密码登录，只需验证一次设备便长期有效 [密码登录教程](https://github.com/icqqjs/icqq/wiki/%E5%AF%86%E7%A0%81%E7%99%BB%E5%BD%95%E6%B5%81%E7%A8%8B)

**声明：**

- 本项目为协议实现，不推荐直接使用。

- 想开发机器人的新用户推荐使用[zhin](https://github.com/zhinjs/zhin)框架开发。
- CQHTTP 用户建议使用[onebots](https://github.com/lc-cn/onebots)，该项目同时支持OneBot V11 和OneBot V12。
- 云崽用户想迁移到icqq，可参考[Miao-Yunzai](https://github.com/yoimiya-kokomi/Miao-Yunzai)，该分支使用icqq来代替oicq

**鸣谢：**

- [oicq](https://github.com/takayama-lily/oicq) icqq原来的仓库
- [oicq-guild](https://github.com/takayama-lily/oicq-guild) 将其频道的api移植到icqq上
- [oicq-icalingua-plus-plus](https://github.com/icalingua-plus-plus/oicq-icalingua-plus-plus) 参考了该分支上登录协议相关的pr

**其他：**

- [QQWebApi](./web-api.md) QQ Web Api 收集整理 (途中)
- [TXHook](https://github.com/fuqiuluo/TXHook) 抓包工具推荐 **参与贡献：**

- [贡献指南](./CONTRIBUTING.md)
