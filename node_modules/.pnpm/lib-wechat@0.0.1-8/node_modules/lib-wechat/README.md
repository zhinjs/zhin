## lib-wechat

1. nodejs端的lib-wechat 实现
2. 按照icqq的规范，实现了的部分接口

## 使用样例

1. 安装依赖：

```shell
npm install lib-wechat --save
```

2. 引入：

```javascript
const {Client} = require('lib-wechat');
const client = new Client();
client.start()
client.on('message', (e) => {
    console.log(e);
    if (e.message === 'hello') {
        e.reply('world');
    }
})
```

## 感谢

1. [icqq](https://github.com/icqqjs/icqq) 提供参考代码

## 申明

1. 本仓库使用MIT协议开源，使用本仓库代码，请遵守MIT协议
2. 本仓库代码仅供学习交流，不得用于商业用途
3. 开源项目，造成的任何后果，本人不负任何责任
