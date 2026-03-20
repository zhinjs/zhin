<script setup lang="ts">
import { ref, computed, defineExpose } from 'vue'
import { data } from '../skills.data'
import type { SkillInfo, SkillKind } from '../skills.data'

const searchKeyword = ref('')
const category = ref<'all' | SkillKind>('all')

const baseList = computed(() => {
  const list = data.skills
  if (category.value === 'all') return list
  return list.filter(s => (s.kind ?? 'universal') === category.value)
})

const searchResults = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  if (!kw) return baseList.value

  return baseList.value.filter(s =>
    s.name.toLowerCase().includes(kw) ||
    s.description.toLowerCase().includes(kw) ||
    s.keywords?.some(k => k.toLowerCase().includes(kw)) ||
    s.tags?.some(t => t.toLowerCase().includes(kw)) ||
    s.id.toLowerCase().includes(kw) ||
    s.pluginPackage?.toLowerCase().includes(kw),
  )
})

const counts = computed(() => {
  const u = data.skills.filter(s => s.kind === 'universal' || !s.kind).length
  const p = data.skills.filter(s => s.kind === 'plugin').length
  return { all: data.skills.length, universal: u, plugin: p }
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

function githubMainUrl(repoPath?: string) {
  if (!repoPath) return ''
  return `https://github.com/zhinjs/zhin/blob/main/${repoPath}`
}

function kindLabel(skill: SkillInfo) {
  if (skill.kind === 'plugin') return '插件技能'
  return '通用技能'
}

function kindClass(skill: SkillInfo) {
  return skill.kind === 'plugin' ? 'kind-plugin' : 'kind-universal'
}
</script>

<template>
  <div class="skill-search">
    <div class="category-tabs" role="tablist" aria-label="技能分类">
      <button
        type="button"
        role="tab"
        :aria-selected="category === 'all'"
        class="tab"
        :class="{ active: category === 'all' }"
        @click="category = 'all'"
      >
        全部 <span class="tab-count">{{ counts.all }}</span>
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="category === 'universal'"
        class="tab"
        :class="{ active: category === 'universal' }"
        @click="category = 'universal'"
      >
        通用技能 <span class="tab-count">{{ counts.universal }}</span>
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="category === 'plugin'"
        class="tab"
        :class="{ active: category === 'plugin' }"
        @click="category = 'plugin'"
      >
        插件技能 <span class="tab-count">{{ counts.plugin }}</span>
      </button>
    </div>

    <div class="search-box">
      <svg class="search-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        v-model="searchKeyword"
        type="text"
        placeholder="搜索技能名称、描述、包名或标签..."
        class="search-input"
      />
      <button
        v-if="searchKeyword"
        class="clear-btn"
        title="清除"
        aria-label="清除搜索"
        @click="clearSearch"
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
        <span v-if="data.updatedAt" class="updated-at">（目录更新 {{ formatDate(data.updatedAt) }}）</span>
      </p>
      <div class="results-grid">
        <div
          v-for="skill in searchResults"
          :key="skill.id"
          class="result-card"
        >
          <div class="result-header">
            <h4 class="result-title">{{ skill.name }}</h4>
            <span class="kind-badge" :class="kindClass(skill)">{{ kindLabel(skill) }}</span>
          </div>
          <p class="result-id">{{ skill.id }}</p>
          <p v-if="skill.pluginPackage" class="result-pkg">
            npm: <code>{{ skill.pluginPackage }}</code>
          </p>
          <p class="result-desc">{{ skill.description || '暂无描述' }}</p>
          <div v-if="skill.tags?.length" class="result-tags">
            <span v-for="t in skill.tags" :key="t" class="result-tag">{{ t }}</span>
          </div>
          <div class="result-footer">
            <span class="result-author">{{ skill.author || '—' }}</span>
            <span v-if="skill.lastUpdate" class="result-date">{{ formatDate(skill.lastUpdate) }}</span>
          </div>
          <div class="result-actions">
            <p v-if="skill.installNote" class="install-note">{{ skill.installNote }}</p>
            <template v-if="skill.source">
              <code class="install-cmd">zhin skills add {{ skill.id }}</code>
            </template>
            <a
              v-if="skill.repoPath"
              class="source-link"
              :href="githubMainUrl(skill.repoPath)"
              target="_blank"
              rel="noopener noreferrer"
            >
              查看 SKILL.md 源码
            </a>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="no-results">
      <p>暂无匹配技能</p>
      <p class="no-results-hint">
        可切换上方分类，或使用
        <code>zhin skills search</code>
        查看线上 registry；本地可用
        <code>zhin skills add --new</code>
        创建技能
      </p>
    </div>
  </div>
</template>

<style scoped>
.skill-search {
  margin: 24px 0;
}

.category-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-size: 14px;
  font-weight: 500;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s, color 0.2s;
}

.tab:hover {
  border-color: var(--vp-c-brand);
  color: var(--vp-c-text-1);
}

.tab.active {
  border-color: var(--vp-c-brand);
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand);
}

.tab-count {
  font-size: 12px;
  opacity: 0.85;
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

.updated-at {
  font-size: 13px;
  color: var(--vp-c-text-3);
  font-weight: normal;
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

.result-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }

.result-title { margin: 0; font-size: 16px; font-weight: 600; color: var(--vp-c-text-1); flex: 1; min-width: 0; }

.kind-badge {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 6px;
  text-transform: none;
}

.kind-badge.kind-universal {
  color: var(--vp-c-green-1, #18794e);
  background: var(--vp-c-green-soft, #d1fae5);
}

.kind-badge.kind-plugin {
  color: var(--vp-c-brand);
  background: var(--vp-c-brand-soft);
}

.result-id { margin: 0; font-size: 13px; font-family: var(--vp-font-family-mono); color: var(--vp-c-text-3); }

.result-pkg {
  margin: 0;
  font-size: 12px;
  color: var(--vp-c-text-3);
}

.result-pkg code {
  font-size: 12px;
  padding: 1px 6px;
  background: var(--vp-c-bg);
  border-radius: 4px;
}

.result-desc {
  margin: 4px 0 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  display: -webkit-box;
  -webkit-line-clamp: 3;
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

.result-actions { margin-top: 8px; display: flex; flex-direction: column; gap: 8px; }

.install-note {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}

.install-cmd {
  display: block;
  padding: 8px 12px;
  font-size: 12px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  color: var(--vp-c-text-2);
}

.source-link {
  font-size: 13px;
  color: var(--vp-c-brand);
  text-decoration: none;
}

.source-link:hover {
  text-decoration: underline;
}

.no-results { text-align: center; padding: 48px 20px; color: var(--vp-c-text-3); }

.no-results p { margin: 6px 0; font-size: 14px; }

.no-results-hint code { padding: 2px 6px; background: var(--vp-c-bg-soft); border-radius: 4px; }
</style>
