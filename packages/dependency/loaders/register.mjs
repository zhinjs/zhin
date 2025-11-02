/**
 * Universal Loader Registration
 * 适用于 Node.js 和 tsx
 * 使用新的 register() API 注册 loader
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 注册通用 loader（tsx-loader 同时支持 .ts 和 .js，适用于两种环境）
const loaderPath = join(__dirname, 'tsx-loader.mjs');
register(pathToFileURL(loaderPath), import.meta.url);

