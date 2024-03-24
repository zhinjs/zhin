import { defineConfig } from 'tsup';
export default defineConfig(options => {
  return {
    ...options,
    clean: true,
    // minify: true,
    format: ['esm', 'cjs'],
    entry: ['src'],
    outExtension({ format }) {
      return {
        js: `.${format === 'esm' ? 'm' : 'c'}js`,
      };
    },
    outDir: 'lib',
  };
});
