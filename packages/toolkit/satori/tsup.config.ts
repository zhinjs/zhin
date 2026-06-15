import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/jsx-runtime.ts', 'src/jsx-dev-runtime.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  target: 'node18',
  clean: true,
  outDir: 'lib',
});
