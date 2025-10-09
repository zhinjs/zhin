<template>
  <div class="plugins-page">
    <!-- 页面标题 -->
    <div class="page-header mb-4">
      <div class="flex align-items-center">
        <i class="pi pi-th-large text-3xl text-primary mr-3"></i>
        <div>
          <h1 class="page-title">已安装插件</h1>
          <p class="page-subtitle">管理和监控已安装的 Zhin Bot 插件</p>
        </div>
      </div>
      <div class="page-actions">
        <Button 
          icon="pi pi-refresh" 
          label="刷新" 
          @click="refreshData" 
          :loading="refreshing"
        />
        <Button 
          icon="pi pi-plus" 
          label="安装插件" 
          severity="success"
          @click="showInstallDialog = true"
        />
      </div>
    </div>

    <!-- 统计信息 -->
    <div class="grid mb-4">
      <div class="col-12 md:col-4">
        <div class="stats-card stats-total">
          <div class="stats-icon">
            <i class="pi pi-box text-white"></i>
          </div>
          <div class="stats-content">
            <div class="stats-value">{{ pluginsData?.length || 0 }}</div>
            <div class="stats-label">总插件数</div>
          </div>
        </div>
      </div>
      
      <div class="col-12 md:col-4">
        <div class="stats-card stats-active">
          <div class="stats-icon">
            <i class="pi pi-check-circle text-white"></i>
          </div>
          <div class="stats-content">
            <div class="stats-value">{{ activePluginsCount }}</div>
            <div class="stats-label">活跃插件</div>
          </div>
        </div>
      </div>
      
      <div class="col-12 md:col-4">
        <div class="stats-card stats-commands">
          <div class="stats-icon">
            <i class="pi pi-code text-white"></i>
          </div>
          <div class="stats-content">
            <div class="stats-value">{{ totalCommands }}</div>
            <div class="stats-label">命令总数</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 插件列表 -->
    <Card class="plugins-list-card">
      <template #title>
        <div class="flex justify-content-between align-items-center">
          <div class="flex align-items-center">
            <i class="pi pi-list mr-2"></i>
            插件列表
          </div>
          <div class="flex align-items-center gap-2">
            <Dropdown 
              v-model="filterStatus" 
              :options="statusOptions" 
              optionLabel="label" 
              optionValue="value" 
              placeholder="筛选状态"
              class="filter-dropdown"
              showClear
            />
          </div>
        </div>
      </template>
      
      <template #content>
        <div class="plugins-list">
          <div 
            v-for="plugin in filteredPlugins" 
            :key="plugin.name"
            class="plugin-item"
          >
            <div class="plugin-main-info">
              <div class="plugin-header">
                <div class="plugin-icon">
                  <i :class="getPluginIcon(plugin.name)"></i>
                </div>
                <div class="plugin-basic-info">
                  <h3 class="plugin-name">{{ plugin.name }}</h3>
                  <p class="plugin-description">{{ getPluginDescription(plugin.name) }}</p>
                </div>
                <div class="plugin-status">
                  <Tag 
                    value="活跃" 
                    severity="success"
                    icon="pi pi-check"
                  />
                </div>
              </div>
              
              <div class="plugin-stats">
                <div class="stat-item">
                  <i class="pi pi-sitemap"></i>
                  <span>{{ plugin.context_count || 0 }} 个上下文</span>
                </div>
                <div class="stat-item">
                  <i class="pi pi-code"></i>
                  <span>{{ plugin.command_count || 0 }} 个命令</span>
                </div>
                <div class="stat-item">
                  <i class="pi pi-layer-group"></i>
                  <span>{{ plugin.middleware_count || 0 }} 个中间件</span>
                </div>
                <div class="stat-item">
                  <i class="pi pi-th-large"></i>
                  <span>{{ plugin.component_count || 0 }} 个组件</span>
                </div>
              </div>
            </div>
            
            <div class="plugin-actions">
              <Button 
                icon="pi pi-refresh" 
                severity="info" 
                text 
                rounded
                @click="reloadPlugin(plugin.name)"
                :loading="reloadingPlugins.includes(plugin.name)"
                v-tooltip="'重载插件'"
              />
              <Button 
                icon="pi pi-cog" 
                severity="secondary" 
                text 
                rounded
                @click="configurePlugin(plugin)"
                v-tooltip="'配置插件'"
              />
              <Button 
                icon="pi pi-info-circle" 
                severity="help" 
                text 
                rounded
                @click="showPluginDetails(plugin)"
                v-tooltip="'查看详情'"
              />
            </div>
          </div>
          
          <!-- 空状态 -->
          <div v-if="filteredPlugins.length === 0" class="empty-state">
            <i class="pi pi-inbox text-4xl text-color-secondary mb-3"></i>
            <h3 class="text-color-secondary">暂无插件</h3>
            <p class="text-color-secondary">当前没有找到匹配的插件</p>
          </div>
        </div>
      </template>
    </Card>

    <!-- 插件详情对话框 -->
    <Dialog 
      v-model:visible="detailDialogVisible" 
      :header="selectedPlugin?.name + ' 详情'"
      modal 
      :style="{ width: '50vw' }"
      :breakpoints="{ '960px': '75vw', '641px': '90vw' }"
    >
      <div v-if="selectedPlugin" class="plugin-detail-content">
        <div class="detail-section">
          <h4>基本信息</h4>
          <div class="detail-grid">
            <div class="detail-item">
              <label>插件名称</label>
              <span>{{ selectedPlugin.name }}</span>
            </div>
            <div class="detail-item">
              <label>版本</label>
              <span>{{ selectedPlugin.version || '未知' }}</span>
            </div>
            <div class="detail-item">
              <label>状态</label>
              <Tag 
                :value="selectedPlugin.status" 
                :severity="getStatusSeverity(selectedPlugin.status)"
              />
            </div>
          </div>
        </div>
        
        <div class="detail-section">
          <h4>上下文信息</h4>
          <div class="contexts-list">
            <div 
              v-for="(mounted, name) in selectedPlugin.contexts" 
              :key="name"
              class="context-item"
            >
              <span class="context-name">{{ name }}</span>
              <Tag 
                :value="mounted ? '已挂载' : '未挂载'" 
                :severity="mounted ? 'success' : 'danger'"
              />
            </div>
          </div>
        </div>
        
        <div class="detail-section">
          <h4>统计信息</h4>
          <div class="stats-grid">
            <div class="stat-card">
              <i class="pi pi-code"></i>
              <div class="stat-info">
                <div class="stat-number">{{ selectedPlugin.commands || 0 }}</div>
                <div class="stat-text">命令</div>
              </div>
            </div>
            <div class="stat-card">
              <i class="pi pi-layer-group"></i>
              <div class="stat-info">
                <div class="stat-number">{{ selectedPlugin.middlewares || 0 }}</div>
                <div class="stat-text">中间件</div>
              </div>
            </div>
            <div class="stat-card">
              <i class="pi pi-clock"></i>
              <div class="stat-info">
                <div class="stat-number">{{ formatUptime(selectedPlugin.uptime) }}</div>
                <div class="stat-text">运行时间</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Dialog>

    <!-- 安装插件对话框 -->
    <Dialog 
      v-model:visible="showInstallDialog" 
      header="安装新插件"
      modal 
      :style="{ width: '30vw' }"
      :breakpoints="{ '960px': '50vw', '641px': '90vw' }"
    >
      <div class="install-plugin-content">
        <p class="mb-3">输入插件包名称或本地路径：</p>
        <InputText 
          v-model="newPluginName" 
          placeholder="例如: @zhin.js/plugin-example"
          class="w-full mb-3"
        />
      </div>
      <template #footer>
        <Button 
          label="取消" 
          text 
          @click="showInstallDialog = false"
        />
        <Button 
          label="安装" 
          @click="installPlugin"
          :disabled="!newPluginName"
        />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCommonStore } from '@zhin.js/client'

const commonStore = useCommonStore()
const refreshing = ref(false)
const detailDialogVisible = ref(false)
const showInstallDialog = ref(false)
const selectedPlugin = ref(null)
const newPluginName = ref('')
const filterStatus = ref('')
const reloadingPlugins = ref<string[]>([])

// 插件数据
const pluginsData = computed(() => (commonStore.store as any).plugins || [])

// 状态筛选选项
const statusOptions = [
  { label: '全部', value: '' },
  { label: '活跃', value: 'active' },
  { label: '已停用', value: 'disposed' }
]

// 筛选后的插件列表
const filteredPlugins = computed(() => {
  if (!filterStatus.value) return pluginsData.value
  // 由于API只返回基础数据，所有插件都视为活跃状态
  return pluginsData.value
})

// 统计信息
const activePluginsCount = computed(() => {
  return pluginsData.value.length // 所有返回的插件都是活跃的
})

const totalCommands = computed(() => {
  return pluginsData.value.reduce((total, plugin) => total + (plugin.command_count || 0), 0)
})

const totalComponents = computed(() => {
  return pluginsData.value.reduce((total, plugin) => total + (plugin.component_count || 0), 0)
})

const totalMiddlewares = computed(() => {
  return pluginsData.value.reduce((total, plugin) => total + (plugin.middleware_count || 0), 0)
})

const totalContexts = computed(() => {
  return pluginsData.value.reduce((total, plugin) => total + (plugin.context_count || 0), 0)
})

// 格式化函数
const getPluginIcon = (name: string) => {
  if (name.includes('adapter')) return 'pi pi-link'
  if (name.includes('core')) return 'pi pi-star'
  if (name.includes('cli')) return 'pi pi-terminal'
  if (name.includes('http')) return 'pi pi-globe'
  if (name.includes('console')) return 'pi pi-desktop'
  if (name.includes('client')) return 'pi pi-mobile'
  return 'pi pi-puzzle-piece'
}

const getPluginDescription = (name: string) => {
  const descriptions = {
    'core': '核心框架功能',
    'cli': '命令行工具',
    'http': 'HTTP服务器',
    'console': 'Web控制台',
    'client': '客户端界面',
    'hmr': '热模块重载',
    'icqq': 'ICQQ适配器',
    'kook': 'KOOK适配器',
    'process': '进程适配器'
  }
  return descriptions[name] || `${name} 插件`
}

const formatUptime = (seconds?: number) => {
  if (!seconds) return '0秒'
  
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  
  if (hours > 0) {
    return `${hours}小时${minutes}分钟`
  } else if (minutes > 0) {
    return `${minutes}分钟`
  } else {
    return `${Math.floor(seconds)}秒`
  }
}

const getStatusSeverity = (status: string) => {
  switch (status) {
    case 'active': return 'success'
    case 'disposed': return 'danger'
    default: return 'info'
  }
}

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'active': return 'pi pi-check'
    case 'disposed': return 'pi pi-times'
    default: return 'pi pi-question'
  }
}

// 操作函数
const refreshData = async () => {
  refreshing.value = true
  try {
    // 使用全局API
    if (window.ZhinDataAPI?.updateAllData) {
      await window.ZhinDataAPI.updateAllData()
      // console.log 已替换为注释
    } else {
      throw new Error('全局API未就绪')
    }
  } catch (error) {
    // console.error 已替换为注释
  } finally {
    refreshing.value = false
  }
}

const reloadPlugin = async (pluginName: string) => {
  reloadingPlugins.value.push(pluginName)
  
  try {
    // 使用全局API
    if (window.ZhinDataAPI?.reloadPlugin) {
      const result = await window.ZhinDataAPI.reloadPlugin(pluginName)
      
      if (result.success) {
        // console.log 已替换为注释
        // 重载成功后刷新插件数据
        await refreshData()
      } else {
        // console.error 已替换为注释
      }
    } else {
      throw new Error('全局API未就绪')
    }
  } catch (error) {
    // console.error 已替换为注释
  } finally {
    reloadingPlugins.value = reloadingPlugins.value.filter(name => name !== pluginName)
  }
}

const configurePlugin = (plugin: any) => {
  // 这里可以跳转到插件配置页面或显示配置对话框
  // console.log 已替换为注释
}

const showPluginDetails = (plugin: any) => {
  selectedPlugin.value = plugin
  detailDialogVisible.value = true
}

const installPlugin = async () => {
  if (!newPluginName.value) return
  
  try {
    // 这里应该调用实际的安装API
    // console.log 已替换为注释
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    showInstallDialog.value = false
    newPluginName.value = ''
    refreshData()
  } catch (error) {
    // console.error 已替换为注释
  }
}
</script>

<style scoped>
.plugins-page {
  padding: 1.5rem;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 2rem;
  background: var(--surface-card);
  border-radius: 12px;
  border: 1px solid var(--surface-border);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.page-title {
  margin: 0;
  font-size: 2rem;
  font-weight: 600;
  color: var(--text-color);
}

.page-subtitle {
  margin: 0.5rem 0 0 0;
  color: var(--text-color-secondary);
  font-size: 1rem;
}

.page-actions {
  display: flex;
  gap: 0.75rem;
}

.stats-card {
  background: var(--surface-card);
  border-radius: 12px;
  border: 1px solid var(--surface-border);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  padding: 1.5rem;
  display: flex;
  align-items: center;
  gap: 1rem;
}

.stats-total .stats-icon { background: var(--blue-500); }
.stats-commands .stats-icon { background: var(--orange-500); }
.stats-components .stats-icon { background: var(--purple-500); }
.stats-contexts .stats-icon { background: var(--cyan-500); }

.stats-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
}

.stats-value {
  font-size: 2rem;
  font-weight: 700;
  color: var(--text-color);
  line-height: 1;
}

.stats-label {
  font-size: 0.875rem;
  color: var(--text-color-secondary);
  margin-top: 0.25rem;
}

.plugins-list-card :deep(.p-card-body) {
  padding: 1.5rem;
}

.filter-dropdown {
  width: 150px;
}

.plugins-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.plugin-item {
  display: flex;
  align-items: center;
  padding: 1.5rem;
  background: var(--surface-50);
  border-radius: 12px;
  border: 1px solid var(--surface-border);
  transition: all 0.2s ease;
}

.plugin-item:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  transform: translateY(-1px);
}

.plugin-main-info {
  flex: 1;
}

.plugin-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.plugin-icon {
  width: 48px;
  height: 48px;
  background: var(--primary-color);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 1.5rem;
}

.plugin-basic-info {
  flex: 1;
}

.plugin-name {
  margin: 0 0 0.25rem 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-color);
}

.plugin-description {
  margin: 0;
  color: var(--text-color-secondary);
  font-size: 0.875rem;
}

.plugin-stats {
  display: flex;
  gap: 2rem;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-color-secondary);
  font-size: 0.875rem;
}

.stat-item i {
  color: var(--primary-color);
}

.plugin-actions {
  display: flex;
  gap: 0.5rem;
}

.empty-state {
  text-align: center;
  padding: 3rem;
}

/* 对话框样式 */
.plugin-detail-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.detail-section h4 {
  margin: 0 0 1rem 0;
  color: var(--text-color);
  font-size: 1.125rem;
  font-weight: 600;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.detail-item label {
  font-size: 0.875rem;
  color: var(--text-color-secondary);
  font-weight: 500;
}

.contexts-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.context-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem;
  background: var(--surface-100);
  border-radius: 8px;
}

.context-name {
  font-weight: 500;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 1rem;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  background: var(--surface-100);
  border-radius: 8px;
}

.stat-card i {
  font-size: 1.5rem;
  color: var(--primary-color);
}

.stat-number {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-color);
}

.stat-text {
  font-size: 0.75rem;
  color: var(--text-color-secondary);
}

@media (max-width: 768px) {
  .plugins-page {
    padding: 1rem;
  }
  
  .page-header {
    flex-direction: column;
    gap: 1rem;
    padding: 1.5rem;
  }
  
  .plugin-header {
    flex-wrap: wrap;
  }
  
  .plugin-stats {
    flex-wrap: wrap;
    gap: 1rem;
  }
  
  .plugin-actions {
    margin-top: 1rem;
  }
}
</style>
