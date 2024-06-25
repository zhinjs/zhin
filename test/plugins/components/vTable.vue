<script setup lang="ts">
type Header = {
  label: string;
  prop: string;
};
defineProps<{
  headers?: Header[];
  data: Record<string, any>[];
}>();
</script>

<template>
  <table>
    <tr v-if="headers?.length">
      <th v-for="header in headers">{{ header.label }}</th>
    </tr>
    <tr v-for="item in data">
      <template v-if="headers?.length">
        <td v-for="header in headers">
          {{ item[header.prop] }}
        </td>
      </template>
      <template v-else>
        <td v-for="value in item">{{ value }}</td>
      </template>
    </tr>
  </table>
</template>

<style scoped lang="less"></style>
