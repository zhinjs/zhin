import { defineConfig } from 'tsup';
export default defineConfig(options => {
  return {
    ...options,
    outDir: 'lib',
  };
});
