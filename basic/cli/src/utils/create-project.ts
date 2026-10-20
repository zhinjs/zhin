import { spawnSync } from 'node:child_process';

/** 与 create-zhin-app README / npm 包名一致 */
export const CREATE_PROJECT_COMMAND = 'pnpm create zhin-app';

/**
 * 在当前目录下创建 Zhin workspace 项目（委托 create-zhin-app）。
 */
export function spawnCreateProject(projectName: string): number | null {
  const result = spawnSync('pnpm', ['create', 'zhin-app', projectName], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return result.status;
}
