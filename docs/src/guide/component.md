<!--本页内容由@github.com/taidixiong233编辑于2023年2月5日-->
# 组件

- zhin 提供了组件以增加代码的复用性，zhin 的组件系统在一定程度上参考了 Vue.js 的语法，从而实现了高易学性和一定的移植性
- 在组件中，你可以直接获取到当前会话的一些变量，这类似于 vue 的 vuex，是根据会话产生环境自动生成的

## 文本插值

- 首先我们来看数据绑定，最基本形式是使用“Mustache”语法（双花括号）的文本插值：
  <ChatHistory>
  <ChatMsg id="1659488338"><span v-pre>send {{session.sender.user_id}}</span></ChatMsg>
  <ChatMsg id="1689919782">1659488338</ChatMsg>
  </ChatHistory>
  可以看到，在使用文本插值后，可以很快速的让机器人输出信息，我们来看在实际运行中的一个 demo

<ChatHistory>
  <ChatMsg id="1659488338"><span v-pre>send [日志][用户:{{session.sender.nickname}}({{session.sender.user_id}})]是一个来自{{session.sender.area == ""?"未知":sender.area}}的{{session.sender.age}}岁{{session.sender.sex == "unknown"?"人妖":sender.sex}}</span></ChatMsg>
  <ChatMsg id="1689919782">[日志][用户:master(1659488338)]是一个来自四川的26岁male</ChatMsg>
</ChatHistory>

## image 标签

- image 标签提供了一种快速发送照片的方法，请看下面的例子
  <ChatHistory>
  <ChatMsg id="1659488338"><span v-pre>send &lt;image src="https://maohaoji.com/image标签.gif"/&gt;</span></ChatMsg>
  <ChatMsg id="1689919782"> <!--  image标签示例图片由taidixiong233提供 github.com/taidixiong233 !--><img alt="" style="height:100px" src="https://maohaoji.com/image标签.gif" /></ChatMsg>
  </ChatHistory>
  可以看到，使用 src 标签可以很快的发送想要发送的图片，下面我们来看一个使用 image 标签获取用户头像的实例
  <ChatHistory>
  <ChatMsg id="1659488338"><span v-pre>send &lt;image :src="`https://q1.qlogo.cn/g?b=qq&nk=${sender.user_id}&s=100`"/&gt;</span></ChatMsg>
  <ChatMsg id="1689919782"> <!--  image标签示例图片由taidixiong233提供 github.com/taidixiong233 !--><img alt="" style="height:100px" src="https://q1.qlogo.cn/g?b=qq&nk=1659488338&s=100" /></ChatMsg>
  </ChatHistory>
  ps 这里的:src 代表此处使用变量为src赋值，在 zhin 中，不支持v-bind代替这个语法，请注意与vue的区别;session可选字段参考`Session`

## template 标签

- template 标签主要是更加规范和语义化，在 zhin 中可以对元素进行分组
  下面这个例子可以体现 template 对元素的分组

  ps &lt;random&gt;会随机输出内部元素，所以实际输出不一定是图示
  <ChatHistory>
  <ChatMsg id="1659488338"><span v-pre>
  send 你喜欢&lt;random&gt;<br />
  &lt;template&gt;御姐&lt;/template&gt;<br />
  &lt;template&gt;萝莉&lt;/template&gt;<br />
  &lt;/random&gt;
  </span></ChatMsg>
  <ChatMsg id="1689919782"> <!--  image标签示例图片由taidixiong233提供 github.com/taidixiong233 !-->
  <span>你喜欢萝莉</span>
  </ChatMsg>
  </ChatHistory>

  下面这个例子可以体现使用 template 便签的美观性
  <ChatHistory>
  <ChatMsg id="1659488338"><span v-pre>
  send &lt;template&gt;<br />
  今日图片<br />
  &lt;image src="https://maohaoji.com/image标签.gif"/&gt;<br />
  欢迎您{{session.sender.nickname}}({{session.sender.user_id}})<br />
  &lt;image :src="`https://q1.qlogo.cn/g?b=qq&nk=${sender.user_id}&s=100`"/&gt;<br />
  &lt;/template&gt;<br />
  </span></ChatMsg>
  <ChatMsg id="1689919782"> <!--  image标签示例图片由taidixiong233提供 github.com/taidixiong233 !-->
  <span>今日图片</span>
  <img alt="" style="height:100px" src="https://maohaoji.com/image标签.gif"/>
  欢迎您 master(1659488338)
  <img alt="" style="height:100px" src="https://q1.qlogo.cn/g?b=qq&nk=1659488338&s=100"/>
  </ChatMsg>
  </ChatHistory>

## random 标签

- 相比于手动使用 Math.random()获取随机数然后输出元素，使用 random 随机输出元素的效率以及代码量、可读性都有不错的改善

ps random 内元素请尽可能使用`<template>`标签包装，以免出现奇怪的错误

下来我们来看一个例子
<ChatHistory>
<ChatMsg id="1659488338"><span v-pre>
send &lt;random&gt;<br />
&lt;template&gt;我猜你喜欢&gt;image src="https://maohaoji.com/zhindocimage/%E9%BB%91%E4%B8%9D.jpg"/ &gt;&lt;/template &gt;<br />
&lt;template&gt;我猜你喜欢&gt;image src="https://maohaoji.com/zhindocimage/%E7%99%BD%E4%B8%9D.jpeg"/&gt; &lt;/template&gt;<br />
&lt;template&gt;我猜你喜欢&gt;image src="https://maohaoji.com/zhindocimage/%E6%B8%94%E7%BD%91.jpg"/&gt; &lt;/template&gt;<br />
&lt;/random&gt;
</span></ChatMsg>
<ChatMsg id="1689919782"> <!--  image标签示例图片由taidixiong233提供 github.com/taidixiong233 !-->
<span>我猜你喜欢</span>
<img alt="" style="height:100px" src="https://maohaoji.com/zhindocimage/%E7%99%BD%E4%B8%9D.jpeg"/>
</ChatMsg>
</ChatHistory>

## time 标签

- time 标签相比于 new Date()然后解析来获取时间字符串来说是很方便容易的，它会输出 yyyy-MM-dd hh:mm:ss 格式的时间，我们来看有个例子
  <ChatHistory>
  <ChatMsg id="1659488338">
  <span v-pre>send 现在是&lt;time/&gt;</span>
  </ChatMsg>
  <ChatMsg id="1689919782"> <!--  image标签示例图片由taidixiong233提供 github.com/taidixiong233 !-->
  <span>现在是 2023-02-0518:52:02</span>
  </ChatMsg>
  </ChatHistory>

- 我们可以用来实现一个有趣的输出
  <ChatHistory>
  <ChatMsg id="1659488338">
  <span v-pre>
  send &lt;image :src="`https://q1.qlogo.cn/g?b=qq&nk=${sender.user_id}&s=100`" /&gt;[日志][&lt;time /&gt;][用户:{{session.sender.nickname}}({{session.sender.user_id}})]是一个来自{{session.sender.area == ""?"未知":sender.area}}的{{session.sender.age}}岁{{session.sender.sex == "unknown"?"人妖":sender.sex}}
  </span>
  </ChatMsg>
  <ChatMsg id="1689919782"> <!--  image标签示例图片由taidixiong233提供 github.com/taidixiong233 !-->
  <img alt="" style="height:100px" src="https://q1.qlogo.cn/g?b=qq&nk=1659488338&s=100" />
  <span>[日志][2023-02-0519:49:22][用户:master(1659488338)]是一个来自四川的 26 岁 male</span>
  </ChatMsg>
  </ChatHistory>

## at 标签

- 使用 at 标签可以很容易的 at 群内成员，示例如下
  <ChatHistory>
  <ChatMsg id="1659488338">
  <span v-pre>
  send &lt;at user_id="1659488338" /&gt;
  </span>
  </ChatMsg>
  <ChatMsg id="1689919782">
  <span>@master</span>
  </ChatMsg>
  </ChatHistory>
- 当然，该标签也可以使用 v-bind 标签实现数据绑定，类似于以下内容
  <ChatHistory>
  <ChatMsg id="1659488338">
  <span v-pre>
  send &lt;at :user_id="sender.user_id" /&gt;
  </span>
  </ChatMsg>
  <ChatMsg id="1689919782">
  <span>@master</span>
  </ChatMsg>
  </ChatHistory>

- 结合`<random>`标签后，很容易的可以实现随机 at

  <ChatHistory>
  <ChatMsg id="1659488338">
  <span v-pre>
    send &lt;random&gt;<br />
    &lt;template&gt;taidixiong233<br />
    &lt;at user_id="2870926164" /&gt;<br />
    &lt;/template&gt;<br />
    &lt;template&gt;master<br />
    &lt;at user_id="1689919782" /&gt;<br />
    &lt;/template&gt;<br />
    &lt;template&gt;小叶子<br />
    &lt;at user_id="2870926164" /&gt;<br />
    &lt;/template&gt;<br />
    &lt;/random&gt;
  </span>
  </ChatMsg>
  <ChatMsg id="1689919782">
  <span>@taidixiong233</span>
  </ChatMsg>
  <ChatMsg nickname="taidixiong233" id="2870926164">
  <span>怎么啦</span>
  </ChatMsg>
  <ChatMsg nickname="taidixiong233" id="2870926164">
  <span>机器人at我干嘛咩</span>
  </ChatMsg>
  </ChatHistory>

## prompt 标签

- prompt 标签可以快速的实现表单收集，非常的好用，实例如下

 <ChatHistory>
 <ChatMsg id="1659488338">
 <span v-pre>send 你是&lt;prompt&gt;请输入姓名&lt;/prompt&gt;，你在&lt;prompt&gt;请输入地址&lt;/prompt&gt;,是个可爱的&lt;prompt&gt;请输入性别&lt;/prompt&gt;孩子</span>
 </ChatMsg>
 <ChatMsg id="1689919782">
 <span>请输入姓名</span>
 </ChatMsg>
 <ChatMsg id="1659488338">
 <span>master</span>
 </ChatMsg>
 <ChatMsg id="1689919782">
 <span>请输入地址</span>
 </ChatMsg>
 <ChatMsg id="1659488338">
 <span>四川</span>
 </ChatMsg>
 <ChatMsg id="1689919782">
 <span>请输入性别</span>
 </ChatMsg>
 <ChatMsg id="1659488338">
 <span>男</span>
 </ChatMsg>
 <ChatMsg id="1689919782">
 <span>你是master，你在四川，是个可爱的男孩子</span>
 </ChatMsg>
     <ChatMsg nickname="taidixiong233" id="2870926164">
  <span>这个机器人好酷</span>
  </ChatMsg>
 </ChatHistory>

## confirm 标签

- confirm 标签可以问询用户是否确定、继续，我们来看一段演示
  <ChatHistory>
  <ChatMsg id="1659488338">
  <span>send 你的选择是&lt;confirm/&gt;</span>
  </ChatMsg>
  <ChatMsg id="1689919782">
  <span>输入 yes,y,Yes,YES,Y,.,。,确认为确认</span>
  </ChatMsg>
  <ChatMsg id="1659488338">
  <span>yes</span>
  </ChatMsg>
  <ChatMsg id="1689919782">
  <span>你的选择是 true</span>
  </ChatMsg>
  </ChatHistory>

## execute 标签

- execute 标签可以用于执行机器人命令，下图给出了示例，具体命令列表请查看命令列表
  <ChatHistory>
  <ChatMsg id="1659488338">
  <span>send &lt;execute&gt;status&lt;/execute&gt;</span>
  </ChatMsg>
  <ChatMsg id="1689919782">
  <span>当前状态:<br />
  系统架构:Zhin 自研<br />
  CPU 架构:65536 核 Zhin(R)CPU9900KF-MaxPro<br />
  内存:780.26MB/1048576GB(00.01%)<br />
  进程内存占比:0.01%(45.97MB/1048576GB)<br />
  持续运行时间：2149 小时 29 分钟<br />
  掉线次数:0 次<br />
  发送消息数:3521 条<br />
  接收消息数:213230 条<br />
  消息频率:1 条/分</span>
  </ChatMsg>
  <ChatMsg id="2870926164" nickname="taidixiong233">
  <span>哇趣，65536核心？？认真的别搞</span>
  </ChatMsg>
  <ChatMsg id="2870926164" nickname="taidixiong233">
  <span>1048576GB？？1PB的内存，这都比我硬盘空间大了</span>
  </ChatMsg>
  </ChatHistory>

## face 标签
- face 标签可以快速的发送表情消息，需要使用表情的id，示例如下
  <ChatHistory>
  <ChatMsg id="1659488338">
  <span>send &lt;face id="2" /&gt;</span>
  </ChatMsg>
  <ChatMsg id="1689919782">
  <img alt="" src="https://maohaoji.com/zhindocimage/2.png" style="width: 25px" />
  </ChatMsg>
  </ChatHistory>

- 这是一个组合使用face标签的例子
  <ChatHistory>
  <ChatMsg id="1659488338">
  <span>send &lt;random&gt;&lt;face id="1" /&gt;&lt;face id="2" /&gt;&lt;/random&gt;</span>
  </ChatMsg>
  <ChatMsg id="1689919782">
  <img alt="" src="https://maohaoji.com/zhindocimage/2.png" style="width: 25px" />
  </ChatMsg>
    <ChatMsg id="2870926164" nickname="taidixiong233">
  <span>机器人发的表情色迷迷的</span>
  </ChatMsg>
  </ChatHistory>
