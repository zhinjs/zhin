<script setup lang="ts">
import { onMounted, ref } from 'vue';

const plugins = ref([]);
onMounted(async () => {
  plugins.value = (await fetch('/api/plugins').then(res => res.json())) as any[];
});
</script>

<template>
  <el-table :data="plugins">
    <el-table-column type="index" label="序号">
      <template #default="{ $index }">{{ $index + 1 }}</template>
    </el-table-column>
    <el-table-column prop="display_name" label="插件名" width="150px" show-overflow-tooltip />
    <el-table-column width="80px" show-overflow-tooltip prop="middlewareCount" label="中间件">
      <template #default="{ row }"> {{ row.middlewareCount }}个 </template>
    </el-table-column>
    <el-table-column show-overflow-tooltip prop="services" label="服务">
      <template #default="{ row }">
        <span class="services">
          <el-button size="small" v-for="service in row.services" :key="service">{{ service }}</el-button>
        </span>
      </template>
    </el-table-column>
    <el-table-column prop="commands" label="指令">
      <template #default="{ row }">
        <el-table empty-text="该插件无指令" :data="row.commands">
          <el-table-column prop="name" label="名称" width="150px" show-overflow-tooltip />
          <el-table-column prop="desc" label="描述" show-overflow-tooltip />
          <el-table-column width="100px" prop="alias" label="别名">
            <template #default="{ row }">
              <span v-for="alias in row.alias" :key="alias">
                <el-tag>{{ alias }}</el-tag>
              </span>
            </template>
          </el-table-column>
        </el-table>
      </template>
    </el-table-column>
    <el-table-column prop="status" width="80px" label="状态">
      <template #default="{ row }">
        <el-tag :type="row.status === 'enabled' ? 'success' : 'danger'">
          {{ row.status === 'enabled' ? '已启用' : '未启用' }}
        </el-tag>
      </template>
    </el-table-column>
  </el-table>
</template>

<style scoped lang="less">
.services {
  display: inline-flex;
  gap: 5px;
}
</style>
