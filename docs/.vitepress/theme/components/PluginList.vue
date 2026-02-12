<script setup lang="ts">
import { computed } from 'vue'
import { data } from '../plugins.data'

const props = defineProps<{
  category?: string
  limit?: number
}>()

const filteredPlugins = computed(() => {
  let result = data.plugins

  if (props.category) {
    result = result.filter(p => {
      // 支持 "official" 作为虚拟分类
      if (props.category === 'official') return p.isOfficial
      return p.category.includes(props.category as any)
    })
  }

  if (props.limit) {
    result = result.slice(0, props.limit)
  }

  return result
})

function openLink(url?: string) {
  if (url) {
    window.open(url, '_blank')
  }
}

function formatDate(dateStr?: string) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}
</script>

<template>
  <div class="plugin-list">
    <div v-if="filteredPlugins.length === 0" class="empty-state">
      <p>暂无此分类的插件</p>
    </div>

    <div v-else class="plugin-grid">
      <div
        v-for="plugin in filteredPlugins"
        :key="plugin.name"
        class="plugin-card"
        @click="openLink(plugin.npm)"
      >
        <div class="card-header">
          <h3 class="card-title">{{ plugin.displayName }}</h3>
          <span v-if="plugin.version" class="card-version">v{{ plugin.version }}</span>
        </div>

        <p class="card-package">{{ plugin.name }}</p>

        <p class="card-desc">{{ plugin.description || '暂无描述' }}</p>

        <div class="card-tags" v-if="plugin.category.length">
          <span
            v-for="cat in plugin.category"
            :key="cat"
            class="card-tag"
          >{{ cat }}</span>
        </div>

        <div class="card-footer">
          <span class="card-author">{{ plugin.author }}</span>
          <span v-if="plugin.lastUpdate" class="card-date">{{ formatDate(plugin.lastUpdate) }}</span>
        </div>

        <div class="card-actions">
          <a
            v-if="plugin.npm"
            :href="plugin.npm"
            target="_blank"
            class="card-link"
            @click.stop
          >npm</a>
          <a
            v-if="plugin.github"
            :href="plugin.github"
            target="_blank"
            class="card-link"
            @click.stop
          >GitHub</a>
        </div>

        <div class="card-install">
          <code>pnpm add {{ plugin.name }}</code>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.plugin-list {
  margin: 16px 0;
}

.plugin-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

@media (max-width: 960px) {
  .plugin-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .plugin-grid {
    grid-template-columns: 1fr;
  }
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

.card-version {
  font-size: 12px;
  color: var(--vp-c-text-3);
  white-space: nowrap;
  flex-shrink: 0;
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

.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.card-tag {
  display: inline-block;
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--vp-c-brand);
  background: var(--vp-c-brand-soft);
  border-radius: 6px;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--vp-c-text-3);
  margin-top: 4px;
}

.card-author,
.card-date {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.empty-state {
  text-align: center;
  padding: 48px 20px;
  color: var(--vp-c-text-3);
  font-size: 14px;
}
</style>
