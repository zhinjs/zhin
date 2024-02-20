# zhin
## 1. 快速上手
- 安装 & 初始化
```shell
# 1. 安装依赖框架
yarn add zhin # or pnpm add zhin
# 2. 安装适配器(目前已支持qq官方机器人和icqq)
yarn add @zhinjs/qq # 如果你需要使用 icqq , 可安装 @zhinjs/icqq
# 2. 初始化配置文件
npx zhin init -m dev
```
- 填写配置
打开生成在根目录的 `.dev.env` 文件，填入相关环境变量
```text
adapters = qq                             # 使用的适配器，多个适配器可用 “,” 分隔
builtPlugins = commandParser,hmr          # 启用的内置插件列表
pluginDirs = plugins                      # 需要加载哪个本地文件夹下的插件，多个文件夹可用 “,” 分隔
```
- 目前已内置有 `commandParser`、`hmr`、`echo`、`pluginManager` 四个插件，其他插件请关注官方仓库和社区插件


- 启动
- 注意：首次启动会为你生成对应适配器的默认配置文件，需要您完成配置后再次启动
```text
npx zhin -m dev
```

##  插件开发
- 新建文件`testPlugin.js`

```javascript
const {Plugin} = require('zhin')

const testPlugin=new Plugin('test')

// ... 在这儿实现你的逻辑

module.exports=testPlugin
```

### 1.定义指令
```javascript

// 在省略号出调用 testPlugin.command 可以定义一个指令
testPlugin
	.command('/百科 <keyword:string>')
	.action(async(_,keyword)=>{
		const {data}=await axios.get(`https://baike.deno.dev/item/${encodeURIComponent(keyword)}?encoding=text`)
		return data
	})
```
### 2. 定义中间件
```javascript

// 在省略号出调用 testPlugin.middleware 可以往bot中注册一个中间件
testPlugin.middleware((message,next)=>{
	if(!message.raw_message.startsWith('hello')) return next()
    return message.reply('world')
})
```
### 3. 定义服务
- 服务是一个虚拟概念，由插件开发者在插件中声明的特有属性，该属性可暴露给其他插件访问
```javascript

// 在省略号出调用 testPlugin.service 可以定义一个服务
testPlugin.service('foo','bar')

console.log(testPlugin.foo) // 输出 bar
```
- 注意：如果已有之前已加载同名的服务，将不可覆盖已有服务

- 当插件被加载后，后续加载的插件即可访问到该服务
```javascript
const {Plugin} = require('zhin')

const helloPlugin=new Plugin('hello')
console.log(helloPlugin.foo) // 输出bar

module.exports=testPlugin
```
- 可选：定义服务类型
- 开发者为服务添加类型声明后，其他人在使用服务时，将获得类型提示
```typescript
declare module 'zhin'{
    namespace Bot{
        interface Services{
            foo:string
        }
    }
}
```
## 使用插件
```javascript
const {Bot} = require('zhin')
const bot = new Bot({
	// ...
})
bot.mount('[模块名]') // 按模块名称加载插件，将一次查找(./plugins>内置插件>官方插件库>社区插件库>node_modules)目录下对应名称的插件
bot.mount(plugin) // 直接加载对应插件实例
bot.loadFromDir('./plugins', './services') // 加载指定目录下的所有插件，可传入多个目录，将多次加载
bot.loadFromModule('@zhinjs/pluign-guild-manager') // 从模块加载插件，需要你自行安装对应插件包
bot.start()
```
## 卸载插件
```javascript

bot.unmount('[插件名]') // 按插件名卸载对应的插件
bot.unmount(plugin) // 直接卸载对应插件实例
bot.start()

```
