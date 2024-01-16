import{_ as i,c as s,o as a,V as n}from"./chunks/framework.kfMHwhgJ.js";const u=JSON.parse('{"title":"知音(Zhin)","description":"","frontmatter":{},"headers":[],"relativePath":"api/zhin.md","filePath":"api/zhin.md","lastUpdated":1695180134000}'),t={name:"api/zhin.md"},e=n(`<h1 id="知音-zhin" tabindex="-1">知音(Zhin) <a class="header-anchor" href="#知音-zhin" aria-label="Permalink to &quot;知音(Zhin)&quot;">​</a></h1><div class="tip custom-block"><p class="custom-block-title">TIP</p><p>继承自 <a href="/api/context.html">Context</a></p></div><h2 id="属性-attrs" tabindex="-1">属性(Attrs) <a class="header-anchor" href="#属性-attrs" aria-label="Permalink to &quot;属性(Attrs)&quot;">​</a></h2><h3 id="isready-boolean" tabindex="-1">isReady:boolean <a class="header-anchor" href="#isready-boolean" aria-label="Permalink to &quot;isReady:boolean&quot;">​</a></h3><ul><li>标识zhin是否启动</li></ul><h3 id="options-zhin-options-见命名空间" tabindex="-1">options:Zhin.Options(见命名空间) <a class="header-anchor" href="#options-zhin-options-见命名空间" aria-label="Permalink to &quot;options:Zhin.Options(见命名空间)&quot;">​</a></h3><ul><li>zhin的配置文件</li></ul><h3 id="adapters-map-string-adapter" tabindex="-1">adapters:Map&lt;string,<a href="/api/adapter.html">Adapter</a>&gt; <a class="header-anchor" href="#adapters-map-string-adapter" aria-label="Permalink to &quot;adapters:Map&lt;string,[Adapter](/api/adapter)&gt;&quot;">​</a></h3><ul><li>zhin加载的适配器Map</li></ul><h3 id="services-map-string-service" tabindex="-1">services:Map&lt;string,<a href="./api/service.html">Service</a>&gt; <a class="header-anchor" href="#services-map-string-service" aria-label="Permalink to &quot;services:Map&lt;string,[Service](api/service)&gt;&quot;">​</a></h3><ul><li>zhin加载的服务Map</li></ul><h2 id="方法-methods" tabindex="-1">方法(Methods) <a class="header-anchor" href="#方法-methods" aria-label="Permalink to &quot;方法(Methods)&quot;">​</a></h2><h3 id="changeoptions-options-zhin-options-void" tabindex="-1">changeOptions(options:Zhin.Options):void <a class="header-anchor" href="#changeoptions-options-zhin-options-void" aria-label="Permalink to &quot;changeOptions(options:Zhin.Options):void&quot;">​</a></h3><ul><li>更改知音的配置文件</li></ul><h3 id="pickbot-protocol-string-self-id-string-number-bot-undefined" tabindex="-1">pickBot(protocol:string,self_id:string|number):<a href="/api/bot.html">Bot</a>|undefined <a class="header-anchor" href="#pickbot-protocol-string-self-id-string-number-bot-undefined" aria-label="Permalink to &quot;pickBot(protocol:string,self_id:string|number):[Bot](/api/bot)|undefined&quot;">​</a></h3><ul><li>根据条件选取一个已存在的机器人</li></ul><h3 id="getlogger-protocol-string-self-id-string-number-logger" tabindex="-1">getLogger(protocol:string,self_id:string|number):Logger <a class="header-anchor" href="#getlogger-protocol-string-self-id-string-number-logger" aria-label="Permalink to &quot;getLogger(protocol:string,self_id:string|number):Logger&quot;">​</a></h3><ul><li>获取logger</li></ul><h3 id="getinstalledmodules-moduletype-string-modules" tabindex="-1">getInstalledModules(moduleType:string):Modules[] <a class="header-anchor" href="#getinstalledmodules-moduletype-string-modules" aria-label="Permalink to &quot;getInstalledModules(moduleType:string):Modules[]&quot;">​</a></h3><ul><li>扫描项目依赖中的已安装的模块</li></ul><h3 id="hasmounted-name-string-boolean" tabindex="-1">hasMounted(name:string):boolean <a class="header-anchor" href="#hasmounted-name-string-boolean" aria-label="Permalink to &quot;hasMounted(name:string):boolean&quot;">​</a></h3><ul><li>检查知音是否安装指定插件</li></ul><h3 id="sendmsg-channelid-channelid-message-fragment-messageret" tabindex="-1">sendMsg(channelId: ChannelId, message: Fragment):MessageRet <a class="header-anchor" href="#sendmsg-channelid-channelid-message-fragment-messageret" aria-label="Permalink to &quot;sendMsg(channelId: ChannelId, message: Fragment):MessageRet&quot;">​</a></h3><ul><li>发送消息到指定通道</li></ul><h3 id="load-name-string-moduletype-t-setup-boolean-zhin-modules-t" tabindex="-1">load(name: string, moduleType: T,setup?:boolean):Zhin.Modules[T] <a class="header-anchor" href="#load-name-string-moduletype-t-setup-boolean-zhin-modules-t" aria-label="Permalink to &quot;load(name: string, moduleType: T,setup?:boolean):Zhin.Modules[T]&quot;">​</a></h3><ul><li>加载指定名称，指定类型的模块</li></ul><h3 id="findcommand-argv-argv-command" tabindex="-1">findCommand(argv:Argv):<a href="/api/command.html">Command</a> <a class="header-anchor" href="#findcommand-argv-argv-command" aria-label="Permalink to &quot;findCommand(argv:Argv):[Command](/api/command)&quot;">​</a></h3><ul><li>获取匹配出来的指令</li></ul><h3 id="start" tabindex="-1">start <a class="header-anchor" href="#start" aria-label="Permalink to &quot;start&quot;">​</a></h3><ul><li>启动知音</li></ul><h3 id="stop" tabindex="-1">stop <a class="header-anchor" href="#stop" aria-label="Permalink to &quot;stop&quot;">​</a></h3><ul><li>停止知音</li></ul><h2 id="命名空间-namespace" tabindex="-1">命名空间(Namespace) <a class="header-anchor" href="#命名空间-namespace" aria-label="Permalink to &quot;命名空间(Namespace)&quot;">​</a></h2><div class="language-typescript vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">typescript</span><pre class="shiki shiki-themes github-light github-dark vp-code"><code><span class="line"><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">export</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;"> interface</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> Options</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;"> {</span></span>
<span class="line"><span style="--shiki-light:#E36209;--shiki-dark:#FFAB70;">  self_url</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">?:</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;"> string</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">; </span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 公网访问url，可不填</span></span>
<span class="line"><span style="--shiki-light:#E36209;--shiki-dark:#FFAB70;">  port</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">:</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;"> number</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">; </span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 监听端口</span></span>
<span class="line"><span style="--shiki-light:#E36209;--shiki-dark:#FFAB70;">  log_level</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">:</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> LogLevel</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">; </span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 日志输出等级</span></span>
<span class="line"><span style="--shiki-light:#E36209;--shiki-dark:#FFAB70;">  logConfig</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">?:</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> Partial</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">&lt;</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">Configuration</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">&gt;; </span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// Configuration请自行参阅log4js</span></span>
<span class="line"><span style="--shiki-light:#E36209;--shiki-dark:#FFAB70;">  delay</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">:</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> Record</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">&lt;</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">string</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">, </span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">number</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">&gt;; </span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 超时时间</span></span>
<span class="line"><span style="--shiki-light:#E36209;--shiki-dark:#FFAB70;">  plugins</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">?:</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> Record</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">&lt;</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">string</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">, </span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">any</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">&gt;; </span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 规定用来存放不同插件的配置</span></span>
<span class="line"><span style="--shiki-light:#E36209;--shiki-dark:#FFAB70;">  services</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">?:</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> Record</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">&lt;</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">string</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">, </span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">any</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">&gt;; </span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 规定用来存放不同服务的配置</span></span>
<span class="line"><span style="--shiki-light:#E36209;--shiki-dark:#FFAB70;">  adapters</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">?:</span><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;"> Record</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">&lt;</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">string</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">, </span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">any</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">&gt;; </span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 规定用来存放不同适配器的配置</span></span>
<span class="line"><span style="--shiki-light:#E36209;--shiki-dark:#FFAB70;">  plugin_dir</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">?:</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;"> string</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">; </span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 存放插件的目录路径</span></span>
<span class="line"><span style="--shiki-light:#E36209;--shiki-dark:#FFAB70;">  data_dir</span><span style="--shiki-light:#D73A49;--shiki-dark:#F97583;">?:</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;"> string</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">; </span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 存放数据的目录路径</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">}</span></span></code></pre></div>`,34),l=[e];function h(r,p,o,d,k,g){return a(),s("div",null,l)}const m=i(t,[["render",h]]);export{u as __pageData,m as default};
