#!/usr/bin/env node
/**
 * Zhin.js 插件规范检查工具
 * 用于验证插件的 package.json 是否符合发布规范
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const pkgPath = process.argv[2] || './package.json';

if (!existsSync(pkgPath)) {
  console.error(`❌ 找不到 package.json: ${pkgPath}`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const errors = [];
const warnings = [];
const tips = [];

console.log('\n📦 Zhin.js 插件规范检查\n');
console.log(`包名: ${pkg.name || '(未设置)'}`);
console.log(`版本: ${pkg.version || '(未设置)'}`);
console.log(`类型: ${pkg.type || 'commonjs'}\n`);

// ============ 必需字段检查 ============

// 1. 包名检查
if (!pkg.name) {
  errors.push('缺少 name 字段');
} else {
  if (!pkg.name.startsWith('@zhin.js/')) {
    warnings.push(`包名不符合命名规范，应该以 @zhin.js/ 开头`);
    tips.push('命名规范：适配器 @zhin.js/adapter-*，服务 @zhin.js/*，插件 @zhin.js/plugin-*');
  }
}

// 2. 描述检查
if (!pkg.description) {
  errors.push('缺少 description 字段');
} else {
  const desc = pkg.description.toLowerCase();
  if (pkg.name?.includes('adapter') && !desc.includes('adapter')) {
    warnings.push('适配器的 description 应该包含 "adapter" 关键词');
    tips.push('推荐格式：Zhin.js adapter for [平台名称]');
  }
  if (pkg.name?.includes('plugin') && !desc.includes('plugin')) {
    warnings.push('插件的 description 应该包含 "plugin" 关键词');
    tips.push('推荐格式：[功能描述] plugin for Zhin.js');
  }
}

// 3. 关键词检查
if (!pkg.keywords || pkg.keywords.length === 0) {
  errors.push('缺少 keywords 字段');
} else {
  if (!pkg.keywords.includes('zhin')) {
    errors.push('keywords 必须包含 "zhin"');
  }
  if (!pkg.keywords.includes('bot')) {
    errors.push('keywords 必须包含 "bot"');
  }
  
  // 检查插件类型关键词
  const hasTypeKeyword = pkg.keywords.some(k => 
    ['adapter', 'service', 'plugin'].includes(k)
  );
  if (!hasTypeKeyword) {
    warnings.push('keywords 应该包含插件类型（adapter/service/plugin）');
  }
  
  if (pkg.keywords.length < 3) {
    warnings.push('keywords 太少，建议至少包含 5 个关键词以提高可发现性');
  }
}

// 4. 作者信息检查（插件市场收录的关键）
if (!pkg.author) {
  errors.push('缺少 author 字段（插件市场收录必需）');
} else if (typeof pkg.author === 'object') {
  if (!pkg.author.name) {
    errors.push('author.name 不能为空');
  }
  if (!pkg.author.email) {
    errors.push('author.email 不能为空（插件市场收录必需）');
  } else if (!pkg.author.email.includes('@')) {
    errors.push('author.email 格式不正确');
  }
  if (!pkg.author.url) {
    warnings.push('建议添加 author.url（GitHub 主页等）');
  }
} else if (typeof pkg.author === 'string') {
  if (!pkg.author.includes('@')) {
    errors.push('author 必须包含邮箱地址（插件市场收录必需）');
    tips.push('推荐格式：{ "name": "...", "email": "...", "url": "..." }');
  }
}

// 5. 依赖配置检查
if (pkg.dependencies?.['zhin.js']) {
  errors.push('不应该在 dependencies 中依赖 zhin.js');
  tips.push('插件应该使用 peerDependencies 声明对 zhin.js 的依赖');
}

if (!pkg.peerDependencies?.['zhin.js']) {
  errors.push('缺少 peerDependencies["zhin.js"]');
  tips.push('添加：{ "peerDependencies": { "zhin.js": "workspace:*" } }');
}

if (!pkg.devDependencies?.['zhin.js']) {
  warnings.push('建议在 devDependencies 中添加 zhin.js（用于开发和类型检查）');
}

// 6. 仓库信息检查
if (!pkg.repository) {
  warnings.push('缺少 repository 字段');
  tips.push('添加 GitHub 仓库链接可以提高插件的可信度');
} else if (typeof pkg.repository === 'object') {
  if (!pkg.repository.url) {
    warnings.push('repository.url 不能为空');
  }
}

// 7. 许可证检查
if (!pkg.license) {
  warnings.push('缺少 license 字段');
  tips.push('推荐使用 MIT 许可证');
}

// 8. 发布配置检查
if (!pkg.publishConfig?.access) {
  warnings.push('缺少 publishConfig.access 配置');
  tips.push('添加：{ "publishConfig": { "access": "public" } }');
} else if (pkg.publishConfig.access !== 'public') {
  errors.push('publishConfig.access 必须设置为 "public"');
}

// 9. 模块类型检查
if (pkg.type !== 'module') {
  warnings.push('建议设置 "type": "module" 以使用 ESM');
}

// 10. 导出配置检查
if (!pkg.exports) {
  warnings.push('建议添加 exports 字段以支持现代模块解析');
}

// 11. 文件包含检查
if (!pkg.files || pkg.files.length === 0) {
  warnings.push('建议添加 files 字段以控制发布内容');
  tips.push('通常包含：["lib", "README.md", "CHANGELOG.md"]');
}

// 12. 构建产物检查
if (pkg.main && !existsSync(join(process.cwd(), pkg.main))) {
  warnings.push(`main 字段指向的文件不存在: ${pkg.main}`);
  tips.push('请先运行 build 命令构建插件');
}

// ============ 输出结果 ============

console.log('━'.repeat(60));
console.log();

if (errors.length === 0 && warnings.length === 0) {
  console.log('✅ 恭喜！你的插件完全符合规范！\n');
  console.log('📝 下一步：');
  console.log('  1. 运行 pnpm build 构建插件');
  console.log('  2. 运行 pnpm test 测试插件');
  console.log('  3. 运行 pnpm publish 发布到 npm\n');
} else {
  if (errors.length > 0) {
    console.log('🚨 错误（必须修复）：\n');
    errors.forEach((err, i) => {
      console.log(`  ${i + 1}. ❌ ${err}`);
    });
    console.log();
  }
  
  if (warnings.length > 0) {
    console.log('⚠️  警告（建议修复）：\n');
    warnings.forEach((warn, i) => {
      console.log(`  ${i + 1}. ⚠️  ${warn}`);
    });
    console.log();
  }
  
  if (tips.length > 0) {
    console.log('💡 提示：\n');
    tips.forEach((tip, i) => {
      console.log(`  ${i + 1}. ${tip}`);
    });
    console.log();
  }
}

console.log('━'.repeat(60));
console.log();
console.log('📚 完整规范文档：https://zhinjs.github.io/zhin/plugin/publishing-guide');
console.log('❓ 遇到问题？联系：admin@liucl.cn\n');

// 返回退出码
process.exit(errors.length > 0 ? 1 : 0);

