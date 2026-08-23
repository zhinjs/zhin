import { h } from 'vue'
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import PluginList from './components/PluginList.vue'
import PluginSearch from './components/PluginSearch.vue'
import PluginStats from './components/PluginStats.vue'
import PluginMarket from './components/PluginMarket.vue'
import Playground from './components/Playground.vue'
import ZhinHero from './components/ZhinHero.vue'
import ZhinTerminal from './components/ZhinTerminal.vue'
import ZhinFeatureGrid from './components/ZhinFeatureGrid.vue'
import ZhinDuo from './components/ZhinDuo.vue'
import ZhinSidebarFoot from './components/ZhinSidebarFoot.vue'
import ZhinRolePaths from './components/ZhinRolePaths.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      'sidebar-nav-after': () => h(ZhinSidebarFoot),
    })
  },
  enhanceApp({ app, router, siteData }) {
    // 注册全局组件
    app.component('PluginList', PluginList)
    app.component('PluginSearch', PluginSearch)
    app.component('PluginStats', PluginStats)
    app.component('PluginMarket', PluginMarket)
    app.component('Playground', Playground)
    app.component('ZhinHero', ZhinHero)
    app.component('ZhinTerminal', ZhinTerminal)
    app.component('ZhinFeatureGrid', ZhinFeatureGrid)
    app.component('ZhinDuo', ZhinDuo)
    app.component('ZhinSidebarFoot', ZhinSidebarFoot)
    app.component('ZhinRolePaths', ZhinRolePaths)
  }
} satisfies Theme
