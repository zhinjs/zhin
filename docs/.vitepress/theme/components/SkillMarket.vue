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
        下列数据由仓库内 <code>SKILL.md</code> 自动生成：<strong>通用技能</strong>来自 create-zhin 模板，可复制到项目
        <code>skills/</code>；<strong>插件技能</strong>随对应 npm 插件安装，无需
        <code>zhin skills add</code>。若条目带「可下载」且配置了 <code>source</code>，可用 CLI 安装到本地。
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
