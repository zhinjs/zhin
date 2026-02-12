<script setup lang="ts">
import { ref, computed, defineExpose } from 'vue'
import { data } from '../plugins.data'

const searchKeyword = ref('')

const searchResults = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  if (!kw) return []

  return data.plugins.filter(p =>
    p.name.toLowerCase().includes(kw) ||
    p.displayName.toLowerCase().includes(kw) ||
    p.description.toLowerCase().includes(kw) ||
    p.tags?.some(tag => tag.toLowerCase().includes(kw))
  )
})

function setSearchKeyword(keyword: string) {
  searchKeyword.value = keyword
}

defineExpose({ setSearchKeyword })

function clearSearch() {
  searchKeyword.value = ''
}

function formatDate(dateStr?: string) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}
</script>

<template>
  <div class="plugin-search">
    <div class="search-box">
      <svg class="search-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        v-model="searchKeyword"
        type="text"
        placeholder="搜索插件名称、描述或标签..."
        class="search-input"
      />
      <button
        v-if="searchKeyword"
        @click="clearSearch"
        class="clear-btn"
        title="清除"
        aria-label="清除搜索"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <!-- 搜索结果 -->
    <div v-if="searchKeyword && searchResults.length > 0" class="search-results">
      <p class="results-count">
        找到 <strong>{{ searchResults.length }}</strong> 个插件
      </p>

      <div class="results-grid">
        <div
          v-for="plugin in searchResults"
          :key="plugin.name"
          class="result-card"
        >
          <div class="result-header">
            <h4 class="result-title">{{ plugin.displayName }}</h4>
            <span v-if="plugin.version" class="result-version">v{{ plugin.version }}</span>
          </div>

          <p class="result-package">{{ plugin.name }}</p>
          <p class="result-desc">{{ plugin.description || '暂无描述' }}</p>

          <div class="result-tags" v-if="plugin.category.length">
            <span v-for="cat in plugin.category" :key="cat" class="result-tag">{{ cat }}</span>
          </div>

          <div class="result-footer">
            <span class="result-author">{{ plugin.author }}</span>
            <span v-if="plugin.lastUpdate" class="result-date">{{ formatDate(plugin.lastUpdate) }}</span>
          </div>

          <div class="result-actions">
            <a v-if="plugin.npm" :href="plugin.npm" target="_blank" class="result-link">npm</a>
            <a v-if="plugin.github" :href="plugin.github" target="_blank" class="result-link">GitHub</a>
          </div>
        </div>
      </div>
    </div>

    <!-- 无结果 -->
    <div v-else-if="searchKeyword && searchResults.length === 0" class="no-results">
      <p>未找到匹配的插件</p>
      <p class="no-results-hint">
        试试其他关键词，或前往
        <a href="https://www.npmjs.com/search?q=zhin.js" target="_blank">npm</a>
        搜索
      </p>
    </div>
  </div>
</template>

<style scoped>
.plugin-search {
  margin: 24px 0;
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 10px 16px;
  transition: border-color 0.25s, box-shadow 0.25s;
}

.search-box:focus-within {
  border-color: var(--vp-c-brand);
  box-shadow: 0 0 0 3px var(--vp-c-brand-soft);
}

.search-icon {
  flex-shrink: 0;
  margin-right: 10px;
  color: var(--vp-c-text-3);
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 15px;
  color: var(--vp-c-text-1);
  font-family: inherit;
}

.search-input::placeholder {
  color: var(--vp-c-text-3);
}

.clear-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: none;
  background: none;
  color: var(--vp-c-text-3);
  cursor: pointer;
  border-radius: 6px;
  transition: color 0.25s, background 0.25s;
}

.clear-btn:hover {
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
}

/* Results */
.search-results {
  margin-top: 20px;
}

.results-count {
  font-size: 14px;
  color: var(--vp-c-text-2);
  margin: 0 0 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.results-count strong {
  color: var(--vp-c-brand);
  font-weight: 600;
}

.results-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

@media (max-width: 960px) {
  .results-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .results-grid {
    grid-template-columns: 1fr;
  }
}

.result-card {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: border-color 0.25s, box-shadow 0.25s;
}

.result-card:hover {
  border-color: var(--vp-c-brand);
  box-shadow: 0 2px 12px rgba(60, 60, 67, 0.08);
}

.result-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.result-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.result-version {
  font-size: 12px;
  color: var(--vp-c-text-3);
  flex-shrink: 0;
}

.result-package {
  margin: 0;
  font-size: 13px;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-3);
}

.result-desc {
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

.result-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.result-tag {
  display: inline-block;
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--vp-c-brand);
  background: var(--vp-c-brand-soft);
  border-radius: 6px;
}

.result-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--vp-c-text-3);
}

.result-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.result-link {
  padding: 4px 12px;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  color: var(--vp-c-text-2);
  text-decoration: none;
  transition: border-color 0.25s, color 0.25s;
}

.result-link:hover {
  border-color: var(--vp-c-brand);
  color: var(--vp-c-brand);
}

/* No results */
.no-results {
  text-align: center;
  padding: 48px 20px;
  color: var(--vp-c-text-3);
}

.no-results p {
  margin: 6px 0;
  font-size: 14px;
}

.no-results-hint a {
  color: var(--vp-c-brand);
  font-weight: 500;
  text-decoration: none;
}

.no-results-hint a:hover {
  text-decoration: underline;
}
</style>
