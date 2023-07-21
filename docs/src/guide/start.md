# 安装 Zhin 机器人

::: tip
阅读本节前，请确认你已正确配置 [Node.js](https://nodejs.org/zh-cn) 环境。
:::

## 创建项目（三选一）

### 1. 通过 cli 指令创建

```shell
# 安装 Zhin cli
npm install -g @zhinjs/cli

# 通过 Zhin 的 cli 初始化项目
zhin init zhin-bot # `zhin-bot` 为你需要创建的项目名

# 安装依赖
cd zhin-bot && npm install
```

### 2. 通过 npm 指令创建

```shell
# 直接使用 npm 命令初始化一个 Zhin 项目，然后根据操作引导即可
npm init zhin
```

### 3. 通过模板仓库创建

::: tip

此方式要求你：

- 能自行解决国内 GitHub 访问受限的问题
- 有自己的 GitHub 账号
- 电脑已安装 `Git` 代码版本管理工具

:::

1. 前往[模板仓库](https://github.com/zhinjs/boilerplate)，点击 `Use this template` 按钮创建一个新的仓库

1. 使用 `git` 命令拉取 GitHub 仓库的代码到本地，并安装依赖

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

::: tip
`node_modules`、`package.json` 等都是由 npm 生成的，**仅开发者**需要了解，可参考 [插件开发](/plugin/start) 一节。
:::

## 添加第一个 Bot

默认情况下，Zhin 没有任何机器人账号，我们需要手动配置后，才能正常使用。

如果你是使用 cli 创建的， Zhin 已经引导你完成了第一个账号的配置，可以跳过当前步
骤。

打开配置文件 `zhin.yaml`，并增加你的机器人信息。

```yaml
adapters:
  icqq: # 指定使用 icqq 适配器
    bots: [] // [!code --]
    bots: // [!code ++]
      - self_id: 12345678 # 机器人账号 // [!code ++]
        platform: 5 # 指定 qq 登录平台为 iPad （可不配置  1：安卓  2：安卓平板  3：手表  4：苹果电脑  5：苹果平板） // [!code ++]
        password: abcdefg # 账号密码 (不配置则使用扫码登录) // [!code ++]
        prefix: '' # 指令调用前缀，可不配置 // [!code ++]
        master: 12345678 # 机器人主人账号 (拥有完整操作该机器人的权限，可不配置) // [!code ++]
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

::: tip
有关 Zhin 的详细配置说明，请前往 [配置](/config/common) 章节。
:::

## 启动

一切准备就绪，开始启动你的项目吧。

```shell
cd [你的项目目录]
npm run start:zhin
```

如上述步骤无误，根据控制台的提示扫码或输入密码即可成功登录。

账号登录成功后，会在根目录下的 `data` 自动生成账号的缓存及相关配置文件。

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
