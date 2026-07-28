<script setup lang="ts">
import { useData } from 'vitepress'

const { isDark } = useData()
</script>

<template>
  <div class="zhin-side-foot">
    <a href="https://github.com/zhinjs/zhin" target="_blank" rel="noreferrer" class="zhin-side-foot__repo">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>
      </svg>
      zhinjs/zhin
    </a>
    <p class="zhin-side-foot__meta">
      <a href="/contributing/development">发版与门禁</a>
      <i></i>
      <a href="https://github.com/zhinjs/zhin/blob/main/AGENTS.md" target="_blank" rel="noreferrer">AGENTS.md</a>
    </p>
  </div>
</template>

<style scoped>
.zhin-side-foot {
  margin: 16px 16px 0;
  padding: 14px 12px 4px;
  border-top: 1px solid var(--zhin-line, #e2e9e4);
  font-size: 12px;
}

.dark .zhin-side-foot {
  border-top-color: var(--zhin-line, #2a352f);
}

.zhin-side-foot__repo {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: var(--zhin-ink-2, #4a5b51);
  text-decoration: none;
}

.zhin-side-foot__repo:hover {
  color: var(--vp-c-brand-dark);
}

.dark .zhin-side-foot__repo:hover {
  color: var(--vp-c-brand-light);
}

.zhin-side-foot__meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0 0;
}

.zhin-side-foot__meta a {
  color: var(--zhin-ink-2, #4a5b51);
  text-decoration: none;
}

.zhin-side-foot__meta a:hover {
  color: var(--vp-c-brand-dark);
}

.dark .zhin-side-foot__meta a:hover {
  color: var(--vp-c-brand-light);
}

.zhin-side-foot__meta i {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--vp-c-brand);
}
</style>
