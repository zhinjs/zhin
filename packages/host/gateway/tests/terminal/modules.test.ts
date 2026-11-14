import { createModuleCache, isPackageNotInstalledError, moduleLoadFailureHint } from '../../src/terminal/modules.js';

function error(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('terminal module load hints (#1250)', () => {
  it('tells "not installed" apart from "installed but the native addon was not built"', () => {
    const missing = error('ERR_MODULE_NOT_FOUND', "Cannot find package 'node-pty' imported from /p/node_modules/@zhin.js/gateway/lib/terminal/modules.js");
    expect(isPackageNotInstalledError('node-pty', missing)).toBe(true);
    expect(moduleLoadFailureHint('node-pty', missing)).toBe('node-pty 未安装（可选依赖）：在项目中执行 pnpm add node-pty 后重启');

    const unbuilt = error('MODULE_NOT_FOUND', "Cannot find module '../build/Release/pty.node'");
    expect(isPackageNotInstalledError('node-pty', unbuilt)).toBe(false);
    const hint = moduleLoadFailureHint('node-pty', unbuilt);
    expect(hint).toContain('已安装，但原生模块未构建');
    expect(hint).toContain('pnpm-workspace.yaml 的 allowBuilds 中放行 node-pty');
    expect(hint).toContain('zhin migrate');
    expect(hint).toContain('pnpm rebuild node-pty');
    expect(hint).not.toContain('pnpm add');

    const inPackage = error('MODULE_NOT_FOUND', "Cannot find module 'node-pty/build/Release/pty.node'");
    expect(isPackageNotInstalledError('node-pty', inPackage)).toBe(false);
    // An ABI mismatch is a load failure without a module-not-found code.
    expect(moduleLoadFailureHint('node-pty', new Error('was compiled against a different Node.js version'))).toContain('pnpm rebuild node-pty');
  });

  it('keeps a plain install hint for a missing pure-JS module and a repair hint when it fails to load', () => {
    expect(moduleLoadFailureHint('ssh2', error('ERR_MODULE_NOT_FOUND', "Cannot find package 'ssh2' imported from /x.js")))
      .toBe('ssh2 未安装（可选依赖）：在项目中执行 pnpm add ssh2 后重启');
    expect(moduleLoadFailureHint('ssh2', new Error('boom'))).toBe('ssh2 已安装但加载失败：执行 pnpm install 修复依赖后重启');
  });

  it('reports the classified hint through the module cache', async () => {
    const cache = createModuleCache({ loadPty: async () => { throw error('MODULE_NOT_FOUND', "Cannot find module '../build/Release/pty.node'"); } });
    const result = await cache.pty();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain('pnpm rebuild node-pty');
  });
});
