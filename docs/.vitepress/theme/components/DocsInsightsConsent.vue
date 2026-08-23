<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vitepress';
import {
  readDocsInsightsConsent,
  setDocsInsightsConsent,
  type DocsInsightsConsent,
} from '../docs-insights.js';

const configured = Boolean(import.meta.env.VITE_DOCS_INSIGHTS_ENDPOINT);
const visible = ref(false);
const settingsOpen = ref(false);
const route = useRoute();
const english = computed(() => route.path.startsWith('/en/'));

onMounted(() => {
  const dnt = navigator.doNotTrack?.toLowerCase();
  visible.value = configured && readDocsInsightsConsent() === null && dnt !== '1' && dnt !== 'yes';
});

function choose(value: DocsInsightsConsent) {
  setDocsInsightsConsent(value);
  visible.value = false;
  settingsOpen.value = false;
}
</script>

<template>
  <button
    v-if="configured && !visible && !settingsOpen"
    type="button"
    class="docs-insights-settings"
    :aria-label="english ? 'Documentation privacy settings' : '文档隐私设置'"
    @click="settingsOpen = true"
  >{{ english ? 'Privacy' : '隐私' }}</button>
  <aside v-if="visible || settingsOpen" class="docs-insights-consent" aria-labelledby="docs-insights-title">
    <div>
      <strong id="docs-insights-title">{{ english ? 'Help improve Zhin documentation' : '帮助改进 Zhin 文档' }}</strong>
      <p>{{ english
        ? 'Only with your consent, collect anonymous pages, searches, 404s, and dwell buckets; no cookies, identity, query strings, or external referrers.'
        : '仅在你同意后收集匿名的页面、搜索、404 与停留区间；不使用 Cookie，不记录身份、查询参数或外部来源。'
      }}</p>
      <a :href="english ? '/en/operations/docs-insights' : '/operations/docs-insights'">{{ english ? 'Review fields and controls' : '了解数据字段与控制方式' }}</a>
    </div>
    <div class="docs-insights-actions">
      <button type="button" @click="choose('denied')">{{ english ? 'Not now' : '暂不参与' }}</button>
      <button type="button" class="primary" @click="choose('granted')">{{ english ? 'Allow anonymous insights' : '同意匿名统计' }}</button>
    </div>
  </aside>
</template>
