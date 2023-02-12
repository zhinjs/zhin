::: tip
阅读本节前，请确认你以完成[准备工作](/guide/prepare)
:::

# 试试水
## 项目构建(三选一)
### 1. 通过cli指令构建
1. 全局安装`@zhinjs/cli`
```shell
# 安装zhin cli
npm install -g @zhinjs/cli

# 通过cli初始化项目
zhin init zhin-bot # `zhin-bot`为你需要创建的项目名

# 安装依赖
cd zhin-bot && npm install

```
### 2. 通过npm指令构建
1. 直接使用npm命令初始化一个zhin项目
```shell
npm init zhin
```
然后根据操作引导即可
### 3. 通过模板仓库构建

::: tip
此方式需要你能自行解决国内github访问受限的问题

此方式需要你有自己的github账号

此方式需要你电脑已安装`Git`代码版本管理工具
:::
1. [点击此处](https://github.com/zhinjs/boilerplate)前往模板仓库，点击`Use this template`选项，根据模板仓库创建一个属于自己的代码仓库
2. 使用`git`命令拉取仓库代码并安装依赖
```shell
# 拉取仓库代码
git clone https://gitbub.com/[你的github用户名]/[仓库名].git

# 安装依赖
cd [仓库名] && npm install

```
## 项目结构
构建完成后，我们可在项目文件夹下看到如下结构
```tex
.
├─ data/              资源目录
├─ plugins/           插件目录（存放编写好的插件）
├─ zhin.yaml          配置文件
├─ node_modules/      项目依赖存放文件(npm自动生成，开发者无需关心)
├─ package.json       项目描述文件(一般情况下无需关心)
└─ package-lock.json  项目依赖描述文件(npm自动生成，开发者无需关心)
```
其中例如 node_modules、package.json 等都是 npm 生成的，后面在[插件开发](/plugin/start)中会讲到。

如果你不准备开发插件，就不用去关心这些 依赖文件，感兴趣你也可以先使用搜索引擎查找相关知识。
## 添加第一个bot
默认zhin不会有任何机器人，我们需要手动添加机器人配置后，才能正常使用。

如果你是使用cli创建的， zhin已经引导你完成了第一个账号的配置，可以跳过当前步骤
打开配置文件`zhin.yaml`,并增加你的机器人信息
```yaml

adapters: 
  icqq: # 指定使用icqq适配器
    bots: [] // [!code --]
    bots: // [!code ++]
      - self_id: 147258369 # 机器人账号 // [!code ++]
        platform: 5 # 指定qq登录平台为iPad（可不配置  1：安卓  2：安卓平板  3：手表  4：苹果电脑  5：苹果平板） // [!code ++]
        password: abcdefg # 账号密码(不配置则使用扫码登录) // [!code ++]
        prefix: '' # 指令调用前缀，可不配置 // [!code ++]
        master: 1659488338 # 机器人主人账号(拥有完整操作该机器人的权限，可不配置) // [!code ++]
        admins: [] # 机器人管理员账号(可不配置) // [!code ++]
plugins:
  config: null
  daemon: null
  help: null
  login: null
  logs: null
  plugin: null
  status: null
  watcher: /path/to/zhin-bot
log_level: info
plugin_dir: plugins
data_dir: data
delay:
  prompt: 60000
```
:::tip
要了解zhin配置，请前往[配置](/config/common)
:::
## 启动
一切准备就绪，开始启动你的项目吧。如果你是本地安装，就要使用`npx zhin start`启动项目。
```shell
zhin start
```
如上述步骤无误，根据控制台的提示扫码或输入密码即可成功登录。
账号登录成功后，会在根目录下的`data`自动生成账号的缓存及相关配置文件。
## 测试一下
正常启动后，往机器人发送第一条消息，测试一下是否正常吧
<ChatHistory>
  <ChatMsg id="1659488338">help</ChatMsg>
  <ChatMsg id="1689919782">
    help [command:string] 查看某个指令的帮助文档<br/>
    output &lt;msg:any&gt;回复“帮助 指令名”以查看对应指令帮助。
  </ChatMsg>
  <ChatMsg id="1659488338">output hello world</ChatMsg>
  <ChatMsg id="1689919782">hello world</ChatMsg>
</ChatHistory>