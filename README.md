<div style="text-align: center">

# zhin
基于icqq的简约机器人框架


</div>
## 快速上手

1.安装脚手架
```shell
npm install -g @zhinjs/cli
# or 二选一即可
npm install @zhinjs/cli && npm link @zhinjs/cli
```

2. 使用cli指令`zhin init [projectName]`初始化项目

选择一个本地文件夹作为项目目录执行`zhin init`

或直接在想要建立项目的目录执行`zhin init <projectName>`
> 两者的区别 带项目名则新建目录作为项目目录，不带项目名则将当前目录作为项目目录

根据提示完成zhin初始化操作

3. 使用cli指令`zhin start`启动项目

4. 更改插件配置

启动完成后，默认只启用了`help`,`daemon`,`watcher`插件
若你在初始化时选择了安装其他官方插件，请打开项目根目录下的`zhin.yaml`
按照配置文件中的<span style="color:yellow">`plugins`</span>字段增加配置，其中key为插件名，对应value为配置，知音会自动加载对应插件
> <p style="color:red">即使该插件没有配置，也需要配置其value为null，因为zhin是按配置文件加载插件的，未在plugins中配置的插件不会加载</p>

5. 编写插件

请先根据[cli文档](https://github.com/zhinjs/cli#readme)
使用`zhin new <pluginName>`新建一个插件，并更改模板中的初始代码后，重复第四步，添加该插件的配置
插件添加后 在插件更改时，zhin将会自动重载该插件，无需重启项目