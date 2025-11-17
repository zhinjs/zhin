<script setup lang="ts">
import { ref } from 'vue'
import PluginStats from './PluginStats.vue'
import PluginSearch from './PluginSearch.vue'

const searchRef = ref<InstanceType<typeof PluginSearch>>()

// 处理统计项点击
function handleFilter(keyword: string) {
  if (searchRef.value) {
    searchRef.value.setSearchKeyword(keyword)
  }
}
</script>

<template>
  <div class="plugin-market">
    <PluginStats @filter="handleFilter" />
    
    <div class="search-section">
      <h2>🔍 搜索插件</h2>
      <PluginSearch ref="searchRef" />
    </div>
  </div>
</template>

<style scoped>
.plugin-market {
  margin: 2rem 0;
}

.search-section {
  margin-top: 3rem;
}

.search-section h2 {
  font-size: 1.5rem;
  margin-bottom: 1rem;
}
</style>

