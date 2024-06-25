<script setup lang="ts">
import VTable from './components/vTable.vue';
import { ref } from 'vue';
defineProps<{
  who: string;
}>();
const data = ref([
  {
    name: '张三',
    age: 18,
    sex: '男',
    address: '北京',
  },
  {
    name: '李四',
    age: 19,
    sex: '女',
    address: '上海',
  },
  {
    name: '王五',
    age: 20,
    sex: '男',
    address: '广州',
  },
  {
    name: '赵六',
    age: 21,
    sex: '女',
    address: '深圳',
  },
  {
    name: '田七',
    age: 22,
    sex: '男',
    address: '杭州',
  },
  {
    name: '刘八',
    age: 23,
    sex: '女',
    address: '南京',
  },
  {
    name: '陈九',
    age: 24,
    sex: '男',
    address: '苏州',
  },
]);
const headers = ref([
  {
    label: '姓名',
    prop: 'name',
  },
  {
    label: '年龄',
    prop: 'age',
  },
  {
    label: '性别',
    prop: 'sex',
  },
  {
    label: '地址',
    prop: 'address',
  },
]);
</script>

<template>
  <div>
    hello {{ who }}
    <v-table :data="data" :headers="headers" />
  </div>
</template>
<style lang="scss">
div {
  color: red;
}
</style>
