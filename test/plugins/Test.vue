<script setup lang="ts">
defineProps<{
  who: string;
}>();
</script>

<template>
  <div>hello {{ who }}</div>
</template>
<style lang="scss">
div {
  color: red;
}
</style>
