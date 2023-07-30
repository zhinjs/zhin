import{_ as s,v as l,b as t,R as a}from"./chunks/framework.c021e421.js";const A=JSON.parse('{"title":"了解配置","description":"","frontmatter":{},"headers":[],"relativePath":"guide/config.md","filePath":"guide/config.md","lastUpdated":1689920000000}'),n={name:"guide/config.md"},e=a(`<div class="tip custom-block"><p class="custom-block-title">TIP</p><p>阅读本节前，请确认你已根据<a href="/guide/start.html">试试水</a>初始化完成你的项目</p></div><h1 id="了解配置" tabindex="-1">了解配置 <a class="header-anchor" href="#了解配置" aria-label="Permalink to &quot;了解配置&quot;">​</a></h1><ul><li>上一节中，我们往配置文件中增加第一个机器人账号，但里面还有很多字段，都是代表什么呢？接下来，我们开始熟悉 Zhin 的配置</li><li>其中大致可分为适配器配置(<code>adapters</code>) 、插件配置(<code>plugins</code>)以及通用配置</li><li>打开配置文件 <code>zhin.yaml</code> ,内容如下（对应作用已通过注释声明）</li></ul><div class="language-yaml"><button title="Copy Code" class="copy"></button><span class="lang">yaml</span><pre class="shiki material-theme-palenight"><code><span class="line"><span style="color:#F07178;">adapters</span><span style="color:#89DDFF;">:</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">icqq</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指定使用icqq适配器</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">bots</span><span style="color:#89DDFF;">:</span></span>
<span class="line"><span style="color:#A6ACCD;">      </span><span style="color:#89DDFF;">-</span><span style="color:#A6ACCD;"> </span><span style="color:#F07178;">uin</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#F78C6C;">147258369</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 机器人账号 //</span></span>
<span class="line"><span style="color:#A6ACCD;">        </span><span style="color:#F07178;">platform</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#F78C6C;">5</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指定qq登录平台为iPad（可不配置  1：安卓  2：安卓平板  3：手表  4：苹果电脑  5：苹果平板</span></span>
<span class="line"><span style="color:#A6ACCD;">        </span><span style="color:#F07178;">password</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">&quot;</span><span style="color:#C3E88D;">你的机器人密码</span><span style="color:#89DDFF;">&quot;</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 账号密码(不配置则使用扫码登录)</span></span>
<span class="line"><span style="color:#A6ACCD;">        </span><span style="color:#F07178;">prefix</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">&quot;&quot;</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指令调用前缀，可不配置</span></span>
<span class="line"><span style="color:#A6ACCD;">        </span><span style="color:#F07178;">master</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#F78C6C;">1659488338</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 机器人主人账号(拥有完整操作该机器人的权限，可不配置)</span></span>
<span class="line"><span style="color:#A6ACCD;">        </span><span style="color:#F07178;">admins</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">[]</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 机器人管理员账号(可不配置)</span></span>
<span class="line"><span style="color:#F07178;">plugins</span><span style="color:#89DDFF;">:</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">config</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">null</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指定启用配置管理插件</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">daemon</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">null</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指定启用守护进程插件</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">help</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">null</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指定启用帮助插件</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">login</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">null</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指定启用命令行登录插件</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">plugin</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">null</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指定启用插件管理插件</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">systemInfo</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">null</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指定启用系统信息查看插件</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">watcher</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#C3E88D;">/path/to/zhin-bot</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指定启用文件监听插件</span></span>
<span class="line"><span style="color:#F07178;">log_level</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#C3E88D;">info</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指定日志等级</span></span>
<span class="line"><span style="color:#F07178;">plugin_dir</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#C3E88D;">plugins</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指定本地插件存放目录</span></span>
<span class="line"><span style="color:#F07178;">data_dir</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#C3E88D;">data</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 缓存文件存放目录</span></span>
<span class="line"><span style="color:#F07178;">delay</span><span style="color:#89DDFF;">:</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">prompt</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#F78C6C;">60000</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># prompt方法超时时间为1分钟(60*1000毫秒)</span></span></code></pre></div><h2 id="适配器配置-adapters" tabindex="-1">适配器配置(adapters) <a class="header-anchor" href="#适配器配置-adapters" aria-label="Permalink to &quot;适配器配置(adapters)&quot;">​</a></h2><p>即 Zhin 当前启用的适配器配置，其中每一项的 key 为适配器名称，对应 value 中的 bots 中存放的则是使用该适配器添加到 Zhin 的每一个机器人账号配置</p><p>而每一个 Bot 的配置中，除了不同平台的配置外，只能额外提供了一些通用配置，用于配置 Bot 在 Zhin 中的权限配置和指令设置</p><h3 id="bot-通用配置" tabindex="-1">bot 通用配置 <a class="header-anchor" href="#bot-通用配置" aria-label="Permalink to &quot;bot 通用配置&quot;">​</a></h3><table><thead><tr><th style="text-align:left;">配置名</th><th style="text-align:left;">类型</th><th style="text-align:left;">默认值</th><th style="text-align:left;">描述</th></tr></thead><tbody><tr><td style="text-align:left;">master</td><td style="text-align:left;">string | number</td><td style="text-align:left;">-</td><td style="text-align:left;">主人账号</td></tr><tr><td style="text-align:left;">admins</td><td style="text-align:left;">(string | number)[]</td><td style="text-align:left;">[]</td><td style="text-align:left;">管理员账号列表</td></tr><tr><td style="text-align:left;">prefix</td><td style="text-align:left;">string</td><td style="text-align:left;">-</td><td style="text-align:left;">指令调用前缀</td></tr></tbody></table><h2 id="插件配置-plugins" tabindex="-1">插件配置(plugins) <a class="header-anchor" href="#插件配置-plugins" aria-label="Permalink to &quot;插件配置(plugins)&quot;">​</a></h2><p>即 Zhin 当前启用的插件配置，其中每一项的 key 为插件名称,对应 value 则为传递给相应插件的配置内容</p><p>其中 <code>config</code>、<code>daemon</code>、<code>help</code>、<code>login</code>、<code>logs</code>、<code>plugin</code>、<code>status</code>、<code>watcher</code> 为 Zhin 内置插件帮助用户完成一些通用功能，具体功能请见<a href="/config/built-plugin.html">内置插件</a>介绍</p><h2 id="通用配置-other" tabindex="-1">通用配置(...other) <a class="header-anchor" href="#通用配置-other" aria-label="Permalink to &quot;通用配置(...other)&quot;">​</a></h2><p>除了通用<code>适配器配置</code>和<code>插件配置</code>以外的配置，均属于zhin的通用配置，其中各项含义如下表：</p><table><thead><tr><th style="text-align:left;">配置名</th><th style="text-align:left;">类型</th><th style="text-align:left;">默认值</th><th style="text-align:left;">描述</th></tr></thead><tbody><tr><td style="text-align:left;">log_level</td><td style="text-align:left;">trace | debug | info | warn | error | fatal | mark | off</td><td style="text-align:left;">info</td><td style="text-align:left;">日志输出等级</td></tr><tr><td style="text-align:left;">plugin_dir</td><td style="text-align:left;">string</td><td style="text-align:left;">plugins</td><td style="text-align:left;">插件存放路径</td></tr><tr><td style="text-align:left;">data_dir</td><td style="text-align:left;">string</td><td style="text-align:left;">data</td><td style="text-align:left;">数据存放路径</td></tr><tr><td style="text-align:left;">delay</td><td style="text-align:left;">Record&lt;string,number&gt;</td><td style="text-align:left;">{ prompt: 60000 }</td><td style="text-align:left;">系统各种超时时长配置</td></tr></tbody></table>`,15),o=[e];function p(c,r,y,i,d,D){return l(),t("div",null,o)}const F=s(n,[["render",p]]);export{A as __pageData,F as default};
