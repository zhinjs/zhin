<script setup lang="ts">
import { ref } from 'vue'
import PluginStats from './PluginStats.vue'
import PluginSearch from './PluginSearch.vue'

const searchRef = ref<InstanceType<typeof PluginSearch>>()

function handleFilter(keyword: string) {
  if (searchRef.value) {
    searchRef.value.setSearchKeyword(keyword)
  }
}
</script>

<template>
  <div class="plugin-market">
    <PluginStats @filter="handleFilter" />
    <PluginSearch ref="searchRef" />
  </div>
</template>

<style scoped>
.plugin-market {
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin: 24px 0;
}
</style>
