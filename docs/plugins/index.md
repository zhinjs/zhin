---
layout: page
sidebar: false
aside: false
---

<div class="plugin-page">

# 插件市场

<p class="page-desc">探索 Zhin.js 生态系统中的插件和适配器</p>

<ClientOnly>
<PluginMarket />
</ClientOnly>

## 平台适配器

<ClientOnly>
<PluginList category="adapter" />
</ClientOnly>

## 服务插件

<ClientOnly>
<PluginList category="service" />
</ClientOnly>

## AI 集成

<ClientOnly>
<PluginList category="ai" />
</ClientOnly>

## 框架核心

<ClientOnly>
<PluginList category="framework" />
</ClientOnly>

## 全部插件

<ClientOnly>
<PluginList />
</ClientOnly>

</div>

<style scoped>
.plugin-page {
  max-width: 1152px;
  margin: 0 auto;
  padding: 0 24px;
}

.page-desc {
  text-align: center;
  font-size: 16px;
  color: var(--vp-c-text-2);
  margin: 8px 0 32px;
}

.plugin-page h1 {
  text-align: center;
  font-size: 2rem;
  font-weight: 700;
  margin-bottom: 4px;
}

.plugin-page h2 {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 40px 0 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--vp-c-divider);
}
</style>
