import { resolve } from 'path';
import { exec } from 'child_process';
import { platform } from 'os';
import type { Connect } from 'vite';
import { defineConfig } from 'vite';

function addShutdownRoute(middlewares: { use: (path: string, handler: Connect.NextHandleFunction) => void }) {
  middlewares.use('/api/shutdown', (_req, res) => {
    res.end('ok');
    const cmd = platform() === 'win32' ? 'shutdown /s /t 0' : 'shutdown -h now';
    setTimeout(() => exec(cmd), 500);
  });
}

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
  plugins: [
    {
      name: 'shutdown-endpoint',
      configureServer(server) { addShutdownRoute(server.middlewares); },
      configurePreviewServer(server) { addShutdownRoute(server.middlewares); },
    },
  ],
  resolve: {
	alias: {
	  "lucky-luke-duel/meshcap": resolve(__dirname, useModuleFromDist ? "./dist/meshcap.js" : "./src/meshcap/meshcap.ts"),
	  "lucky-luke-duel": resolve(__dirname, useModuleFromDist ? "./dist/rigger.js" : "./src/module.ts"),
	} 
  },
});