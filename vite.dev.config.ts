import { resolve } from 'path';
import { defineConfig } from 'vite';

/**
 * Set to true to use the distributed files instead of the source files.
 */
const useModuleFromDist = false;

export default defineConfig({
  root: '.',
  base: "/lucky-luke-duel/",
  server: {
    open: true,
    port: 3000,
  },
  build: {
    target: "es2022",
	outDir: 'web',
    emptyOutDir: false,
  },
  esbuild: {
    target: "es2022"
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "es2022"
    }, 
  },
  resolve: {
	alias: {
	  "lucky-luke-duel/meshcap": resolve(__dirname, useModuleFromDist ? "./dist/meshcap.js" : "./src/meshcap/meshcap.ts"),
	  "lucky-luke-duel": resolve(__dirname, useModuleFromDist ? "./dist/rigger.js" : "./src/module.ts"),
	} 
  },
});