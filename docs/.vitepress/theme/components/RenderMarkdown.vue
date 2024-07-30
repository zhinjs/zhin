<script setup lang="ts">
import MarkdownIt from 'markdown-it';
const md = new MarkdownIt();
withDefaults(
  defineProps<{
    content?: string;
  }>(),
  {
    content: '',
  },
);
</script>

<template>
  <div v-html="md.render(content)" class="md-content" />
</template>

<style scoped lang="less">
.md-content {
  height: 155px;
  overflow: auto;
}
</style>
