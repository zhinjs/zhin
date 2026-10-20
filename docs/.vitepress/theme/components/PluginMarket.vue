<script setup lang="ts">
import { ref, computed } from 'vue'
import { data } from '../plugins.data'
import PluginStats from './PluginStats.vue'
import PluginSearch from './PluginSearch.vue'

const searchRef = ref<InstanceType<typeof PluginSearch>>()
const activeOwner = ref<'all' | 'official' | 'community'>('all')

const CATEGORY_LABELS: Record<string, string> = {
  adapter: '适配器',
  service: '服务',
  util: '工具',
  game: '游戏',
  feature: '特性',
}

function handleFilter(keyword: string) {
  // owner filters
  if (keyword === 'official' || keyword === 'community') {
    activeOwner.value = keyword
    return
  }
  if (keyword === '') {
    activeOwner.value = 'all'
    return
  }
  // category filters → pass to search
  if (searchRef.value) {
    searchRef.value.setSearchKeyword(keyword)
  }
}

// 按类型分组
const groupedPlugins = computed(() => {
  let plugins = data.plugins
  if (activeOwner.value === 'official') plugins = plugins.filter(p => p.isOfficial)
  else if (activeOwner.value === 'community') plugins = plugins.filter(p => !p.isOfficial)

  const groups: Record<string, typeof plugins> = {}
  for (const p of plugins) {
    const cat = p.category || 'util'
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(p)
  }

  // 固定顺序
  const order = ['adapter', 'service', 'util', 'game', 'feature']
  return order
    .filter(cat => groups[cat]?.length)
    .map(cat => ({ key: cat, label: CATEGORY_LABELS[cat] || cat, plugins: groups[cat] }))
})

const ownerTabs = [
  { key: 'all', label: '全部' },
  { key: 'official', label: '官方插件' },
  { key: 'community', label: '社区插件' },
] as const

function openLink(url?: string) {
  if (url) window.open(url, '_blank')
}
</script>

<template>
  <div class="plugin-market">
    <PluginStats @filter="handleFilter" />
    <PluginSearch ref="searchRef" />

    <!-- Owner tabs -->
    <div class="owner-tabs">
      <button
        v-for="tab in ownerTabs"
        :key="tab.key"
        type="button"
        class="owner-tab"
        :class="{ active: activeOwner === tab.key }"
        @click="activeOwner = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Grouped sections -->
    <div v-for="group in groupedPlugins" :key="group.key" class="category-section">
      <h3 class="category-title">
        {{ group.label }}
        <span class="category-count">{{ group.plugins.length }}</span>
      </h3>
      <div class="plugin-grid">
        <div
          v-for="plugin in group.plugins"
          :key="plugin.name"
          class="plugin-card"
          @click="openLink(plugin.npm)"
        >
          <div class="card-header">
            <h4 class="card-title">{{ plugin.displayName }}</h4>
            <div class="card-badges">
              <span v-if="plugin.isOfficial" class="badge-official">官方</span>
              <span v-if="plugin.version" class="card-version">v{{ plugin.version }}</span>
            </div>
          </div>
          <p class="card-package">{{ plugin.name }}</p>
          <p class="card-desc">{{ plugin.description || '暂无描述' }}</p>

          <div class="card-meta" v-if="plugin.downloads?.weekly || plugin.license">
            <span v-if="plugin.downloads?.weekly" class="card-downloads">
              ↓ {{ plugin.downloads.weekly >= 1000 ? (plugin.downloads.weekly / 1000).toFixed(1) + 'k' : plugin.downloads.weekly }}/周
            </span>
            <span v-if="plugin.license" class="card-license">{{ plugin.license }}</span>
          </div>

          <div class="card-footer">
            <span class="card-author">{{ plugin.author }}</span>
            <span v-if="plugin.lastUpdate" class="card-date">{{ new Date(plugin.lastUpdate).toLocaleDateString('zh-CN') }}</span>
          </div>

          <div class="card-actions">
            <a v-if="plugin.npm" :href="plugin.npm" target="_blank" class="card-link" @click.stop>npm</a>
            <a v-if="plugin.github" :href="plugin.github" target="_blank" class="card-link" @click.stop>GitHub</a>
          </div>

          <div class="card-install">
            <code>pnpm add {{ plugin.name }}</code>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.plugin-market {
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin: 24px 0;
}

/* Owner tabs */
.owner-tabs {
  display: flex;
  gap: 8px;
  border-bottom: 1px solid var(--vp-c-divider);
  padding-bottom: 8px;
}

.owner-tab {
  padding: 6px 16px;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  background: none;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.25s;
  font-family: inherit;
}

.owner-tab:hover {
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-soft);
}

.owner-tab.active {
  color: var(--vp-c-brand);
  border-color: var(--vp-c-brand);
  background: var(--vp-c-brand-soft);
}

/* Category sections */
.category-section {
  margin-top: 8px;
}

.category-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin: 0 0 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.category-count {
  font-size: 13px;
  font-weight: 500;
  color: var(--vp-c-text-3);
  background: var(--vp-c-bg-soft);
  padding: 1px 8px;
  border-radius: 10px;
}

/* Plugin grid */
.plugin-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

@media (max-width: 960px) {
  .plugin-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 640px) {
  .plugin-grid { grid-template-columns: 1fr; }
}

.plugin-card {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: pointer;
  transition: border-color 0.25s, box-shadow 0.25s;
}

.plugin-card:hover {
  border-color: var(--vp-c-brand);
  box-shadow: 0 2px 12px rgba(60, 60, 67, 0.08);
}

.card-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.card-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  line-height: 1.4;
}

.card-badges {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-shrink: 0;
}

.badge-official {
  font-size: 11px;
  font-weight: 600;
  color: var(--vp-c-brand);
  background: var(--vp-c-brand-soft);
  padding: 1px 8px;
  border-radius: 6px;
}

.card-version {
  font-size: 12px;
  color: var(--vp-c-text-3);
  white-space: nowrap;
}

.card-package {
  margin: 0;
  font-size: 13px;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-desc {
  margin: 4px 0 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex: 1;
}

.card-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--vp-c-text-3);
}

.card-downloads {
  color: var(--vp-c-green-2);
  font-weight: 500;
}

.card-license {
  padding: 1px 6px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  font-size: 11px;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--vp-c-text-3);
}

.card-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.card-link {
  padding: 4px 12px;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  color: var(--vp-c-text-2);
  text-decoration: none;
  transition: border-color 0.25s, color 0.25s;
}

.card-link:hover {
  border-color: var(--vp-c-brand);
  color: var(--vp-c-brand);
}

.card-install {
  margin-top: 4px;
  padding: 8px 12px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
}

.card-install code {
  font-size: 13px;
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
  word-break: break-all;
}
</style>
