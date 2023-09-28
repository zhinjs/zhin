import{_ as e,C as l,o as t,c,H as s,w as a,Q as r,a as p}from"./chunks/framework.92ce8a2a.js";const C=JSON.parse('{"title":"尝试写一个复读 🐔 插件","description":"","frontmatter":{},"headers":[],"relativePath":"guide/repeater.md","filePath":"guide/repeater.md","lastUpdated":1689919324000}'),i={name:"guide/repeater.md"},y=r(`<h1 id="尝试写一个复读-🐔-插件" tabindex="-1">尝试写一个复读 🐔 插件 <a class="header-anchor" href="#尝试写一个复读-🐔-插件" aria-label="Permalink to &quot;尝试写一个复读 🐔 插件&quot;">​</a></h1><p>到目前为止，我们虽然让 Zhin 运行起来了，但除了内置插件外，还没有任何功能，接下来，让我们通过实现一个复读机的小功能，来初步了解下 Zhin 插件开发的大体流程。</p><h2 id="_1-创建插件-二选一" tabindex="-1">1. 创建插件（二选一） <a class="header-anchor" href="#_1-创建插件-二选一" aria-label="Permalink to &quot;1. 创建插件（二选一）&quot;">​</a></h2><h3 id="通过-cli-创建" tabindex="-1">- 通过 cli 创建 <a class="header-anchor" href="#通过-cli-创建" aria-label="Permalink to &quot;- 通过 cli 创建&quot;">​</a></h3><p>此方式需要你安装了 Zhin 脚手架<code>@zhinjs/cli</code></p><div class="language-shell vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">shell</span><pre class="shiki github-dark vp-code-dark"><code><span class="line"><span style="color:#B392F0;">zhin</span><span style="color:#E1E4E8;"> </span><span style="color:#9ECBFF;">new</span><span style="color:#E1E4E8;"> </span><span style="color:#9ECBFF;">repeater</span><span style="color:#E1E4E8;"> </span><span style="color:#6A737D;"># 此处 repeater 为插件名</span></span>
<span class="line"></span>
<span class="line"><span style="color:#6A737D;"># 或者</span></span>
<span class="line"><span style="color:#B392F0;">zhin</span><span style="color:#E1E4E8;"> </span><span style="color:#9ECBFF;">new</span><span style="color:#E1E4E8;"> </span><span style="color:#9ECBFF;">repeater</span><span style="color:#E1E4E8;"> </span><span style="color:#79B8FF;">-t</span><span style="color:#E1E4E8;"> </span><span style="color:#6A737D;"># 如果你想使用 TS 进行开发，可增加 \`-t\` 选项，声明需要创建 TS 插件</span></span></code></pre><pre class="shiki github-light vp-code-light"><code><span class="line"><span style="color:#6F42C1;">zhin</span><span style="color:#24292E;"> </span><span style="color:#032F62;">new</span><span style="color:#24292E;"> </span><span style="color:#032F62;">repeater</span><span style="color:#24292E;"> </span><span style="color:#6A737D;"># 此处 repeater 为插件名</span></span>
<span class="line"></span>
<span class="line"><span style="color:#6A737D;"># 或者</span></span>
<span class="line"><span style="color:#6F42C1;">zhin</span><span style="color:#24292E;"> </span><span style="color:#032F62;">new</span><span style="color:#24292E;"> </span><span style="color:#032F62;">repeater</span><span style="color:#24292E;"> </span><span style="color:#005CC5;">-t</span><span style="color:#24292E;"> </span><span style="color:#6A737D;"># 如果你想使用 TS 进行开发，可增加 \`-t\` 选项，声明需要创建 TS 插件</span></span></code></pre></div><h3 id="手动创建" tabindex="-1">- 手动创建 <a class="header-anchor" href="#手动创建" aria-label="Permalink to &quot;- 手动创建&quot;">​</a></h3><div class="language-shell vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">shell</span><pre class="shiki github-dark vp-code-dark"><code><span class="line"><span style="color:#6A737D;"># 进入插件目录</span></span>
<span class="line"><span style="color:#79B8FF;">cd</span><span style="color:#E1E4E8;"> </span><span style="color:#9ECBFF;">plugins</span></span>
<span class="line"></span>
<span class="line"><span style="color:#6A737D;">#创建一个存放插件的目录</span></span>
<span class="line"><span style="color:#B392F0;">mkdir</span><span style="color:#E1E4E8;"> </span><span style="color:#9ECBFF;">repeater</span></span>
<span class="line"></span>
<span class="line"><span style="color:#6A737D;">#创建入口文件</span></span>
<span class="line"><span style="color:#B392F0;">touch</span><span style="color:#E1E4E8;"> </span><span style="color:#9ECBFF;">index.js</span></span></code></pre><pre class="shiki github-light vp-code-light"><code><span class="line"><span style="color:#6A737D;"># 进入插件目录</span></span>
<span class="line"><span style="color:#005CC5;">cd</span><span style="color:#24292E;"> </span><span style="color:#032F62;">plugins</span></span>
<span class="line"></span>
<span class="line"><span style="color:#6A737D;">#创建一个存放插件的目录</span></span>
<span class="line"><span style="color:#6F42C1;">mkdir</span><span style="color:#24292E;"> </span><span style="color:#032F62;">repeater</span></span>
<span class="line"></span>
<span class="line"><span style="color:#6A737D;">#创建入口文件</span></span>
<span class="line"><span style="color:#6F42C1;">touch</span><span style="color:#24292E;"> </span><span style="color:#032F62;">index.js</span></span></code></pre></div><p>完成创建后，插件目录大体如下：</p><div class="vp-code-group vp-adaptive-theme"><div class="tabs"><input type="radio" name="group-qgx0l" id="tab-l5qNKo8" checked="checked"><label for="tab-l5qNKo8">手动创建</label><input type="radio" name="group-qgx0l" id="tab-Cw1Y6Ey"><label for="tab-Cw1Y6Ey">通过 cli 创建</label></div><div class="blocks"><div class="language-txt vp-adaptive-theme active"><button title="Copy Code" class="copy"></button><span class="lang">txt</span><pre class="shiki github-dark vp-code-dark"><code><span class="line"><span style="color:#e1e4e8;">plugins/</span></span>
<span class="line"><span style="color:#e1e4e8;">└─ repeater/                 test 插件</span></span>
<span class="line"><span style="color:#e1e4e8;">   ├─ index.js           程序主入口</span></span>
<span class="line"><span style="color:#e1e4e8;">   └─ package.json       包管理文件 (可选)</span></span></code></pre><pre class="shiki github-light vp-code-light"><code><span class="line"><span style="color:#24292e;">plugins/</span></span>
<span class="line"><span style="color:#24292e;">└─ repeater/                 test 插件</span></span>
<span class="line"><span style="color:#24292e;">   ├─ index.js           程序主入口</span></span>
<span class="line"><span style="color:#24292e;">   └─ package.json       包管理文件 (可选)</span></span></code></pre></div><div class="language-txt vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">txt</span><pre class="shiki github-dark vp-code-dark"><code><span class="line"><span style="color:#e1e4e8;">plugins/</span></span>
<span class="line"><span style="color:#e1e4e8;">└─ repeater/                 test 插件</span></span>
<span class="line"><span style="color:#e1e4e8;">   └─ src/                 资源目录 插件</span></span>
<span class="line"><span style="color:#e1e4e8;">      ├─ index.ts           程序主入口</span></span>
<span class="line"><span style="color:#e1e4e8;">      └─ package.json       包管理文件 (可选)</span></span></code></pre><pre class="shiki github-light vp-code-light"><code><span class="line"><span style="color:#24292e;">plugins/</span></span>
<span class="line"><span style="color:#24292e;">└─ repeater/                 test 插件</span></span>
<span class="line"><span style="color:#24292e;">   └─ src/                 资源目录 插件</span></span>
<span class="line"><span style="color:#24292e;">      ├─ index.ts           程序主入口</span></span>
<span class="line"><span style="color:#24292e;">      └─ package.json       包管理文件 (可选)</span></span></code></pre></div></div></div><div class="warning custom-block"><p class="custom-block-title">WARNING</p><p>除非你创建了 package.json ，否则 index 文件名不能随意更改，不然会导致插件无法被检索。</p></div><p>打开入口文件，并输入如下内容</p><div class="vp-code-group vp-adaptive-theme"><div class="tabs"><input type="radio" name="group-sP0hs" id="tab-Gm1RLNg" checked="checked"><label for="tab-Gm1RLNg">index.js</label><input type="radio" name="group-sP0hs" id="tab-h6Zdr1s"><label for="tab-h6Zdr1s">src/index.ts</label></div><div class="blocks"><div class="language-js vp-adaptive-theme active"><button title="Copy Code" class="copy"></button><span class="lang">js</span><pre class="shiki github-dark vp-code-dark"><code><span class="line"><span style="color:#79B8FF;">module</span><span style="color:#E1E4E8;">.</span><span style="color:#79B8FF;">exports</span><span style="color:#E1E4E8;"> </span><span style="color:#F97583;">=</span><span style="color:#E1E4E8;"> {</span></span>
<span class="line"><span style="color:#E1E4E8;">  name: </span><span style="color:#9ECBFF;">&quot;repeater&quot;</span><span style="color:#E1E4E8;">,</span></span>
<span class="line"><span style="color:#E1E4E8;">  </span><span style="color:#B392F0;">install</span><span style="color:#E1E4E8;">(</span><span style="color:#FFAB70;">ctx</span><span style="color:#E1E4E8;">) {},</span></span>
<span class="line"><span style="color:#E1E4E8;">};</span></span></code></pre><pre class="shiki github-light vp-code-light"><code><span class="line"><span style="color:#005CC5;">module</span><span style="color:#24292E;">.</span><span style="color:#005CC5;">exports</span><span style="color:#24292E;"> </span><span style="color:#D73A49;">=</span><span style="color:#24292E;"> {</span></span>
<span class="line"><span style="color:#24292E;">  name: </span><span style="color:#032F62;">&quot;repeater&quot;</span><span style="color:#24292E;">,</span></span>
<span class="line"><span style="color:#24292E;">  </span><span style="color:#6F42C1;">install</span><span style="color:#24292E;">(</span><span style="color:#E36209;">ctx</span><span style="color:#24292E;">) {},</span></span>
<span class="line"><span style="color:#24292E;">};</span></span></code></pre></div><div class="language-ts vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki github-dark vp-code-dark"><code><span class="line"><span style="color:#F97583;">import</span><span style="color:#E1E4E8;"> { Context } </span><span style="color:#F97583;">from</span><span style="color:#E1E4E8;"> </span><span style="color:#9ECBFF;">&quot;zhin&quot;</span><span style="color:#E1E4E8;">;</span></span>
<span class="line"><span style="color:#F97583;">export</span><span style="color:#E1E4E8;"> </span><span style="color:#F97583;">const</span><span style="color:#E1E4E8;"> </span><span style="color:#79B8FF;">name</span><span style="color:#E1E4E8;"> </span><span style="color:#F97583;">=</span><span style="color:#E1E4E8;"> </span><span style="color:#9ECBFF;">&quot;repeater&quot;</span><span style="color:#E1E4E8;">;</span></span>
<span class="line"><span style="color:#F97583;">export</span><span style="color:#E1E4E8;"> </span><span style="color:#F97583;">function</span><span style="color:#E1E4E8;"> </span><span style="color:#B392F0;">install</span><span style="color:#E1E4E8;">(</span><span style="color:#FFAB70;">ctx</span><span style="color:#F97583;">:</span><span style="color:#E1E4E8;"> </span><span style="color:#B392F0;">Context</span><span style="color:#E1E4E8;">) {}</span></span></code></pre><pre class="shiki github-light vp-code-light"><code><span class="line"><span style="color:#D73A49;">import</span><span style="color:#24292E;"> { Context } </span><span style="color:#D73A49;">from</span><span style="color:#24292E;"> </span><span style="color:#032F62;">&quot;zhin&quot;</span><span style="color:#24292E;">;</span></span>
<span class="line"><span style="color:#D73A49;">export</span><span style="color:#24292E;"> </span><span style="color:#D73A49;">const</span><span style="color:#24292E;"> </span><span style="color:#005CC5;">name</span><span style="color:#24292E;"> </span><span style="color:#D73A49;">=</span><span style="color:#24292E;"> </span><span style="color:#032F62;">&quot;repeater&quot;</span><span style="color:#24292E;">;</span></span>
<span class="line"><span style="color:#D73A49;">export</span><span style="color:#24292E;"> </span><span style="color:#D73A49;">function</span><span style="color:#24292E;"> </span><span style="color:#6F42C1;">install</span><span style="color:#24292E;">(</span><span style="color:#E36209;">ctx</span><span style="color:#D73A49;">:</span><span style="color:#24292E;"> </span><span style="color:#6F42C1;">Context</span><span style="color:#24292E;">) {}</span></span></code></pre></div></div></div><p>这个时候你就已经写好了一个插件，不需要任何额外操作，不过目前这个插件还什么都不能干，我们没有为其编写相应的交互逻辑。</p><h2 id="_2-实现插件交互逻辑" tabindex="-1">2. 实现插件交互逻辑 <a class="header-anchor" href="#_2-实现插件交互逻辑" aria-label="Permalink to &quot;2. 实现插件交互逻辑&quot;">​</a></h2><p>相信你这个时候一定有很多疑问，因为这其中涉及到相当多的概念，<code>Plugin</code> 到底是什么？</p><div class="info custom-block"><p class="custom-block-title">INFO</p><p>当前章节仅提供示例，目的在于让你能自己编写出可以进行简单交互的插件。目前你无需关心这段代码是什么意思，后面会逐一介绍，所以不用着急，让我们继续。</p></div><p>你可以参考下列代码段，在<a href="/api/context.html">上下文</a>上添加一个<a href="/api/middleware.html">中间件</a>，拦截<a href="/api/session.html">消息会话</a>，并将<a href="/interface/element.html">消息元素</a>原封不动回复给用户。</p><div class="vp-code-group vp-adaptive-theme"><div class="tabs"><input type="radio" name="group-lovhJ" id="tab-NdI8RTb" checked="checked"><label for="tab-NdI8RTb">index.js</label><input type="radio" name="group-lovhJ" id="tab-AfFi1ao"><label for="tab-AfFi1ao">src/index.ts</label></div><div class="blocks"><div class="language-js vp-adaptive-theme active"><button title="Copy Code" class="copy"></button><span class="lang">js</span><pre class="shiki github-dark vp-code-dark"><code><span class="line"><span style="color:#79B8FF;">module</span><span style="color:#E1E4E8;">.</span><span style="color:#79B8FF;">exports</span><span style="color:#E1E4E8;"> </span><span style="color:#F97583;">=</span><span style="color:#E1E4E8;"> {</span></span>
<span class="line"><span style="color:#E1E4E8;">  name: </span><span style="color:#9ECBFF;">&quot;repeater&quot;</span><span style="color:#E1E4E8;">,</span></span>
<span class="line"><span style="color:#E1E4E8;">  </span><span style="color:#B392F0;">install</span><span style="color:#E1E4E8;">(</span><span style="color:#FFAB70;">ctx</span><span style="color:#E1E4E8;">) {</span></span>
<span class="line"><span style="color:#E1E4E8;">    ctx.</span><span style="color:#B392F0;">middleware</span><span style="color:#E1E4E8;">(</span><span style="color:#F97583;">async</span><span style="color:#E1E4E8;"> (</span><span style="color:#FFAB70;">session</span><span style="color:#E1E4E8;">, </span><span style="color:#FFAB70;">next</span><span style="color:#E1E4E8;">) </span><span style="color:#F97583;">=&gt;</span><span style="color:#E1E4E8;"> {</span></span>
<span class="line"><span style="color:#E1E4E8;">      </span><span style="color:#F97583;">await</span><span style="color:#E1E4E8;"> session.</span><span style="color:#B392F0;">reply</span><span style="color:#E1E4E8;">(session.elements);</span></span>
<span class="line"><span style="color:#E1E4E8;">      </span><span style="color:#B392F0;">next</span><span style="color:#E1E4E8;">();</span></span>
<span class="line"><span style="color:#E1E4E8;">    });</span></span>
<span class="line"><span style="color:#E1E4E8;">  },</span></span>
<span class="line"><span style="color:#E1E4E8;">};</span></span></code></pre><pre class="shiki github-light vp-code-light"><code><span class="line"><span style="color:#005CC5;">module</span><span style="color:#24292E;">.</span><span style="color:#005CC5;">exports</span><span style="color:#24292E;"> </span><span style="color:#D73A49;">=</span><span style="color:#24292E;"> {</span></span>
<span class="line"><span style="color:#24292E;">  name: </span><span style="color:#032F62;">&quot;repeater&quot;</span><span style="color:#24292E;">,</span></span>
<span class="line"><span style="color:#24292E;">  </span><span style="color:#6F42C1;">install</span><span style="color:#24292E;">(</span><span style="color:#E36209;">ctx</span><span style="color:#24292E;">) {</span></span>
<span class="line"><span style="color:#24292E;">    ctx.</span><span style="color:#6F42C1;">middleware</span><span style="color:#24292E;">(</span><span style="color:#D73A49;">async</span><span style="color:#24292E;"> (</span><span style="color:#E36209;">session</span><span style="color:#24292E;">, </span><span style="color:#E36209;">next</span><span style="color:#24292E;">) </span><span style="color:#D73A49;">=&gt;</span><span style="color:#24292E;"> {</span></span>
<span class="line"><span style="color:#24292E;">      </span><span style="color:#D73A49;">await</span><span style="color:#24292E;"> session.</span><span style="color:#6F42C1;">reply</span><span style="color:#24292E;">(session.elements);</span></span>
<span class="line"><span style="color:#24292E;">      </span><span style="color:#6F42C1;">next</span><span style="color:#24292E;">();</span></span>
<span class="line"><span style="color:#24292E;">    });</span></span>
<span class="line"><span style="color:#24292E;">  },</span></span>
<span class="line"><span style="color:#24292E;">};</span></span></code></pre></div><div class="language-ts vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">ts</span><pre class="shiki github-dark vp-code-dark"><code><span class="line"><span style="color:#F97583;">import</span><span style="color:#E1E4E8;"> { Context } </span><span style="color:#F97583;">from</span><span style="color:#E1E4E8;"> </span><span style="color:#9ECBFF;">&quot;zhin&quot;</span><span style="color:#E1E4E8;">;</span></span>
<span class="line"><span style="color:#F97583;">export</span><span style="color:#E1E4E8;"> </span><span style="color:#F97583;">const</span><span style="color:#E1E4E8;"> </span><span style="color:#79B8FF;">name</span><span style="color:#E1E4E8;"> </span><span style="color:#F97583;">=</span><span style="color:#E1E4E8;"> </span><span style="color:#9ECBFF;">&quot;repeater&quot;</span><span style="color:#E1E4E8;">;</span></span>
<span class="line"><span style="color:#F97583;">export</span><span style="color:#E1E4E8;"> </span><span style="color:#F97583;">function</span><span style="color:#E1E4E8;"> </span><span style="color:#B392F0;">install</span><span style="color:#E1E4E8;">(</span><span style="color:#FFAB70;">ctx</span><span style="color:#F97583;">:</span><span style="color:#E1E4E8;"> </span><span style="color:#B392F0;">Context</span><span style="color:#E1E4E8;">) {</span></span>
<span class="line"><span style="color:#E1E4E8;">  ctx.</span><span style="color:#B392F0;">middleware</span><span style="color:#E1E4E8;">(</span><span style="color:#F97583;">async</span><span style="color:#E1E4E8;"> (</span><span style="color:#FFAB70;">session</span><span style="color:#E1E4E8;">, </span><span style="color:#FFAB70;">next</span><span style="color:#E1E4E8;">) </span><span style="color:#F97583;">=&gt;</span><span style="color:#E1E4E8;"> {</span></span>
<span class="line"><span style="color:#E1E4E8;">    </span><span style="color:#F97583;">await</span><span style="color:#E1E4E8;"> session.</span><span style="color:#B392F0;">reply</span><span style="color:#E1E4E8;">(session.elements);</span></span>
<span class="line"><span style="color:#E1E4E8;">    </span><span style="color:#B392F0;">next</span><span style="color:#E1E4E8;">();</span></span>
<span class="line"><span style="color:#E1E4E8;">  });</span></span>
<span class="line"><span style="color:#E1E4E8;">}</span></span></code></pre><pre class="shiki github-light vp-code-light"><code><span class="line"><span style="color:#D73A49;">import</span><span style="color:#24292E;"> { Context } </span><span style="color:#D73A49;">from</span><span style="color:#24292E;"> </span><span style="color:#032F62;">&quot;zhin&quot;</span><span style="color:#24292E;">;</span></span>
<span class="line"><span style="color:#D73A49;">export</span><span style="color:#24292E;"> </span><span style="color:#D73A49;">const</span><span style="color:#24292E;"> </span><span style="color:#005CC5;">name</span><span style="color:#24292E;"> </span><span style="color:#D73A49;">=</span><span style="color:#24292E;"> </span><span style="color:#032F62;">&quot;repeater&quot;</span><span style="color:#24292E;">;</span></span>
<span class="line"><span style="color:#D73A49;">export</span><span style="color:#24292E;"> </span><span style="color:#D73A49;">function</span><span style="color:#24292E;"> </span><span style="color:#6F42C1;">install</span><span style="color:#24292E;">(</span><span style="color:#E36209;">ctx</span><span style="color:#D73A49;">:</span><span style="color:#24292E;"> </span><span style="color:#6F42C1;">Context</span><span style="color:#24292E;">) {</span></span>
<span class="line"><span style="color:#24292E;">  ctx.</span><span style="color:#6F42C1;">middleware</span><span style="color:#24292E;">(</span><span style="color:#D73A49;">async</span><span style="color:#24292E;"> (</span><span style="color:#E36209;">session</span><span style="color:#24292E;">, </span><span style="color:#E36209;">next</span><span style="color:#24292E;">) </span><span style="color:#D73A49;">=&gt;</span><span style="color:#24292E;"> {</span></span>
<span class="line"><span style="color:#24292E;">    </span><span style="color:#D73A49;">await</span><span style="color:#24292E;"> session.</span><span style="color:#6F42C1;">reply</span><span style="color:#24292E;">(session.elements);</span></span>
<span class="line"><span style="color:#24292E;">    </span><span style="color:#6F42C1;">next</span><span style="color:#24292E;">();</span></span>
<span class="line"><span style="color:#24292E;">  });</span></span>
<span class="line"><span style="color:#24292E;">}</span></span></code></pre></div></div></div><h3 id="测试一下" tabindex="-1">测试一下 <a class="header-anchor" href="#测试一下" aria-label="Permalink to &quot;测试一下&quot;">​</a></h3>`,20);function E(d,h,F,u,g,v){const n=l("ChatMsg"),o=l("ChatHistory");return t(),c("div",null,[y,s(o,null,{default:a(()=>[s(n,{id:"1659488338"},{default:a(()=>[p("hello")]),_:1}),s(n,{id:"1689919782"},{default:a(()=>[p("hello")]),_:1})]),_:1})])}const m=e(i,[["render",E]]);export{C as __pageData,m as default};