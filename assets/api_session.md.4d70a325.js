import{_ as s,o as n,c as a,O as l}from"./chunks/framework.1156b012.js";const i=JSON.parse('{"title":"会话","description":"","frontmatter":{},"headers":[],"relativePath":"api/session.md","filePath":"api/session.md","lastUpdated":1688200973000}'),p={name:"api/session.md"},o=l(`<h1 id="会话" tabindex="-1">会话 <a class="header-anchor" href="#会话" aria-label="Permalink to &quot;会话&quot;">​</a></h1><p>在zhin中，机器人发出的任何事件，都会被封装为一个统一格式的会话对象，开发者可以通过访问会话对象的属性，来获取对应事件产生的信息。</p><p>下面是会话中的一些常用属性及其类型：</p><div class="language-typescript"><button title="Copy Code" class="copy"></button><span class="lang">typescript</span><pre class="shiki material-theme-palenight"><code><span class="line"><span style="color:#C792EA;">interface</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">Session</span><span style="color:#89DDFF;">&lt;</span><span style="color:#FFCB6B;">P</span><span style="color:#A6ACCD;"> </span><span style="color:#C792EA;">extends</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">keyof</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">Zhin</span><span style="color:#89DDFF;">.</span><span style="color:#FFCB6B;">Adapters</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">=</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">keyof</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">Zhin</span><span style="color:#89DDFF;">.</span><span style="color:#FFCB6B;">Adapters</span><span style="color:#89DDFF;">,</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">E</span><span style="color:#A6ACCD;"> </span><span style="color:#C792EA;">extends</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">keyof</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">Zhin</span><span style="color:#89DDFF;">.</span><span style="color:#FFCB6B;">BotEventMaps</span><span style="color:#A6ACCD;">[</span><span style="color:#FFCB6B;">P</span><span style="color:#A6ACCD;">] </span><span style="color:#89DDFF;">=</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">keyof</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">Zhin</span><span style="color:#89DDFF;">.</span><span style="color:#FFCB6B;">BotEventMaps</span><span style="color:#A6ACCD;">[</span><span style="color:#FFCB6B;">P</span><span style="color:#A6ACCD;">]</span><span style="color:#89DDFF;">&gt;</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">{</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">protocol</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">P</span><span style="color:#89DDFF;">,</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 所使用的适配器</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">type</span><span style="color:#89DDFF;">?:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">string</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 事件类型</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">user_id</span><span style="color:#89DDFF;">?:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">string</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">|</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">number</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 用户id</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">user_name</span><span style="color:#89DDFF;">?:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">string</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 用户名</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">group_id</span><span style="color:#89DDFF;">?:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">string</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">|</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">number</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 群组id 仅在detail_type为group时存在</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">group_name</span><span style="color:#89DDFF;">?:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">string</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 群组名 仅在detail_type为group时存在</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">discuss_id</span><span style="color:#89DDFF;">?:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">string</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">|</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">number</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 讨论组id 仅在detail_type为discuss时存在</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">discuss_name</span><span style="color:#89DDFF;">?:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">string</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 讨论组名 仅在detail_type为discuss时存在</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">channel_id</span><span style="color:#89DDFF;">?:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">string</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 频道id 仅在detail_type为guild时存在</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">channel_name</span><span style="color:#89DDFF;">?:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">string</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 频道名 仅在detail_type为guild时存在</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">guild_id</span><span style="color:#89DDFF;">?:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">string</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 服务器id 仅在detail_type为guild时存在</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">guild_name</span><span style="color:#89DDFF;">?:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">string</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 服务器名 仅在detail_type为guild时存在</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">detail_type</span><span style="color:#89DDFF;">?:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">string</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 事件详细类型</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">zhin</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">Zhin</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 当前zhin实例</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">context</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">Context</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 当前上下文</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">adapter</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">Zhin</span><span style="color:#89DDFF;">.</span><span style="color:#FFCB6B;">Adapters</span><span style="color:#A6ACCD;">[</span><span style="color:#FFCB6B;">P</span><span style="color:#A6ACCD;">] </span><span style="color:#676E95;font-style:italic;">// 当前适配器实例</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">prompt</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">Prompt</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 当前会话的提示输入器</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">content</span><span style="color:#89DDFF;">:</span><span style="color:#FFCB6B;">string</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 消息内容</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">bot</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">Zhin</span><span style="color:#89DDFF;">.</span><span style="color:#FFCB6B;">Bots</span><span style="color:#A6ACCD;">[</span><span style="color:#FFCB6B;">P</span><span style="color:#A6ACCD;">] </span><span style="color:#676E95;font-style:italic;">// 当前机器人实例</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">event</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">E</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 事件完整名</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">quote</span><span style="color:#89DDFF;">?:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">QuoteMessage</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 引用消息</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">message_id</span><span style="color:#89DDFF;">?:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">string</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 消息id 仅在type为message时存在</span></span>
<span class="line"><span style="color:#89DDFF;">}</span></span></code></pre></div><p>除此以外，你还可以访问到会话的一些方法和getter，通过这些方法和getter，你可以获取到更多的信息，或者对会话进行一些操作。</p><div class="language-typescript"><button title="Copy Code" class="copy"></button><span class="lang">typescript</span><pre class="shiki material-theme-palenight"><code><span class="line"><span style="color:#89DDFF;font-style:italic;">import</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">{</span><span style="color:#A6ACCD;">Bot</span><span style="color:#89DDFF;">}</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;font-style:italic;">from</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">&quot;</span><span style="color:#C3E88D;">./bot</span><span style="color:#89DDFF;">&quot;</span><span style="color:#89DDFF;">;</span></span>
<span class="line"><span style="color:#C792EA;">interface</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">Session</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">{</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">middleware</span><span style="color:#89DDFF;">(</span><span style="color:#A6ACCD;font-style:italic;">middleware</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">Middleware</span><span style="color:#89DDFF;">):</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">void</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 在当前会话上添加一个中间件</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">reply</span><span style="color:#89DDFF;">(</span><span style="color:#A6ACCD;font-style:italic;">element</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">Element</span><span style="color:#89DDFF;">.</span><span style="color:#FFCB6B;">Fragment</span><span style="color:#89DDFF;">):</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">Promise</span><span style="color:#89DDFF;">&lt;</span><span style="color:#FFCB6B;">Bot</span><span style="color:#89DDFF;">.</span><span style="color:#FFCB6B;">MessageRet</span><span style="color:#89DDFF;">&gt;</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 回复当前会话</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#F07178;">intercept</span><span style="color:#89DDFF;">(</span><span style="color:#A6ACCD;font-style:italic;">tip</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">Element</span><span style="color:#89DDFF;">.</span><span style="color:#FFCB6B;">Fragment</span><span style="color:#89DDFF;">,</span><span style="color:#A6ACCD;"> </span><span style="color:#82AAFF;">runFunc</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">(</span><span style="color:#A6ACCD;font-style:italic;">session</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">NSession</span><span style="color:#89DDFF;">&lt;keyof</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">Zhin</span><span style="color:#89DDFF;">.</span><span style="color:#FFCB6B;">Adapters</span><span style="color:#89DDFF;">&gt;)</span><span style="color:#A6ACCD;"> </span><span style="color:#C792EA;">=&gt;</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">Element</span><span style="color:#89DDFF;">.</span><span style="color:#FFCB6B;">Fragment</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">|</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">void</span><span style="color:#89DDFF;">,</span><span style="color:#A6ACCD;"> </span><span style="color:#A6ACCD;font-style:italic;">free</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">Element</span><span style="color:#89DDFF;">.</span><span style="color:#FFCB6B;">Fragment</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">|</span><span style="color:#A6ACCD;"> (</span><span style="color:#89DDFF;">(</span><span style="color:#A6ACCD;font-style:italic;">session</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">NSession</span><span style="color:#89DDFF;">&lt;keyof</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">Zhin</span><span style="color:#89DDFF;">.</span><span style="color:#FFCB6B;">Adapters</span><span style="color:#89DDFF;">&gt;)</span><span style="color:#A6ACCD;"> </span><span style="color:#C792EA;">=&gt;</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">boolean</span><span style="color:#A6ACCD;">)</span><span style="color:#89DDFF;">,</span><span style="color:#A6ACCD;"> </span><span style="color:#82AAFF;">filter</span><span style="color:#89DDFF;">?:</span><span style="color:#A6ACCD;"> </span><span style="color:#89DDFF;">(</span><span style="color:#A6ACCD;font-style:italic;">session</span><span style="color:#89DDFF;">:</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">NSession</span><span style="color:#89DDFF;">&lt;keyof</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">Zhin</span><span style="color:#89DDFF;">.</span><span style="color:#FFCB6B;">Adapters</span><span style="color:#89DDFF;">&gt;)</span><span style="color:#A6ACCD;"> </span><span style="color:#C792EA;">=&gt;</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">boolean</span><span style="color:#89DDFF;">):</span><span style="color:#FFCB6B;">void</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 拦截当前会话</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#C792EA;">get</span><span style="color:#A6ACCD;"> </span><span style="color:#F07178;">isMaster</span><span style="color:#89DDFF;">():</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">boolean</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 当前会话发起者是否为主人</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#C792EA;">get</span><span style="color:#A6ACCD;"> </span><span style="color:#F07178;">isAdmins</span><span style="color:#89DDFF;">():</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">boolean</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 当前会话发起者是否为zhin管理员</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#C792EA;">get</span><span style="color:#A6ACCD;"> </span><span style="color:#F07178;">isOwner</span><span style="color:#89DDFF;">():</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">boolean</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 当前会话发起者是否为群主</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#C792EA;">get</span><span style="color:#A6ACCD;"> </span><span style="color:#F07178;">isAdmin</span><span style="color:#89DDFF;">():</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">boolean</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 当前会话发起者是否为群组管理</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#C792EA;">get</span><span style="color:#A6ACCD;"> </span><span style="color:#F07178;">isAtme</span><span style="color:#89DDFF;">():</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">boolean</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 当前会话是否at了机器人</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#C792EA;">get</span><span style="color:#A6ACCD;"> </span><span style="color:#F07178;">isPrivate</span><span style="color:#89DDFF;">():</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">boolean</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 当前会话是否为私聊</span></span>
<span class="line"><span style="color:#A6ACCD;">    </span><span style="color:#C792EA;">get</span><span style="color:#A6ACCD;"> </span><span style="color:#F07178;">isGroup</span><span style="color:#89DDFF;">():</span><span style="color:#A6ACCD;"> </span><span style="color:#FFCB6B;">boolean</span><span style="color:#A6ACCD;"> </span><span style="color:#676E95;font-style:italic;">// 当前会话是否为群聊</span></span>
<span class="line"><span style="color:#89DDFF;">}</span></span></code></pre></div>`,6),t=[o];function e(c,r,y,C,F,D){return n(),a("div",null,t)}const B=s(p,[["render",e]]);export{i as __pageData,B as default};
