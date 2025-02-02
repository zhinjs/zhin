<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import RenderMarkdown from './RenderMarkdown.vue';
import { ElMessage } from 'element-plus';

const props = withDefaults(
  defineProps<{
    registry?: string;
  }>(),
  {
    registry: 'https://registry.npmjs.org',
  },
);
const pageSize = ref(10);
const pageNum = ref(1);
const pageTotal = ref(0);
const searchUrl = computed(() => {
  return `${props.registry}/-/v1/search?${new URLSearchParams({
    text: 'zhin+plugin',
    size: String(1000),
  })}`;
});
const keyword = ref('');
const searchResult = ref([]);
const searchLoading = ref(false);
const search = async () => {
  searchLoading.value = true;
  try {
    const res = await fetch(searchUrl.value);
    const { objects, total } = await res.json();
    searchResult.value = objects;
    pageTotal.value = total;
    searchLoading.value = false;
  } catch {
    searchLoading.value = false;
    ElMessage.warning('搜索出错，请稍后重试');
  }
};
const getAuthorInfo = item => {
  return item.package.author?.name || item.package.publisher?.username;
};
const dataList = computed(() => {
  return searchResult.value
    .filter(item => {
      return item.package.name.includes(keyword.value) && (scope.value === 'all' || item.package.scope === scope.value);
    })
    .filter((_item, index) => {
      return index >= (pageNum.value - 1) * pageSize.value && index < pageNum.value * pageSize.value;
    });
});
const copy = item => {
  navigator.clipboard.writeText(`npm install ${item.name}@${item.version}`);
  ElMessage.success('已复制安装命令到剪切板');
};
const scopes = ref([
  {
    name: 'all',
    label: '全部',
  },
  {
    name: 'zhinjs',
    label: '官方',
  },
  {
    name: 'unscoped',
    label: '社区',
  },
]);
const scope = ref('all');
onMounted(() => search());
</script>

<template>
  <el-row class="store-wrap">
    <el-col :lg="6" :md="6" :xl="24">
      <el-select v-model="scope">
        <el-option v-for="item in scopes" :label="item.label" :value="item.name" />
      </el-select>
    </el-col>
    <el-col :lg="18" :md="18" :xl="24" v-loading="searchLoading" class="right">
      <el-header>
        <el-form size="large" inline @submit.prevent="search">
          <el-form-item label="关键字">
            <el-input v-model="keyword" placeholder="请输入关键字">
              <template #append>
                <el-button type="primary" @click="search">
                  <el-icon>
                    <Search />
                  </el-icon>
                </el-button>
              </template>
            </el-input>
          </el-form-item>
        </el-form>
      </el-header>
      <el-row class="store-content-wrap">
        <el-col v-for="item in dataList" :key="item.package.name" :lg="8" :md="8" :sm="12" :xs="24">
          <el-card>
            <template #header>
              <div class="card-header">
                <span>{{ item.package.name }}</span>
              </div>
            </template>
            <render-markdown :content="item.package.description" />
            <template #footer>
              <el-link type="default" :href="item.package.links.npm">
                <el-icon size="large">
                  <el-image src="https://iconape.com/wp-content/files/js/350929/png/npm-logo.png" />
                </el-icon>
              </el-link>
              <el-link type="default" :href="item.package.links.homepage">
                <el-icon size="large">
                  <HomeFilled />
                </el-icon>
              </el-link>
              <el-link type="default" :href="item.package.links.repository">
                <el-icon>
                  <svg
                    height="32"
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    version="1.1"
                    width="32"
                    data-view-component="true"
                  >
                    <path
                      d="M12.5.75C6.146.75 1 5.896 1 12.25c0 5.089 3.292 9.387 7.863 10.91.575.101.79-.244.79-.546 0-.273-.014-1.178-.014-2.142-2.889.532-3.636-.704-3.866-1.35-.13-.331-.69-1.352-1.18-1.625-.402-.216-.977-.748-.014-.762.906-.014 1.553.834 1.769 1.179 1.035 1.74 2.688 1.25 3.349.948.1-.747.402-1.25.733-1.538-2.559-.287-5.232-1.279-5.232-5.678 0-1.25.445-2.285 1.178-3.09-.115-.288-.517-1.467.115-3.048 0 0 .963-.302 3.163 1.179.92-.259 1.897-.388 2.875-.388.977 0 1.955.13 2.875.388 2.2-1.495 3.162-1.179 3.162-1.179.633 1.581.23 2.76.115 3.048.733.805 1.179 1.825 1.179 3.09 0 4.413-2.688 5.39-5.247 5.678.417.36.776 1.05.776 2.128 0 1.538-.014 2.774-.014 3.162 0 .302.216.662.79.547C20.709 21.637 24 17.324 24 12.25 24 5.896 18.854.75 12.5.75Z"
                    ></path>
                  </svg>
                </el-icon>
              </el-link>
              <el-tag type="success">Author: {{ getAuthorInfo(item) }}</el-tag>
              <el-tag type="warning">Version: {{ item.package.version }}</el-tag>
              <el-button type="primary" icon="documentCopy" @click="copy(item.package)"> 安装命令</el-button>
            </template>
          </el-card>
        </el-col>
      </el-row>
      <el-footer>
        <el-pagination
          v-model:current-page="pageNum"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="pageTotal"
          layout="total, sizes, prev, pager, next, jumper"
        />
      </el-footer>
    </el-col>
  </el-row>
</template>

<style scoped lang="less">
.store-wrap {
  .right {
    height: 100%;
    display: flex;
    flex-direction: column;

    .card-header {
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 1;
      overflow: hidden;
      -webkit-box-orient: vertical;
    }

    .store-content-wrap {
      display: flex;
      flex-wrap: wrap;

      .el-card {
        margin: 5px;
      }
    }
  }
}
</style>
<style lang="less">
.store-wrap {
  margin: 10px;
  .el-card__footer {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
}
</style>
