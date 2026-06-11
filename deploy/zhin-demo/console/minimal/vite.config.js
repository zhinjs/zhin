import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    root: ".",
    build: { outDir: "dist", emptyOutDir: true },
    define: {
      "import.meta.env.VITE_API_BASE": JSON.stringify(env.VITE_API_BASE ?? ""),
      "import.meta.env.VITE_API_TOKEN": JSON.stringify(env.VITE_API_TOKEN ?? ""),
    },
  };
});
