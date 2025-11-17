<script setup lang="ts">
import { data } from '../plugins.data'

const stats = data.stats

// 定义事件
const emit = defineEmits<{
  filter: [keyword: string]
}>()

// 点击统计项时触发搜索
function handleStatClick(keyword: string) {
  emit('filter', keyword)
}
</script>

<template>
  <div class="plugin-stats">
    <div class="stat-item clickable" @click="handleStatClick('')" title="显示所有插件">
      <span class="stat-number">{{ stats?.total || 0 }}</span>
      <span class="stat-label">个插件</span>
    </div>
    <div class="stat-divider">·</div>
    <div class="stat-item clickable" @click="handleStatClick('@zhin.js')" title="搜索官方插件">
      <span class="stat-number">{{ stats?.official || 0 }}</span>
      <span class="stat-label">个官方</span>
    </div>
    <div class="stat-divider">·</div>
    <div class="stat-item clickable" @click="handleStatClick('adapter')" title="搜索适配器">
      <span class="stat-number">{{ stats?.adapters || 0 }}</span>
      <span class="stat-label">个适配器</span>
    </div>
    <div class="stat-divider">·</div>
    <div class="stat-item clickable" @click="handleStatClick('zhin.js-')" title="搜索社区插件">
      <span class="stat-number">{{ stats?.community || 0 }}</span>
      <span class="stat-label">个社区</span>
    </div>
  </div>
</template>

<style scoped>
.plugin-stats {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 12px 24px;
  background: var(--vp-c-bg-soft);
  border-radius: 24px;
  display: inline-flex;
  margin: 0 auto;
}

.stat-item {
  display: flex;
  align-items: baseline;
  gap: 4px;
  transition: all 0.2s ease;
}

.stat-item.clickable {
  cursor: pointer;
  padding: 4px 8px;
  margin: -4px -8px;
  border-radius: 8px;
}

.stat-item.clickable:hover {
  background: var(--vp-c-bg);
}

.stat-item.clickable:hover .stat-number {
  color: var(--vp-c-brand-dark);
  transform: scale(1.1);
}

.stat-item.clickable:hover .stat-label {
  color: var(--vp-c-text-1);
}

.stat-number {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--vp-c-brand);
  line-height: 1;
  transition: all 0.2s ease;
}

.stat-label {
  font-size: 0.875rem;
  color: var(--vp-c-text-2);
  font-weight: 500;
  transition: all 0.2s ease;
}

.stat-divider {
  color: var(--vp-c-divider);
  font-size: 1.2rem;
}

@media (max-width: 640px) {
  .plugin-stats {
    flex-wrap: wrap;
    justify-content: center;
  }
  
  .stat-number {
    font-size: 1.25rem;
  }
  
  .stat-label {
    font-size: 0.75rem;
  }
}
</style>

