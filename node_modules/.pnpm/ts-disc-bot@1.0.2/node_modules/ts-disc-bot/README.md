# ts-disc-bot
Discord 机器人开发SDK
## prepare
1. 前往 `Discord 开发者平台`([https://discord.com/developers/applications](https://discord.com/developers/applications)) 创建应用
2. 进入刚刚创建的应用，切换到 `OAuth2` 选项卡下的 `URL Generator` 勾选如下权限 ![img_1.png](img_1.png)
3. 复制生成的授权Url，在浏览器打开，将机器人加入到你的频道
4. 切换 `Bot` 选项卡，点击`Reset Token`，并记录下获取到的`Bot Token`![img.png](img.png)
5. 为机器人开启 `PRESENCE INTENT`、`SERVER MEMBERS INTENT`、`MESSAGE CONTENT INTENT`![img_2.png](img_2.png)

## install
```shell
npm i ts-disc-bot
```
## usage
```javascript
const {Bot, Intents}=require('ts-disc-bot')
const bot=new Bot({
    token:'', // prepare 第四步获取到的 Bot Token
    intents:Intends.GUILDS|
        Intends.GUILD_MEMBERS|
        Intends.GUILD_MESSAGES|
        Intends.MESSAGE_CONTENT|
        Intends.DIRECT_MESSAGE,
    proxy:{ // 本地代理，国外用户忽略
        host:'127.0.0.1',
        port:7890
    }
})
bot.on('message.guild',(e)=>{
	e.reply('hello world')
})
bot.on('message.direct',(e)=>{
	e.reply('hi world')
})
bot.start()
```
