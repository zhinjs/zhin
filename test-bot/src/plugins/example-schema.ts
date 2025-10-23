/**
 * 示例插件：演示如何使用 Schema 配置系统
 * 
 * 使用方法:
 * 1. 在 zhin.config.ts 中添加插件配置:
 *    {
 *      'example-schema': {
 *        enabled: true,
 *        message: 'Custom message',
 *        maxRetries: 5
 *      }
 *    }
 * 
 * 2. API 使用:
 *    - GET /api/schemas/example-schema - 获取 Schema 定义
 *    - GET /api/config/example-schema - 获取当前配置
 *    - POST /api/config/example-schema - 更新配置
 */

// TODO: 等待 zhin.js 包构建完成后取消注释
/*
import { Schema } from 'zhin.js';
import { usePlugin, onMounted, useLogger } from 'zhin.js';

// 定义插件配置 Schema
const ExampleConfigSchema = Schema.object({
  enabled: Schema.boolean('enabled')
    .default(true)
    .description('是否启用该插件'),
  
  message: Schema.string('message')
    .default('Hello, Zhin!')
    .min(1)
    .max(100)
    .description('欢迎消息'),
  
  maxRetries: Schema.number('maxRetries')
    .default(3)
    .min(1)
    .max(10)
    .description('最大重试次数'),
  
  timeout: Schema.number('timeout')
    .default(5000)
    .min(100)
    .description('超时时间（毫秒）'),
  
  features: Schema.list(Schema.string(), 'features')
    .default(['feature1', 'feature2'])
    .description('启用的功能列表'),
  
  apiSettings: Schema.object({
    endpoint: Schema.string('endpoint')
      .default('https://api.example.com')
      .description('API 端点'),
    
    apiKey: Schema.string('apiKey')
      .default('')
      .description('API 密钥'),
    
    rateLimit: Schema.number('rateLimit')
      .default(100)
      .min(1)
      .description('每分钟请求限制')
  }, 'apiSettings').description('API 设置')
});

// 使用插件
const plugin = usePlugin();
const logger = useLogger();

// 为插件类添加 Schema
(plugin.constructor as any).schema = ExampleConfigSchema;

// 插件挂载时读取配置
onMounted(() => {
  const config = plugin.getConfig();
  
  logger.info('示例插件已加载');
  logger.info('当前配置:', config);
  
  // 使用配置
  if (config.enabled) {
    logger.info(`欢迎消息: ${config.message}`);
    logger.info(`最大重试次数: ${config.maxRetries}`);
    logger.info(`超时时间: ${config.timeout}ms`);
    logger.info(`启用的功能: ${config.features.join(', ')}`);
    logger.info(`API 端点: ${config.apiSettings.endpoint}`);
  } else {
    logger.info('插件已禁用');
  }
  
  // 监听配置变化
  plugin.on('config.changed', (newConfig: any) => {
    logger.info('配置已更新:', newConfig);
  });
});

export { ExampleConfigSchema };
*/

// 临时导出以避免编译错误
export const temp = 'example-schema';
