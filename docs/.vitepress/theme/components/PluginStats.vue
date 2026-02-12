<script setup lang="ts">
import { data } from '../plugins.data'

const stats = data.stats

const emit = defineEmits<{
  filter: [keyword: string]
}>()

const items = [
  { label: '插件总数', value: stats?.total || 0, keyword: '' },
  { label: '官方插件', value: stats?.official || 0, keyword: '@zhin.js' },
  { label: '适配器', value: stats?.adapters || 0, keyword: 'adapter' },
  { label: '社区插件', value: stats?.community || 0, keyword: 'zhin.js-' },
]
</script>

<template>
  <div class="plugin-stats">
    <button
      v-for="item in items"
      :key="item.label"
      type="button"
      class="stat-card"
      @click="emit('filter', item.keyword)"
      :title="`搜索${item.label}`"
    >
      <span class="stat-value">{{ item.value }}</span>
      <span class="stat-label">{{ item.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.plugin-stats {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
}

.stat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 16px 28px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  cursor: pointer;
  transition: border-color 0.25s, box-shadow 0.25s;
  font-family: inherit;
  min-width: 100px;
}

.stat-card:hover {
  border-color: var(--vp-c-brand);
  box-shadow: 0 2px 12px rgba(60, 60, 67, 0.08);
}

.stat-card:hover .stat-value {
  color: var(--vp-c-brand-dark);
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--vp-c-brand);
  line-height: 1;
  transition: color 0.25s;
}

.stat-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--vp-c-text-2);
}

@media (max-width: 640px) {
  .stat-card {
    padding: 12px 20px;
    min-width: 80px;
  }

  .stat-value {
    font-size: 22px;
  }

  .stat-label {
    font-size: 12px;
  }
}
</style>
