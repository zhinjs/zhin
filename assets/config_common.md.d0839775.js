import{_ as l,c as s,o as t,d as a}from"./app.e142e5c3.js";const D=JSON.parse('{"title":"配置文件","description":"","frontmatter":{},"headers":[{"level":2,"title":"adapters","slug":"adapters","link":"#adapters","children":[{"level":3,"title":"bot通用配置项","slug":"bot通用配置项","link":"#bot通用配置项","children":[]}]},{"level":2,"title":"plugins","slug":"plugins","link":"#plugins","children":[]},{"level":2,"title":"log_level","slug":"log-level","link":"#log-level","children":[]},{"level":2,"title":"plugin_dir","slug":"plugin-dir","link":"#plugin-dir","children":[]},{"level":2,"title":"data_dir","slug":"data-dir","link":"#data-dir","children":[]},{"level":2,"title":"delay","slug":"delay","link":"#delay","children":[]}],"relativePath":"config/common.md","lastUpdated":1676216398000}'),e={name:"config/common.md"},n=a(`<h1 id="配置文件" tabindex="-1">配置文件 <a class="header-anchor" href="#配置文件" aria-hidden="true">#</a></h1><ul><li>在项目初始化完成后，项目根目录会生成一个名为<code>zhin.yaml</code>的文件，该文件为zhin核心配置文件，内容大致如下。现在，让我们来了解下配置文件每一项的意义</li></ul><div class="language-yaml"><button title="Copy Code" class="copy"></button><span class="lang">yaml</span><pre class="shiki material-theme-palenight" tabindex="0"><code><span class="line"><span style="color:#F07178;">adapters</span><span style="color:#89DDFF;">:</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">icqq</span><span style="color:#89DDFF;">:</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">bots</span><span style="color:#89DDFF;">:</span></span>
<span class="line"><span style="color:#A6ACCD;">      </span><span style="color:#89DDFF;">-</span><span style="color:#A6ACCD;"> </span><span style="color:#F07178;">uin</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#F78C6C;">147258369</span></span>
<span class="line"><span style="color:#A6ACCD;">        </span><span style="color:#F07178;">platform</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#F78C6C;">5</span></span>
<span class="line"><span style="color:#F07178;">plugins</span><span style="color:#89DDFF;">:</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">config</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">null</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">daemon</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">null</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">help</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">null</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">login</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">null</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">systemInfo</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">null</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">plugin</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">null</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">watcher</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#C3E88D;">plugins</span></span>
<span class="line"><span style="color:#F07178;">log_level</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#C3E88D;">info</span></span>
<span class="line"><span style="color:#F07178;">plugin_dir</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#C3E88D;">plugins</span></span>
<span class="line"><span style="color:#F07178;">data_dir</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#C3E88D;">data</span></span>
<span class="line"><span style="color:#F07178;">delay</span><span style="color:#89DDFF;">:</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">prompt</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#F78C6C;">60000</span></span>
<span class="line"></span></code></pre></div><h2 id="adapters" tabindex="-1">adapters <a class="header-anchor" href="#adapters" aria-hidden="true">#</a></h2><ul><li>存放适配器的配置文件，每一个key对应一个适配器，每一个适配器可以启动多个机器人，每个机器人的配置存在<code>bots</code>中</li><li>不同适配器的机器人配置不尽相同，zhin在每一个bot配置基础上增加了一些zhin专有的配置项，大致含义如下：</li></ul><h3 id="bot通用配置项" tabindex="-1">bot通用配置项 <a class="header-anchor" href="#bot通用配置项" aria-hidden="true">#</a></h3><table><thead><tr><th style="text-align:left;">参数名</th><th style="text-align:left;">参数类型</th><th style="text-align:left;">默认值</th><th style="text-align:left;">描述</th></tr></thead><tbody><tr><td style="text-align:left;">self_id</td><td style="text-align:left;">string|number</td><td style="text-align:left;">-</td><td style="text-align:left;">必填参数 当前机器人唯一表示</td></tr><tr><td style="text-align:left;">master</td><td style="text-align:left;">string | number</td><td style="text-align:left;">-</td><td style="text-align:left;">主人账号</td></tr><tr><td style="text-align:left;">admins</td><td style="text-align:left;">(string | number)[]</td><td style="text-align:left;">[]</td><td style="text-align:left;">管理员账号列表</td></tr><tr><td style="text-align:left;">prefix</td><td style="text-align:left;">string</td><td style="text-align:left;">-</td><td style="text-align:left;">指令调用前缀</td></tr><tr><td style="text-align:left;">quote_self</td><td style="text-align:left;">boolean</td><td style="text-align:left;">false</td><td style="text-align:left;">触发指令时，是否自动引用触发消息</td></tr><tr><td style="text-align:left;">enable</td><td style="text-align:left;">boolean</td><td style="text-align:left;">-</td><td style="text-align:left;">当前机器人是否启用</td></tr><tr><td style="text-align:left;">enable_plugins</td><td style="text-align:left;">stirng[]</td><td style="text-align:left;">-</td><td style="text-align:left;">启用的插件列表</td></tr><tr><td style="text-align:left;">disable_plugins</td><td style="text-align:left;">string[]</td><td style="text-align:left;">-</td><td style="text-align:left;">禁用的插件列表</td></tr></tbody></table><div class="tip custom-block"><p class="custom-block-title">TIP</p><p>适配器需安装后方能使用，(icqq为内置适配器，无需安装，相应配置请查看<a href="/zhin/config/adapter-icqq.html">adapter-icqq</a>)</p></div><h2 id="plugins" tabindex="-1">plugins <a class="header-anchor" href="#plugins" aria-hidden="true">#</a></h2><ul><li>存放插件的配置文件，每一个key对应一个插件，只有在此处定义的插件才会被加载到zhin中</li></ul><div class="tip custom-block"><p class="custom-block-title">TIP</p><p>插件需安装后方能使用，(样例配置文件中的插件均为内置插件，无需安装即可使用，相应配置请查看<a href="/zhin/config/built-plugin.html">内置插件</a>)</p></div><h2 id="log-level" tabindex="-1">log_level <a class="header-anchor" href="#log-level" aria-hidden="true">#</a></h2><ul><li>日志输出等级：（可选值：<code>off</code>,<code>debug</code>,<code>error</code>,<code>warn</code>,<code>info</code>,<code>all</code>）</li></ul><h2 id="plugin-dir" tabindex="-1">plugin_dir <a class="header-anchor" href="#plugin-dir" aria-hidden="true">#</a></h2><ul><li>本地插件存放文件夹路径</li></ul><h2 id="data-dir" tabindex="-1">data_dir <a class="header-anchor" href="#data-dir" aria-hidden="true">#</a></h2><ul><li>缓存数据文件存放文件夹路径</li></ul><h2 id="delay" tabindex="-1">delay <a class="header-anchor" href="#delay" aria-hidden="true">#</a></h2><ul><li>各种超时时长配置(单位：毫秒)</li></ul>`,19),o=[n];function p(i,r,d,c,y,g){return t(),s("div",null,o)}const u=l(e,[["render",p]]);export{D as __pageData,u as default};
