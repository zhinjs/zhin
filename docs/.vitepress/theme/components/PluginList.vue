<script setup lang="ts">
import { computed } from 'vue'
import { data } from '../plugins.data'

const props = defineProps<{
  category?: ('game' | 'util' | 'ai' | 'framework' | 'service' | 'adapter')
  limit?: number
}>()

const filteredPlugins = computed(() => {
  let result = props.category 
    ? data.plugins.filter(p => p.category.includes(props.category!))
    : data.plugins
  
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
</script>

<template>
  <div class="plugin-list">
    <div v-if="filteredPlugins.length === 0" class="empty-state">
      <p>暂无插件</p>
    </div>
    
    <div v-else class="plugin-grid">
      <div 
        v-for="plugin in filteredPlugins" 
        :key="plugin.name"
        class="plugin-card"
      >
        <div class="plugin-header">
          <span class="plugin-icon">{{ plugin.icon || '📦' }}</span>
          <div class="plugin-info">
            <h3 class="plugin-name">{{ plugin.displayName }}</h3>
            <code class="plugin-package">{{ plugin.name }}</code>
          </div>
        </div>
        
        <p class="plugin-description">{{ plugin.description }}</p>
        
        <div class="plugin-meta">
          <span class="plugin-author">👤 {{ plugin.author }}</span>
          <span v-if="plugin.version" class="plugin-version">v{{ plugin.version }}</span>
        </div>
        
        <div v-if="plugin.tags && plugin.tags.length" class="plugin-tags">
          <span v-for="tag in plugin.tags" :key="tag" class="tag">
            {{ tag }}
          </span>
        </div>
        
        <div class="plugin-actions">
          <button 
            v-if="plugin.npm" 
            @click="openLink(plugin.npm)"
            class="action-btn npm-btn"
            title="查看 npm"
          >
            📦 npm
          </button>
          <button 
            v-if="plugin.github" 
            @click="openLink(plugin.github)"
            class="action-btn github-btn"
            title="查看 GitHub"
          >
            ⭐ GitHub
          </button>
          <button 
            v-if="plugin.homepage" 
            @click="openLink(plugin.homepage)"
            class="action-btn home-btn"
            title="访问主页"
          >
            🏠 主页
          </button>
        </div>
        
        <div class="plugin-install">
          <code>zhin install {{ plugin.name }}</code>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.plugin-list {
  margin: 24px 0;
}

.plugin-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 16px;
}

/* 平板：3列 */
@media (max-width: 1200px) {
  .plugin-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

/* 手机：1列 */
@media (max-width: 768px) {
  .plugin-grid {
    grid-template-columns: 1fr;
  }
}

.plugin-card {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 16px;
  transition: all 0.25s ease;
  display: flex;
  flex-direction: column;
  gap: 10px;
  cursor: pointer;
}

.plugin-card:hover {
  border-color: var(--vp-c-brand);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}

.plugin-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.plugin-icon {
  font-size: 24px;
  line-height: 1;
  flex-shrink: 0;
}

.plugin-info {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.plugin-name {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-package {
  display: block;
  font-size: 11px;
  color: var(--vp-c-text-3);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-description {
  color: var(--vp-c-text-2);
  font-size: 12px;
  line-height: 1.5;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  min-height: 36px;
}

.plugin-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--vp-c-text-3);
}

.plugin-author,
.plugin-version {
  display: flex;
  align-items: center;
  gap: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-height: 20px;
  overflow: hidden;
}

.tag {
  display: inline-block;
  padding: 1px 6px;
  font-size: 10px;
  background: var(--vp-c-bg);
  border-radius: 3px;
  color: var(--vp-c-text-3);
}

.plugin-actions {
  display: flex;
  gap: 6px;
  margin-top: auto;
}

.action-btn {
  flex: 1;
  padding: 4px 8px;
  font-size: 11px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.action-btn:hover {
  border-color: var(--vp-c-brand);
  color: var(--vp-c-brand);
  background: var(--vp-c-bg-soft);
}

.plugin-install {
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  padding: 6px 8px;
}

.plugin-install code {
  font-size: 10px;
  color: var(--vp-c-text-3);
  word-break: break-all;
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: var(--vp-c-text-3);
  grid-column: 1 / -1;
}
</style>

