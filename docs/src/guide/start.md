::: tip
阅读本节前，请确认你以完成[准备工作](/guide/prepare)
:::

# 试试水
## 创建机器人项目
### 通过模板仓库创建

::: tip
此方式需要你能自行解决国内github访问受限的问题

此方式需要你有自己的github账号

此方式需要你电脑已安装`Git`代码版本管理工具
:::
1. [点击此处](https://github.com/zhinjs/boilerplate)前往模板仓库，点击`Use this template`选项，根据模板仓库创建一个属于自己的代码仓库
2. 点击刚刚创建的仓库右上角的clone按钮，复制代码拉取命令
3. 在你电脑上选择一个存放代码的文件夹并打开命令提示符窗口，粘贴代码拉取指令，回车（速度可能会比较慢）
4. 继续在命令提示符窗口执行`cd [你的仓库名] && npm install` 安装项目依赖
5. 使用`npm start` 启动项目
### 通过cli指令创建
1. 全局安装`@zhinjs/cli`
```shell
npm install -g @zhinjs/cli
```
2. 使用cli指令`zhin init [projectName]`初始化项目(若未传`projectName`，将已当前文件夹名作为项目名)
3. 根据提示进入项目目录并安装项目依赖
4. 使用`zhin start`启动项目
### 手动创建
1. 新建或选择一个文件夹作为项目文件夹
2. 在该文件夹打开命令提示符窗口，使用`npm init -y`将当前文件夹初始化为一个项目
3. 使用`npm install @zhinjs/cli --save-dev`将`@zhinjs/cli`添加为项目开发依赖
4. 使用cli指令`zhin init`初始zhin
5. 使用`zhin start`启动项目