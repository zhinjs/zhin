import{_ as s,c as i,o as a,V as n}from"./chunks/framework.kfMHwhgJ.js";const g=JSON.parse('{"title":"官方适配器(onebot)","description":"","frontmatter":{},"headers":[],"relativePath":"config/adapter-onebot.md","filePath":"config/adapter-onebot.md","lastUpdated":1695871774000}'),t={name:"config/adapter-onebot.md"},e=n(`<h1 id="官方适配器-onebot" tabindex="-1">官方适配器(onebot) <a class="header-anchor" href="#官方适配器-onebot" aria-label="Permalink to &quot;官方适配器(onebot)&quot;">​</a></h1><h2 id="介绍" tabindex="-1">介绍 <a class="header-anchor" href="#介绍" aria-label="Permalink to &quot;介绍&quot;">​</a></h2><p><a href="https://www.npmjs.com/package/@zhinjs/adapter-onebot" target="_blank" rel="noreferrer">OneBot</a> 适配器是一个支持 <a href="https://12.onebot.dev/" target="_blank" rel="noreferrer">OneBot12</a> 标准的适配器，可以连接到任何支持 OneBot12 标准的机器人平台。</p><div class="tip custom-block"><p class="custom-block-title">TIP</p><p>你可以使用<a href="https://icqqjs.github.io/onebots/" target="_blank" rel="noreferrer">onebots</a>来快速部署一个符合 <code>OneBot12</code> 标准的QQ机器人服务。</p></div><h2 id="接入到zhin" tabindex="-1">接入到zhin <a class="header-anchor" href="#接入到zhin" aria-label="Permalink to &quot;接入到zhin&quot;">​</a></h2><h3 id="_1-安装适配器" tabindex="-1">1.安装适配器 <a class="header-anchor" href="#_1-安装适配器" aria-label="Permalink to &quot;1.安装适配器&quot;">​</a></h3><ul><li>在项目根目录下执行以下命令安装适配器</li></ul><div class="language-bash vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki shiki-themes github-light github-dark vp-code"><code><span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">npm</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> i</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> @zhinjs/adapter-onebot</span></span></code></pre></div><h3 id="_2-配置适配器" tabindex="-1">2.配置适配器 <a class="header-anchor" href="#_2-配置适配器" aria-label="Permalink to &quot;2.配置适配器&quot;">​</a></h3><ul><li>在配置文件<code>zhin.yaml</code>的<code>adapters</code>中增加如下配置，即可接入一个 <code>onebot</code> 机器人：</li></ul><div class="vp-code-group vp-adaptive-theme"><div class="tabs"><input type="radio" name="group-EwM3B" id="tab-UBa3vE2" checked="checked"><label for="tab-UBa3vE2">HTTP</label><input type="radio" name="group-EwM3B" id="tab-ZlwqzQg"><label for="tab-ZlwqzQg">Webhook</label><input type="radio" name="group-EwM3B" id="tab-mkZjtRx"><label for="tab-mkZjtRx">WebSocket</label><input type="radio" name="group-EwM3B" id="tab-MDTfuqd"><label for="tab-MDTfuqd">WebSocket Reverse</label></div><div class="blocks"><div class="language-yaml vp-adaptive-theme active"><button title="Copy Code" class="copy"></button><span class="lang">yaml</span><pre class="shiki shiki-themes github-light github-dark vp-code"><code><span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">adapters</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">:</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">  onebot</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">:</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">    bots</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">:</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      - </span><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">self_id</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">147258369</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">        type</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">http</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">        url</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">http://host:port/path</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> # oneBot http api 地址</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">        access_token</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">123456789</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> # oneBot http api token</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">        get_events_interval</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">1000</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> # 获取事件间隔</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">        events_buffer_size</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">100</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> # 事件缓冲区大小</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">        timeout</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">10000</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> # 请求超时时间</span></span></code></pre></div><div class="language-yaml vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">yaml</span><pre class="shiki shiki-themes github-light github-dark vp-code"><code><span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">adapters</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">:</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">  onebot</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">:</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">    bots</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">:</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      - </span><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">self_id</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">147258369</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">        type</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">webhook</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">        path</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">/path</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> # oneBot webhook挂载路径</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">        get_actions_path</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">/path</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> # 获取动作缓存路径</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">        access_token</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">123456789</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> # oneBot http api token</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">        timeout</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">10000</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> # 请求超时时间</span></span></code></pre></div><div class="language-yaml vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">yaml</span><pre class="shiki shiki-themes github-light github-dark vp-code"><code><span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">adapters</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">:</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">  onebot</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">:</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">    bots</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">:</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      - </span><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">self_id</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">147258369</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">        type</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">ws</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">        url</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">ws://host:port/path</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> # oneBot ws api 地址</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">        access_token</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">123456789</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> # oneBot ws api token</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">        reconnect_interval</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">1000</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> # 重连间隔</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">        max_reconnect_times</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">10</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> # 最大重连次数</span></span></code></pre></div><div class="language-yaml vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">yaml</span><pre class="shiki shiki-themes github-light github-dark vp-code"><code><span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">adapters</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">:</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">  onebot</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">:</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">    bots</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">:</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      - </span><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">self_id</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">147258369</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">        type</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">ws_reverse</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">        path</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">/path</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> # oneBot ws_reverse挂载路径</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">        access_token</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">123456789</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> # oneBot ws api token</span></span></code></pre></div><ul><li>其中 <code>self_id</code> 对应<code>onebot</code> 的 <code>self_id</code>，作为一个机器人的唯一标识</li><li><code>type</code> 代表你要连接的方式，目前支持 <code>http</code>、<code>webhook</code>、<code>ws</code>、<code>ws_reverse</code></li></ul><h3 id="_3-启动" tabindex="-1">3.启动 <a class="header-anchor" href="#_3-启动" aria-label="Permalink to &quot;3.启动&quot;">​</a></h3><p>配置完成后，重启 <code>zhin</code>，将自动开始连接 对应的 <code>onebot</code> 机器人</p></div></div>`,11),h=[e];function l(p,k,d,r,o,E){return a(),i("div",null,h)}const y=s(t,[["render",l]]);export{g as __pageData,y as default};
