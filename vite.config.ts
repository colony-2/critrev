import {resolve} from 'node:path';
import {defineConfig} from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {demo: resolve('demo/index.html'), react: resolve('demo/react.html')},
    },
  },
});
