import{_ as t,c,e as s,w as a,b as n,d as p,r as e,o as r}from"./app.e142e5c3.js";const g=JSON.parse('{"title":"写个复读🐔","description":"","frontmatter":{},"headers":[{"level":2,"title":"1. 创建插件(二选一)","slug":"_1-创建插件-二选一","link":"#_1-创建插件-二选一","children":[{"level":3,"title":"1. cli创建","slug":"_1-cli创建","link":"#_1-cli创建","children":[]},{"level":3,"title":"2. 手动创建","slug":"_2-手动创建","link":"#_2-手动创建","children":[]}]},{"level":2,"title":"2. 实现插件交互逻辑","slug":"_2-实现插件交互逻辑","link":"#_2-实现插件交互逻辑","children":[{"level":3,"title":"测试一下","slug":"测试一下","link":"#测试一下","children":[]}]},{"level":2,"title":"3.启用插件","slug":"_3-启用插件","link":"#_3-启用插件","children":[{"level":3,"title":"再试试","slug":"再试试","link":"#再试试","children":[]}]},{"level":2,"title":"4.编译插件 (可选)","slug":"_4-编译插件-可选","link":"#_4-编译插件-可选","children":[]},{"level":2,"title":"5.发布插件","slug":"_5-发布插件","link":"#_5-发布插件","children":[]}],"relativePath":"guide/repeater.md","lastUpdated":1676216398000}'),i={name:"guide/repeater.md"},y=p(`<div class="info custom-block"><p class="custom-block-title">INFO</p><p>通过本节的阅读，你将了解到如何新建一个插件、使用zhin提供的api实现一些简单的小功能，以及插件的发布</p></div><p>zhin的插件共分为 <code>本地插件</code> 和 <code>npm 插件</code> 两大类。</p><ul><li>本地插件</li></ul><p>本地插件将全部存放在根目录的 plugins 下。 所有由你自己编写，并 仅供个人使用 的插件就可以称为本地插件。</p><ul><li>npm 插件</li></ul><p>npm 插件都是直接使用 <code>npm i</code> 命令安装，存放在 <code>node_modules</code> 目录下。 是由我或者其他开发者编写，上传至 <code>npmjs</code> 平台，为 <strong>所有使用 zhin 框架的人</strong> 提供服务。</p><p>还记得在初始化项目时输入的 <code>zhin init</code> 么，在界面会有一个选择安装插件的步骤，那些插件就全部属于 <code>npm 插件</code>。</p><p>如果你对 npmjs 并不了解也没关系，在这里只会介绍本地插件的编写。 但是如果你想对 zhin 有一个更深入的了解，还是需要熟悉 nodejs 及 npmjs 的基本原理。</p><h1 id="写个复读🐔" tabindex="-1">写个复读🐔 <a class="header-anchor" href="#写个复读🐔" aria-hidden="true">#</a></h1><p>到目前为止，我们虽然让zhin运行起来了，但除了内置插件外，还没有任何功能，接下来，让我们通过实现一个复读机的小功能，来初步了解下zhin插件开发的大体流程：</p><h2 id="_1-创建插件-二选一" tabindex="-1">1. 创建插件(二选一) <a class="header-anchor" href="#_1-创建插件-二选一" aria-hidden="true">#</a></h2><h3 id="_1-cli创建" tabindex="-1">1. cli创建 <a class="header-anchor" href="#_1-cli创建" aria-hidden="true">#</a></h3><ul><li>此方式需要你安装了zhin脚手架<code>@zhinjs/cli</code></li></ul><div class="language-shell"><button title="Copy Code" class="copy"></button><span class="lang">shell</span><pre class="shiki material-theme-palenight" tabindex="0"><code><span class="line"><span style="color:#FFCB6B;">zhin</span><span style="color:#A6ACCD;"> </span><span style="color:#C3E88D;">new</span><span style="color:#A6ACCD;"> </span><span style="color:#C3E88D;">repeater</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 此处repeater为插件名</span></span>
<span class="line"><span style="color:#676E95;font-style:italic;"># or</span></span>
<span class="line"><span style="color:#FFCB6B;">zhin</span><span style="color:#A6ACCD;"> </span><span style="color:#C3E88D;">new</span><span style="color:#A6ACCD;"> </span><span style="color:#C3E88D;">repeater</span><span style="color:#A6ACCD;"> </span><span style="color:#C3E88D;">-t</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 如果你想使用TS进行开发，可增加\`-t\`选项，声明需要创建TS插件</span></span>
<span class="line"></span></code></pre></div><h3 id="_2-手动创建" tabindex="-1">2. 手动创建 <a class="header-anchor" href="#_2-手动创建" aria-hidden="true">#</a></h3><div class="language-shell"><button title="Copy Code" class="copy"></button><span class="lang">shell</span><pre class="shiki material-theme-palenight" tabindex="0"><code><span class="line"><span style="color:#676E95;font-style:italic;"># 进入插件目录</span></span>
<span class="line"><span style="color:#82AAFF;">cd</span><span style="color:#A6ACCD;"> </span><span style="color:#C3E88D;">plugins</span><span style="color:#A6ACCD;"> </span></span>
<span class="line"></span>
<span class="line"><span style="color:#676E95;font-style:italic;">#创建一个存放插件的目录</span></span>
<span class="line"><span style="color:#FFCB6B;">mkdir</span><span style="color:#A6ACCD;"> </span><span style="color:#C3E88D;">repeater</span></span>
<span class="line"></span>
<span class="line"><span style="color:#676E95;font-style:italic;">#创建入口文件</span></span>
<span class="line"><span style="color:#FFCB6B;">touch</span><span style="color:#A6ACCD;"> </span><span style="color:#C3E88D;">index.js</span></span>
<span class="line"></span></code></pre></div><p>完成创建后，插件目录大体如下：</p><div class="vp-code-group"><div class="tabs"><input type="radio" name="group-Rit7a" id="tab-a61grRB" checked="checked"><label for="tab-a61grRB">手动创建</label><input type="radio" name="group-Rit7a" id="tab-d5GVOON"><label for="tab-d5GVOON">cli创建</label></div><div class="blocks"><div class="language-text active"><button title="Copy Code" class="copy"></button><span class="lang">text</span><pre class="shiki material-theme-palenight" tabindex="0"><code><span class="line"><span style="color:#A6ACCD;">plugins/</span></span>
<span class="line"><span style="color:#A6ACCD;">└─ repeater/                 test 插件</span></span>
<span class="line"><span style="color:#A6ACCD;">   ├─ index.js           程序主入口</span></span>
<span class="line"><span style="color:#A6ACCD;">   └─ package.json       包管理文件 (可选)</span></span>
<span class="line"><span style="color:#A6ACCD;"></span></span></code></pre></div><div class="language-text"><button title="Copy Code" class="copy"></button><span class="lang">text</span><pre class="shiki material-theme-palenight" tabindex="0"><code><span class="line"><span style="color:#A6ACCD;">plugins/</span></span>
<span class="line"><span style="color:#A6ACCD;">└─ repeater/                 test 插件</span></span>
<span class="line"><span style="color:#A6ACCD;">   └─ src/                 资源目录 插件</span></span>
<span class="line"><span style="color:#A6ACCD;">      ├─ index.ts           程序主入口</span></span>
<span class="line"><span style="color:#A6ACCD;">      └─ package.json       包管理文件 (可选)</span></span>
<span class="line"><span style="color:#A6ACCD;"></span></span></code></pre></div></div></div><div class="warning custom-block"><p class="custom-block-title">WARNING</p><p>除非你创建了 package.json ，否则 index 文件名 不能随意更改 ，不然会导致插件无法被检索。</p></div><p>打开入口文件，并输入如下内容</p><div class="vp-code-group"><div class="tabs"><input type="radio" name="group-Yus6P" id="tab-7kbNcNs" checked="checked"><label for="tab-7kbNcNs">index.js</label><input type="radio" name="group-Yus6P" id="tab-Hjax4O3"><label for="tab-Hjax4O3">src/index.ts</label></div><div class="blocks"><div class="language-js active"><button title="Copy Code" class="copy"></button><span class="lang">js</span><pre class="shiki material-theme-palenight" tabindex="0"><code><span class="line"><span style="color:#89DDFF;">module.exports={</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">name</span><span style="color:#89DDFF;">:</span><span style="color:#89DDFF;">&#39;</span><span style="color:#C3E88D;">repeater</span><span style="color:#89DDFF;">&#39;</span><span style="color:#89DDFF;">,</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">install</span><span style="color:#89DDFF;">(</span><span style="color:#A6ACCD;font-style:italic;">ctx</span><span style="color:#89DDFF;">){</span></span>
<span class="line"><span style="color:#F07178;">    </span><span style="color:#89DDFF;">}</span></span>
<span class="line"><span style="color:#89DDFF;">}</span></span>
<span class="line"></span></code></pre></div><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki material-theme-palenight" tabindex="0"><code><span class="line"><span style="color:#89DDFF;font-style:italic;">import</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">{</span><span style="color:#A6ACCD;">Context</span><span style="color:#89DDFF;">}</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;font-style:italic;">from</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">&#39;</span><span style="color:#C3E88D;">zhin</span><span style="color:#89DDFF;">&#39;</span><span style="color:#89DDFF;">;</span></span>
<span class="line"><span style="color:#89DDFF;font-style:italic;">export</span><span style="color:#A6ACCD;"> </span><span style="color:#C792EA;">const</span><span style="color:#A6ACCD;"> name</span><span style="color:#89DDFF;">=</span><span style="color:#89DDFF;">&#39;</span><span style="color:#C3E88D;">repeater</span><span style="color:#89DDFF;">&#39;</span><span style="color:#89DDFF;">;</span></span>
<span class="line"><span style="color:#89DDFF;font-style:italic;">export</span><span style="color:#A6ACCD;"> </span><span style="color:#C792EA;">function</span><span style="color:#A6ACCD;"> </span><span style="color:#82AAFF;">install</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">(</span><span style="color:#A6ACCD;font-style:italic;">ctx</span><span style="color:#89DDFF;">:</span><span style="color:#FFCB6B;">Context</span><span style="color:#89DDFF;">){</span></span>
<span class="line"><span style="color:#89DDFF;">}</span></span>
<span class="line"></span></code></pre></div></div></div><p>这个时候你就已经写好了一个插件，不需要任何额外操作，不过目前这个插件还什么都不能干，我们没有为其编写相应的交互逻辑。</p><h2 id="_2-实现插件交互逻辑" tabindex="-1">2. 实现插件交互逻辑 <a class="header-anchor" href="#_2-实现插件交互逻辑" aria-hidden="true">#</a></h2><p>相信你这个时候一定有很多疑问，因为这其中涉及到相当多的概念，<code>Plugin</code> 到底是什么？</p><div class="info custom-block"><p class="custom-block-title">INFO</p><p>当前章节仅提供示例，目的在于让你能自己编写出可以进行简单交互的插件。 目前你无需关心这段代码是什么意思，后面会逐一介绍，所以不用着急，让我们继续。</p></div><p>你可以参考下列代码段，在<a href="/zhin/api/context.html">上下文</a>上添加一个<a href="/zhin/api/middleware.html">中间件</a>，拦截<a href="/zhin/api/session.html">消息会话</a>，并将<a href="/zhin/interface/element.html">消息元素</a>原封不动回复给用户</p><div class="vp-code-group"><div class="tabs"><input type="radio" name="group-nTpsN" id="tab-w4O6UGV" checked="checked"><label for="tab-w4O6UGV">index.js</label><input type="radio" name="group-nTpsN" id="tab-yc4EFdA"><label for="tab-yc4EFdA">src/index.ts</label></div><div class="blocks"><div class="language-js active"><button title="Copy Code" class="copy"></button><span class="lang">js</span><pre class="shiki material-theme-palenight" tabindex="0"><code><span class="line"><span style="color:#89DDFF;">module.exports={</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">name</span><span style="color:#89DDFF;">:</span><span style="color:#89DDFF;">&#39;</span><span style="color:#C3E88D;">repeater</span><span style="color:#89DDFF;">&#39;</span><span style="color:#89DDFF;">,</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">install</span><span style="color:#89DDFF;">(</span><span style="color:#A6ACCD;font-style:italic;">ctx</span><span style="color:#89DDFF;">){</span></span>
<span class="line"><span style="color:#F07178;">        </span><span style="color:#A6ACCD;">ctx</span><span style="color:#89DDFF;">.</span><span style="color:#82AAFF;">middleware</span><span style="color:#F07178;">(</span><span style="color:#C792EA;">async</span><span style="color:#F07178;"> </span><span style="color:#89DDFF;">(</span><span style="color:#A6ACCD;font-style:italic;">session</span><span style="color:#89DDFF;">,</span><span style="color:#A6ACCD;font-style:italic;">next</span><span style="color:#89DDFF;">)</span><span style="color:#C792EA;">=&gt;</span><span style="color:#89DDFF;">{</span></span>
<span class="line"><span style="color:#F07178;">            </span><span style="color:#89DDFF;font-style:italic;">await</span><span style="color:#F07178;"> </span><span style="color:#A6ACCD;">session</span><span style="color:#89DDFF;">.</span><span style="color:#82AAFF;">reply</span><span style="color:#F07178;">(</span><span style="color:#A6ACCD;">session</span><span style="color:#89DDFF;">.</span><span style="color:#A6ACCD;">elements</span><span style="color:#F07178;">)</span></span>
<span class="line"><span style="color:#F07178;">            </span><span style="color:#82AAFF;">next</span><span style="color:#F07178;">()</span></span>
<span class="line"><span style="color:#F07178;">        </span><span style="color:#89DDFF;">}</span><span style="color:#F07178;">)</span><span style="color:#89DDFF;">;</span></span>
<span class="line"><span style="color:#F07178;">    </span><span style="color:#89DDFF;">}</span></span>
<span class="line"><span style="color:#89DDFF;">}</span></span>
<span class="line"></span></code></pre></div><div class="language-ts"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki material-theme-palenight" tabindex="0"><code><span class="line"><span style="color:#89DDFF;font-style:italic;">import</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">{</span><span style="color:#A6ACCD;">Context</span><span style="color:#89DDFF;">}</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;font-style:italic;">from</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">&#39;</span><span style="color:#C3E88D;">zhin</span><span style="color:#89DDFF;">&#39;</span><span style="color:#89DDFF;">;</span></span>
<span class="line"><span style="color:#89DDFF;font-style:italic;">export</span><span style="color:#A6ACCD;"> </span><span style="color:#C792EA;">const</span><span style="color:#A6ACCD;"> name</span><span style="color:#89DDFF;">=</span><span style="color:#89DDFF;">&#39;</span><span style="color:#C3E88D;">repeater</span><span style="color:#89DDFF;">&#39;</span><span style="color:#89DDFF;">;</span></span>
<span class="line"><span style="color:#89DDFF;font-style:italic;">export</span><span style="color:#A6ACCD;"> </span><span style="color:#C792EA;">function</span><span style="color:#A6ACCD;"> </span><span style="color:#82AAFF;">install</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">(</span><span style="color:#A6ACCD;font-style:italic;">ctx</span><span style="color:#89DDFF;">:</span><span style="color:#FFCB6B;">Context</span><span style="color:#89DDFF;">){</span></span>
<span class="line"><span style="color:#F07178;">    </span><span style="color:#A6ACCD;">ctx</span><span style="color:#89DDFF;">.</span><span style="color:#82AAFF;">middleware</span><span style="color:#F07178;">(</span><span style="color:#C792EA;">async</span><span style="color:#F07178;"> </span><span style="color:#89DDFF;">(</span><span style="color:#A6ACCD;font-style:italic;">session</span><span style="color:#89DDFF;">,</span><span style="color:#A6ACCD;font-style:italic;">next</span><span style="color:#89DDFF;">)</span><span style="color:#C792EA;">=&gt;</span><span style="color:#89DDFF;">{</span></span>
<span class="line"><span style="color:#F07178;">        </span><span style="color:#89DDFF;font-style:italic;">await</span><span style="color:#F07178;"> </span><span style="color:#A6ACCD;">session</span><span style="color:#89DDFF;">.</span><span style="color:#82AAFF;">reply</span><span style="color:#F07178;">(</span><span style="color:#A6ACCD;">session</span><span style="color:#89DDFF;">.</span><span style="color:#A6ACCD;">elements</span><span style="color:#F07178;">)</span></span>
<span class="line"><span style="color:#F07178;">        </span><span style="color:#82AAFF;">next</span><span style="color:#F07178;">()</span></span>
<span class="line"><span style="color:#F07178;">    </span><span style="color:#89DDFF;">}</span><span style="color:#F07178;">)</span><span style="color:#89DDFF;">;</span></span>
<span class="line"><span style="color:#89DDFF;">}</span></span>
<span class="line"></span></code></pre></div></div></div><h3 id="测试一下" tabindex="-1">测试一下 <a class="header-anchor" href="#测试一下" aria-hidden="true">#</a></h3>`,28),D=p(`<h2 id="_3-启用插件" tabindex="-1">3.启用插件 <a class="header-anchor" href="#_3-启用插件" aria-hidden="true">#</a></h2><p>在配置文件<code>zhin.yaml</code>中声明该插件，zhin则会自动载入该插件</p><div class="language-yaml"><button title="Copy Code" class="copy"></button><span class="lang">yaml</span><pre class="shiki material-theme-palenight has-diff" tabindex="0"><code><span class="line"><span style="color:#F07178;">adapters</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">icqq</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指定使用icqq适配器</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">bots</span><span style="color:#89DDFF;">:</span></span>
<span class="line"><span style="color:#A6ACCD;">      </span><span style="color:#89DDFF;">-</span><span style="color:#A6ACCD;"> </span><span style="color:#F07178;">uin</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#F78C6C;">147258369</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 机器人账号 //</span></span>
<span class="line"><span style="color:#A6ACCD;">        </span><span style="color:#F07178;">platform</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#F78C6C;">5</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指定qq登录平台为iPad（可不配置  1：安卓  2：安卓平板  3：手表  4：苹果电脑  5：苹果平板</span></span>
<span class="line"><span style="color:#A6ACCD;">        </span><span style="color:#F07178;">password</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">&#39;</span><span style="color:#C3E88D;">你的机器人密码</span><span style="color:#89DDFF;">&#39;</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 账号密码(不配置则使用扫码登录)</span></span>
<span class="line"><span style="color:#A6ACCD;">        </span><span style="color:#F07178;">prefix</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">&#39;&#39;</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指令调用前缀，可不配置</span></span>
<span class="line"><span style="color:#A6ACCD;">        </span><span style="color:#F07178;">master</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#F78C6C;">1659488338</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 机器人主人账号(拥有完整操作该机器人的权限，可不配置)</span></span>
<span class="line"><span style="color:#A6ACCD;">        </span><span style="color:#F07178;">admins</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">[]</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 机器人管理员账号(可不配置)</span></span>
<span class="line"><span style="color:#F07178;">plugins</span><span style="color:#89DDFF;">:</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">config</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">null</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指定启用配置管理插件</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">daemon</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">null</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指定启用守护进程插件</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">help</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">null</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指定启用帮助插件</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">login</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">null</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指定启用命令行登录插件</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">plugin</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">null</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指定启用插件管理插件</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">systemInfo</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">null</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指定启用系统信息查看插件</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">watcher</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#C3E88D;">plugins</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指定启用文件监听插件</span></span>
<span class="line diff add"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">repeater</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">null</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指定启用复读机插件 </span></span>
<span class="line"><span style="color:#F07178;">log_level</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#C3E88D;">info</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指定日志等级</span></span>
<span class="line"><span style="color:#F07178;">plugin_dir</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#C3E88D;">plugins</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 指定本地插件存放目录</span></span>
<span class="line"><span style="color:#F07178;">data_dir</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#C3E88D;">data</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># 缓存文件存放目录</span></span>
<span class="line"><span style="color:#F07178;">delay</span><span style="color:#89DDFF;">:</span></span>
<span class="line"><span style="color:#A6ACCD;">  </span><span style="color:#F07178;">prompt</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#F78C6C;">60000</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;"># prompt方法超时时间为1分钟(60*1000毫秒)</span></span>
<span class="line"></span></code></pre></div><h3 id="再试试" tabindex="-1">再试试 <a class="header-anchor" href="#再试试" aria-hidden="true">#</a></h3>`,4),C=p(`<h2 id="_4-编译插件-可选" tabindex="-1">4.编译插件 (可选) <a class="header-anchor" href="#_4-编译插件-可选" aria-hidden="true">#</a></h2><div class="tip custom-block"><p class="custom-block-title">TIP</p><p>在发布插件前，若你使用TS开发插件，推荐先编译为JS可用的插件。否则，该插件将不能在JS环境下执行</p></div><ul><li>你可以使用指令<code>zhin build [pluginName]</code>编译TS开发的插件为JS插件</li><li>现在，执行以下命令，将TS插件编译为JS插件吧</li></ul><div class="language-shell"><button title="Copy Code" class="copy"></button><span class="lang">shell</span><pre class="shiki material-theme-palenight" tabindex="0"><code><span class="line"><span style="color:#FFCB6B;">zhin</span><span style="color:#A6ACCD;"> </span><span style="color:#C3E88D;">build</span><span style="color:#A6ACCD;"> </span><span style="color:#C3E88D;">repeater</span></span>
<span class="line"></span></code></pre></div><h2 id="_5-发布插件" tabindex="-1">5.发布插件 <a class="header-anchor" href="#_5-发布插件" aria-hidden="true">#</a></h2><ul><li>在插件开发完成后，若你有意愿公开你的插件，你可使用<code>zhin pub [pluginName]</code>发布本地指定插件名的插件到<code>npmjs</code>供他人使用</li></ul><div class="info custom-block"><p class="custom-block-title">INFO</p><p>若插件名与<code>npmjs</code>已有包冲突，将无法发布，可尝试修改插件名，重新发布</p></div><ul><li>现在，执行以下命令，将发布你的第一个zhin插件到<code>npmjs</code>吧</li></ul><div class="language-shell"><button title="Copy Code" class="copy"></button><span class="lang">shell</span><pre class="shiki material-theme-palenight" tabindex="0"><code><span class="line"><span style="color:#FFCB6B;">zhin</span><span style="color:#A6ACCD;"> </span><span style="color:#C3E88D;">pub</span><span style="color:#A6ACCD;"> </span><span style="color:#C3E88D;">repeater</span></span>
<span class="line"></span></code></pre></div>`,9);function F(A,d,h,u,_,m){const l=e("ChatMsg"),o=e("ChatHistory");return r(),c("div",null,[y,s(o,null,{default:a(()=>[s(l,{id:"1659488338"},{default:a(()=>[n("hello")]),_:1}),s(l,{id:"1659488338"},{default:a(()=>[n("...")]),_:1})]),_:1}),n(" 谔谔 为啥没效果呢？因为插件还未被启用，现在，我们来启用插件 "),D,s(o,null,{default:a(()=>[s(l,{id:"1659488338"},{default:a(()=>[n("hello")]),_:1}),s(l,{id:"1689919782"},{default:a(()=>[n("hello")]),_:1})]),_:1}),C])}const b=t(i,[["render",F]]);export{g as __pageData,b as default};
