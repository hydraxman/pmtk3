import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./pages', import.meta.url)),
  base: './',
  publicDir: false,
  build: { outDir: fileURLToPath(new URL('./dist/pages', import.meta.url)), emptyOutDir: true },
});
