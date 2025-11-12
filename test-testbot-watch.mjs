/**
 * 测试 test-bot 的文件监听
 */
import { App } from './packages/core/lib/app.js';

const app = new App('./test-bot/zhin.config.ts');

console.log('\n=== Test-Bot 文件监听信息 ===\n');

const info = app.watchInfo;

console.log(`监听目录: ${info.watchedDirsCount} 个`);
console.log('目录列表:', info.directories);
console.log();

console.log(`Glob 模式: ${info.totalPatterns} 个`);
if (app.watchPatterns.length > 0) {
  app.watchPatterns.forEach((pattern, i) => {
    console.log(`  ${i + 1}. ${pattern}`);
  });
} else {
  console.log('  (无 glob 模式)');
}
console.log();

console.log(`匹配文件: ${info.matchedFilesCount} 个`);
if (info.matchedFilesCount > 0) {
  console.log('前 10 个文件:');
  info.matchedFiles.slice(0, 10).forEach((file, i) => {
    const relative = file.replace(process.cwd(), '.');
    console.log(`  ${i + 1}. ${relative}`);
  });
  if (info.matchedFilesCount > 10) {
    console.log(`  ... 还有 ${info.matchedFilesCount - 10} 个文件`);
  }
}
console.log();

console.log(`监听状态: ${info.isWatching ? '✅ 活跃' : '❌ 未激活'}`);
console.log();
