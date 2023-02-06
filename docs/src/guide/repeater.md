::: info
通过本节的阅读，你将了解到如何新建一个插件、使用zhin提供的api实现一些简单的小功能，以及插件的发布
:::

zhin的插件共分为 `本地插件` 和 `npm 插件` 两大类。

- 本地插件

本地插件将全部存放在根目录的 plugins 下。
所有由你自己编写，并 仅供个人使用 的插件就可以称为本地插件。

- npm 插件

npm 插件都是直接使用 `npm i` 命令安装，存放在 `node_modules` 目录下。
是由我或者其他开发者编写，上传至 `npmjs` 平台，为 **所有使用 zhin 框架的人** 提供服务。

还记得在初始化项目时输入的 `zhin init` 么，在界面会有一个选择安装插件的步骤，那些插件就全部属于 `npm 插件`。

如果你对 npmjs 并不了解也没关系，在这里只会介绍本地插件的编写。
但是如果你想对 zhin 有一个更深入的了解，还是需要熟悉 nodejs 及 npmjs 的基本原理。
# 写个复读🐔
到目前为止，我们虽然让zhin运行起来了，但除了内置插件外，还没有任何功能，接下来，让我们通过实现一个复读机的小功能，来初步了解下zhin插件开发的大体流程：
## 1. 创建插件(二选一)
### 1. cli创建
 - 此方式需要你安装了zhin脚手架`@zhinjs/cli`

```shell
zhin new repeater # 此处repeater为插件名
# or
zhin new repeater -t # 如果你想使用TS进行开发，可增加`-t`选项，声明需要创建TS插件
```
### 2. 手动创建
```shell
# 进入插件目录
cd plugins 

#创建一个存放插件的目录
mkdir repeater

#创建入口文件
touch index.js
```
完成创建后，插件目录大体如下：
::: code-group
```text [手动创建]
plugins/
└─ repeater/                 test 插件
   ├─ index.js           程序主入口
   └─ package.json       包管理文件 (可选)
```
```text [cli创建]
plugins/
└─ repeater/                 test 插件
   └─ src/                 资源目录 插件
      ├─ index.ts           程序主入口
      └─ package.json       包管理文件 (可选)
```
:::

::: warning
除非你创建了 package.json ，否则 index 文件名 不能随意更改 ，不然会导致插件无法被检索。
:::
打开入口文件，并输入如下内容
::: code-group
```js [index.js]
module.exports={
    name:'repeater',
    install(ctx){
    }
}
```
```ts [src/index.ts]
import {Context} from 'zhin';
export const name='repeater';
export function install (ctx:Context){
}
```
:::
这个时候你就已经写好了一个插件，不需要任何额外操作，不过目前这个插件还什么都不能干，我们没有为其编写相应的交互逻辑。
## 2. 实现插件交互逻辑

相信你这个时候一定有很多疑问，因为这其中涉及到相当多的概念，`Plugin` 到底是什么？
:::info
当前章节仅提供示例，目的在于让你能自己编写出可以进行简单交互的插件。
目前你无需关心这段代码是什么意思，后面会逐一介绍，所以不用着急，让我们继续。
:::
你可以参考下列代码段，在[上下文](/api/context)上添加一个[中间件](/api/middleware)，拦截[消息会话](/api/session)，并将[消息元素](/interface/element)原封不动回复给用户
::: code-group
```js [index.js]
module.exports={
    name:'repeater',
    install(ctx){
        ctx.middleware(async (session,next)=>{
            await session.reply(session.elements)
            next()
        });
    }
}
```
```ts [src/index.ts]
import {Context} from 'zhin';
export const name='repeater';
export function install (ctx:Context){
    ctx.middleware(async (session,next)=>{
        await session.reply(session.elements)
        next()
    });
}
```
:::

### 测试一下

<ChatHistory>
  <ChatMsg id="1659488338">hello</ChatMsg>
  <ChatMsg id="1659488338">...</ChatMsg>
</ChatHistory>
谔谔 为啥没效果呢？因为插件还未被启用，现在，我们来启用插件

## 3.启用插件
在配置文件`zhin.yaml`中声明该插件，zhin则会自动载入该插件
```yaml [zhin.yaml]
adapters: 
  icqq: # 指定使用icqq适配器
    bots:
      - uin: 147258369 # 机器人账号 //
        platform: 5 # 指定qq登录平台为iPad（可不配置  1：安卓  2：安卓平板  3：手表  4：苹果电脑  5：苹果平板
        password: '你的机器人密码' # 账号密码(不配置则使用扫码登录)
        prefix: '' # 指令调用前缀，可不配置
        master: 1659488338 # 机器人主人账号(拥有完整操作该机器人的权限，可不配置)
        admins: [] # 机器人管理员账号(可不配置)
plugins:
  config: null # 指定启用配置管理插件
  daemon: null # 指定启用守护进程插件
  help: null # 指定启用帮助插件
  login: null # 指定启用命令行登录插件
  logs: null # 指定启用日志插件
  plugin: null # 指定启用插件管理插件
  status: null # 指定启用状态查看插件
  watcher: plugins # 指定启用文件监听插件
  repeater: null # 指定启用复读机插件 // [!code ++]
log_level: info # 指定日志等级
plugin_dir: plugins # 指定本地插件存放目录
data_dir: data # 缓存文件存放目录
delay:
  prompt: 60000 # prompt方法超时时间为1分钟(60*1000毫秒)
```
### 再试试
<ChatHistory>
  <ChatMsg id="1659488338">hello</ChatMsg>
  <ChatMsg id="1689919782">hello</ChatMsg>
</ChatHistory>

## 4.编译插件 (可选)
::: tip
在发布插件前，若你使用TS开发插件，推荐先编译为JS可用的插件。否则，该插件将不能在JS环境下执行
:::
- 你可以使用指令`zhin build [pluginName]`编译TS开发的插件为JS插件
- 现在，执行以下命令，将TS插件编译为JS插件吧
```shell
zhin build repeater
```
## 5.发布插件
- 在插件开发完成后，若你有意愿公开你的插件，你可使用`zhin pub [pluginName]`发布本地指定插件名的插件到`npmjs`供他人使用
::: info
若插件名与`npmjs`已有包冲突，将无法发布，可尝试修改插件名，重新发布
:::
- 现在，执行以下命令，将发布你的第一个zhin插件到`npmjs`吧
```shell
zhin pub repeater
```