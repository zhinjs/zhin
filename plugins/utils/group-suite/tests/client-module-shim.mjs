import { NativeDevelopmentModuleRuntime as SrcRuntime } from '../../../../packages/im/runtime/src/native-development-runtime.ts';

async function loadTestClientModule(source) {
  return {
    module: source,
    hash: 'test-client-module',
  };
}

if (!SrcRuntime.prototype.loadClientModule) {
  SrcRuntime.prototype.loadClientModule = loadTestClientModule;
}

try {
  const { NativeDevelopmentModuleRuntime: LibRuntime } = await import('../../../../packages/im/runtime/lib/native-development-runtime.js');
  if (LibRuntime && !LibRuntime.prototype.loadClientModule) {
    LibRuntime.prototype.loadClientModule = loadTestClientModule;
  }
} catch {
  // Ignore if lib is not built.
}
