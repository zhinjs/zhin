<script setup lang="ts">
import { ref } from 'vue'
import SkillSearch from './SkillSearch.vue'

const searchRef = ref<InstanceType<typeof SkillSearch>>()

function handleFilter(keyword: string) {
  if (searchRef.value) searchRef.value.setSearchKeyword(keyword)
}
</script>

<template>
  <div class="skill-market">
    <div class="skill-stats">
      <p class="skill-stats-desc">
        从云端搜索并安装技能到本地，使用
        <code>zhin skills add &lt;id&gt;</code>
        安装。
      </p>
    </div>
    <SkillSearch ref="searchRef" />
  </div>
</template>

<style scoped>
.skill-market {
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin: 24px 0;
}

.skill-stats-desc {
  font-size: 14px;
  color: var(--vp-c-text-2);
  margin: 0;
}

.skill-stats-desc code {
  padding: 2px 6px;
  background: var(--vp-c-bg-soft);
  border-radius: 4px;
}
</style>
