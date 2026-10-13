import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  build: {
    ssr: fileURLToPath(new URL("./src/main.ts", import.meta.url)),
    outDir: fileURLToPath(new URL("../../dist/server", import.meta.url)),
    emptyOutDir: true,
    target: "node22",
    rollupOptions: { output: { entryFileNames: "main.js" } },
  },
  ssr: { noExternal: ["@marksweep/core"] },
});
