<script setup lang="ts">
import { ref, computed, defineExpose } from 'vue'
import { data } from '../skills.data'

const searchKeyword = ref('')

const searchResults = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  if (!kw) return data.skills

  return data.skills.filter(s =>
    s.name.toLowerCase().includes(kw) ||
    s.description.toLowerCase().includes(kw) ||
    s.keywords?.some(k => k.toLowerCase().includes(kw)) ||
    s.tags?.some(t => t.toLowerCase().includes(kw))
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
  <div class="skill-search">
    <div class="search-box">
      <svg class="search-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        v-model="searchKeyword"
        type="text"
        placeholder="搜索技能名称、描述或标签..."
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

    <div v-if="searchResults.length > 0" class="search-results">
      <p class="results-count">
        共 <strong>{{ searchResults.length }}</strong> 个技能
      </p>
      <div class="results-grid">
        <div
          v-for="skill in searchResults"
          :key="skill.id"
          class="result-card"
        >
          <div class="result-header">
            <h4 class="result-title">{{ skill.name }}</h4>
          </div>
          <p class="result-id">{{ skill.id }}</p>
          <p class="result-desc">{{ skill.description || '暂无描述' }}</p>
          <div class="result-tags" v-if="skill.tags?.length">
            <span v-for="t in skill.tags" :key="t" class="result-tag">{{ t }}</span>
          </div>
          <div class="result-footer">
            <span class="result-author">{{ skill.author || '—' }}</span>
            <span v-if="skill.lastUpdate" class="result-date">{{ formatDate(skill.lastUpdate) }}</span>
          </div>
          <div class="result-actions">
            <code class="install-cmd">zhin skills add {{ skill.id }}</code>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="no-results">
      <p>暂无技能</p>
      <p class="no-results-hint">
        可通过 PR 向仓库贡献技能，或使用
        <code>zhin skills add --new</code>
        本地创建
      </p>
    </div>
  </div>
</template>

<style scoped>
.skill-search {
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
}

.search-results { margin-top: 20px; }

.results-count {
  font-size: 14px;
  color: var(--vp-c-text-2);
  margin: 0 0 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.results-count strong { color: var(--vp-c-brand); font-weight: 600; }

.results-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

@media (max-width: 960px) {
  .results-grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 640px) {
  .results-grid { grid-template-columns: 1fr; }
}

.result-card {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.result-card:hover {
  border-color: var(--vp-c-brand);
  box-shadow: 0 2px 12px rgba(60, 60, 67, 0.08);
}

.result-header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }

.result-title { margin: 0; font-size: 16px; font-weight: 600; color: var(--vp-c-text-1); }

.result-id { margin: 0; font-size: 13px; font-family: var(--vp-font-family-mono); color: var(--vp-c-text-3); }

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

.result-tags { display: flex; flex-wrap: wrap; gap: 6px; }

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

.result-actions { margin-top: 4px; }

.install-cmd {
  display: block;
  padding: 8px 12px;
  font-size: 12px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  color: var(--vp-c-text-2);
}

.no-results { text-align: center; padding: 48px 20px; color: var(--vp-c-text-3); }

.no-results p { margin: 6px 0; font-size: 14px; }

.no-results-hint code { padding: 2px 6px; background: var(--vp-c-bg-soft); border-radius: 4px; }
</style>
