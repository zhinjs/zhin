import { h } from 'vue'
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import ZhinHero from './components/ZhinHero.vue'
import ZhinTerminal from './components/ZhinTerminal.vue'
import ZhinFeatureGrid from './components/ZhinFeatureGrid.vue'
import ZhinDuo from './components/ZhinDuo.vue'
import ZhinSidebarFoot from './components/ZhinSidebarFoot.vue'
import ZhinRolePaths from './components/ZhinRolePaths.vue'
import DocsInsightsConsent from './components/DocsInsightsConsent.vue'
import { installDocsInsights } from './docs-insights.js'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      'sidebar-nav-after': () => h(ZhinSidebarFoot),
      'layout-bottom': () => h(DocsInsightsConsent),
    })
  },
  enhanceApp({ app, router, siteData }) {
    // 注册全局组件
    app.component('ZhinHero', ZhinHero)
    app.component('ZhinTerminal', ZhinTerminal)
    app.component('ZhinFeatureGrid', ZhinFeatureGrid)
    app.component('ZhinDuo', ZhinDuo)
    app.component('ZhinSidebarFoot', ZhinSidebarFoot)
    app.component('ZhinRolePaths', ZhinRolePaths)
    app.component('DocsInsightsConsent', DocsInsightsConsent)
    if (!import.meta.env.SSR) {
      const disposeInsights = installDocsInsights(router, {
        endpoint: import.meta.env.VITE_DOCS_INSIGHTS_ENDPOINT ?? '',
        siteId: import.meta.env.VITE_DOCS_INSIGHTS_SITE_ID ?? 'zhin-docs',
      })
      app.onUnmount(disposeInsights)
    }
  }
} satisfies Theme
