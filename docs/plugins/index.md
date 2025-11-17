---
layout: page
sidebar: false
aside: false
---

<div class="plugin-market-container">

# 🔌 插件市场

<div class="market-header">
  <p class="market-desc">探索 Zhin.js 生态系统</p>
</div>

<ClientOnly>
<PluginMarket />
</ClientOnly>

## ✨ 官方插件

<ClientOnly>
<PluginList category="official" />
</ClientOnly>

## 🔌 平台适配器

<ClientOnly>
<PluginList category="adapters" />
</ClientOnly>

## 🎮 游戏娱乐

<ClientOnly>
<PluginList category="games" />
</ClientOnly>

## 🛠️ 实用工具

<ClientOnly>
<PluginList category="utils" />
</ClientOnly>

## 🤖 AI 集成

<ClientOnly>
<PluginList category="ai" />
</ClientOnly>

## 📊 数据服务

<ClientOnly>
<PluginList category="services" />
</ClientOnly>

</div>

<style scoped>
.plugin-market-container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 24px;
}

.market-header {
  text-align: center;
  margin: 2rem 0 3rem;
}

.market-desc {
  font-size: 1.1rem;
  color: var(--vp-c-text-2);
  margin: 0.5rem 0 2rem;
}

/* 标题样式 */
.plugin-market-container h1 {
  text-align: center;
  font-size: 2.5rem;
  margin-bottom: 0.5rem;
}

.plugin-market-container h2 {
  font-size: 1.5rem;
  margin: 3rem 0 1.5rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--vp-c-divider);
}
</style>
