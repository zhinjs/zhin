# dingtalk-bot
- 钉钉机器人开发SDK
## prepare
1. 前往[钉钉开放平台](https://open-dev.dingtalk.com/fe/app#/corp/app)创建应用
2. 点击创建好的应用，为其添加`机器人`能力![img.png](img.png)
3. 点击凭证与基础信息，获取`clientId`和`clientSecret`![img_2.png](img_1.png)
4. 填写机器人信息，并指定消息接收模式为`Stream模式`![img_1.png](img_2.png)
5. 发布机器人
## install
```shell
npm install node-dd-bot
```
## usage
```javascript
const {Bot}=require('node-dd-bot')
const bot=new Bot({
	clientId:'',
	clientSecret:''
})
bot.on('message.group',(e)=>{
	e.reply('hello world')
})
bot.on('message.private',(e)=>{
	e.reply('hi world')
})
bot.sendPrivateMsg('user_id',[
	'你好呀',
	{
		type:'image',
		url:'https://foo.bar/img.jpg'
	}
])

bot.sendGroupMsg('converationId',[
	'你好呀',
	{
		type:'image',
		url:'https://foo.bar/img.jpg'
	}
])
bot.start()
```
