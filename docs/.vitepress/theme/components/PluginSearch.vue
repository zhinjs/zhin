<script setup lang="ts">
import { ref, computed, watch, defineExpose } from 'vue'
import { data } from '../plugins.data'

const searchKeyword = ref('')

const searchResults = computed(() => {
  if (!searchKeyword.value.trim()) {
    return []
  }
  
  const keyword = searchKeyword.value.toLowerCase()
  return data.plugins.filter(p => 
    p.name.toLowerCase().includes(keyword) ||
    p.displayName.toLowerCase().includes(keyword) ||
    p.description.toLowerCase().includes(keyword) ||
    p.tags?.some(tag => tag.toLowerCase().includes(keyword))
  )
})

// 暴露方法供外部调用
function setSearchKeyword(keyword: string) {
  searchKeyword.value = keyword
}

defineExpose({
  setSearchKeyword
})

function openLink(url?: string) {
  if (url) {
    window.open(url, '_blank')
  }
}

function clearSearch() {
  searchKeyword.value = ''
}
</script>

<template>
  <div class="plugin-search">
    <div class="search-box">
      <span class="search-icon">🔍</span>
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
      >
        ✕
      </button>
    </div>
    
    <div v-if="searchKeyword && searchResults.length > 0" class="search-results">
      <div class="results-header">
        找到 <strong>{{ searchResults.length }}</strong> 个插件
      </div>
      
      <div class="results-list">
        <div 
          v-for="plugin in searchResults" 
          :key="plugin.name"
          class="result-item"
        >
          <div class="result-header">
            <span class="result-icon">{{ plugin.icon || '📦' }}</span>
            <div class="result-info">
              <h4 class="result-name">{{ plugin.displayName }}</h4>
              <code class="result-package">{{ plugin.name }}</code>
            </div>
          </div>
          
          <p class="result-description">{{ plugin.description }}</p>
          
          <div class="result-actions">
            <button 
              v-if="plugin.npm" 
              @click="openLink(plugin.npm)"
              class="result-btn"
            >
              📦 npm
            </button>
            <button 
              v-if="plugin.github" 
              @click="openLink(plugin.github)"
              class="result-btn"
            >
              ⭐ GitHub
            </button>
          </div>
        </div>
      </div>
    </div>
    
    <div v-else-if="searchKeyword && searchResults.length === 0" class="no-results">
      <p>😔 未找到匹配的插件</p>
      <p class="hint">试试其他关键词，或访问 <a href="https://www.npmjs.com/search?q=zhin.js" target="_blank">npm</a> 搜索</p>
    </div>
  </div>
</template>

<style scoped>
.plugin-search {
  margin: 32px 0;
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
  background: var(--vp-c-bg-soft);
  border: 2px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 12px 16px;
  transition: all 0.3s;
}

.search-box:focus-within {
  border-color: var(--vp-c-brand);
  box-shadow: 0 0 0 3px rgba(var(--vp-c-brand-rgb), 0.1);
}

.search-icon {
  font-size: 20px;
  margin-right: 12px;
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 16px;
  color: var(--vp-c-text-1);
}

.search-input::placeholder {
  color: var(--vp-c-text-3);
}

.clear-btn {
  padding: 4px 8px;
  border: none;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-3);
  border-radius: 6px;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  transition: all 0.2s;
}

.clear-btn:hover {
  background: var(--vp-c-divider);
  color: var(--vp-c-text-1);
}

.search-results {
  margin-top: 24px;
}

.results-header {
  font-size: 14px;
  color: var(--vp-c-text-2);
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.results-header strong {
  color: var(--vp-c-brand);
  font-weight: 600;
}

.results-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.result-item {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  padding: 16px;
  transition: all 0.2s;
}

.result-item:hover {
  border-color: var(--vp-c-brand);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.result-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.result-icon {
  font-size: 28px;
}

.result-info {
  flex: 1;
  min-width: 0;
}

.result-name {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.result-package {
  display: block;
  font-size: 12px;
  color: var(--vp-c-text-3);
  margin-top: 2px;
  background: var(--vp-c-bg);
  padding: 2px 6px;
  border-radius: 4px;
  display: inline-block;
}

.result-description {
  margin: 8px 0;
  font-size: 14px;
  color: var(--vp-c-text-2);
  line-height: 1.5;
}

.result-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.result-btn {
  padding: 6px 12px;
  font-size: 13px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  cursor: pointer;
  transition: all 0.2s;
}

.result-btn:hover {
  border-color: var(--vp-c-brand);
  color: var(--vp-c-brand);
}

.no-results {
  text-align: center;
  padding: 48px 20px;
  color: var(--vp-c-text-3);
}

.no-results p {
  margin: 8px 0;
}

.no-results .hint {
  font-size: 14px;
}

.no-results a {
  color: var(--vp-c-brand);
  text-decoration: none;
}

.no-results a:hover {
  text-decoration: underline;
}
</style>

