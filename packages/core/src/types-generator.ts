import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '@zhin.js/logger';

const logger = getLogger('TypesGenerator');

/**
 * 更新 tsconfig.json 的类型声明
 * @param cwd 项目根目录
 */
export async function generateEnvTypes(cwd: string): Promise<void> {
    try {
        // 基础类型集合
        const types = new Set(['@zhin.js/types']);
        
        // 检查 package.json 中的依赖
        const pkgPath = path.join(cwd, 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            const allDeps = {
                ...(pkg.dependencies || {}),
                ...(pkg.devDependencies || {})
            };

            // 检查所有 @zhin.js/ 开头的包
            for (const [name] of Object.entries(allDeps)) {
                if (name.startsWith('@zhin.js/') || name === 'zhin.js') {
                    try {
                        const depPkgPath = path.join(cwd, 'node_modules', name, 'package.json');
                        if (fs.existsSync(depPkgPath)) {
                            const depPkg = JSON.parse(fs.readFileSync(depPkgPath, 'utf-8'));
                            if (depPkg.types || depPkg.typings) {
                                types.add(name);
                            }
                        }
                    } catch (err) {
                        // 如果读取失败，跳过这个包
                        continue;
                    }
                }
            }
        }

        // 更新或创建 tsconfig.json
        const tsconfigPath = path.join(cwd, 'tsconfig.json');
        let tsconfig:Record<string,any> = {};

        // 读取现有的 tsconfig.json
        if (fs.existsSync(tsconfigPath)) {
            try {
                tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
            } catch (err) {
                // console.error 已替换为注释
                logger.warn('⚠️ Failed to parse tsconfig.json, creating new one');
            }
        }

        // 确保 compilerOptions 存在
        if (!tsconfig.compilerOptions) {
            tsconfig.compilerOptions = {};
        }

        // 合并现有的 types
        const existingTypes = tsconfig.compilerOptions.types || [];
        const allTypes = new Set([...existingTypes, ...types]);

        // 更新 types 字段
        tsconfig.compilerOptions.types = Array.from(allTypes);

        // 写入文件
        fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2), 'utf-8');
        logger.info('✅ Updated TypeScript types configuration');
    } catch (error) {
        logger.warn('⚠️ Failed to update TypeScript types', { 
            error: error instanceof Error ? error.message : String(error) 
        });
    }
}
