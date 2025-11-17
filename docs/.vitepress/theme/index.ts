import { h } from 'vue'
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import PluginList from './components/PluginList.vue'
import PluginSearch from './components/PluginSearch.vue'
import PluginStats from './components/PluginStats.vue'
import PluginMarket from './components/PluginMarket.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      // https://vitepress.dev/guide/extending-default-theme#layout-slots
    })
  },
  enhanceApp({ app, router, siteData }) {
    // 注册全局组件
    app.component('PluginList', PluginList)
    app.component('PluginSearch', PluginSearch)
    app.component('PluginStats', PluginStats)
    app.component('PluginMarket', PluginMarket)
  }
} satisfies Theme

