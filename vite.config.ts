import {resolve} from 'node:path';
import {defineConfig} from 'vite';

const demoRoot = resolve(process.env.CRITREV_DEMO_ROOT ?? 'demo');
const reactRoot = process.env.CRITREV_REACT_ROOT;
const packageRoot = process.env.CRITREV_PACKAGE_ROOT;
export default defineConfig({
  root: demoRoot,
  cacheDir: process.env.CRITREV_VITE_CACHE ?? 'node_modules/.vite',
  // The isolated installed-package fixture has no workspace tsconfig to supply
  // this setting. Use the same JSX runtime in both validation modes.
  esbuild: {jsx: 'automatic'},
  server: {fs: {allow: [process.cwd(), demoRoot, ...(packageRoot ? [resolve(packageRoot, '../..')] : []), ...(reactRoot ? [reactRoot] : [])]}},
  optimizeDeps: {
    exclude: ['critrev/react', 'critrev/lexical'],
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
  },
  resolve: {dedupe: ['lexical'], alias: [
    ...(reactRoot ? [{find: /^react(?=\/|$)/, replacement: resolve(reactRoot, 'react')}, {find: /^react-dom(?=\/|$)/, replacement: resolve(reactRoot, 'react-dom')}] : []),
    {find: /^critrev\/react$/, replacement: packageRoot ? resolve(packageRoot, 'dist/react/index.js') : resolve('src/react/index.ts')},
    {find: /^critrev\/lexical$/, replacement: packageRoot ? resolve(packageRoot, 'dist/lexical/index.js') : resolve('src/lexical/index.ts')},
    {find: /^critrev$/, replacement: packageRoot ? resolve(packageRoot, 'dist/index.js') : resolve('src/index.ts')},
  ]},
  build: {
    rollupOptions: {
      input: process.env.CRITREV_DEMO_ROOT || packageRoot ? {images: resolve(demoRoot, 'images.html')} : {
        demo: resolve(demoRoot, 'index.html'), react: resolve(demoRoot, 'react.html'), images: resolve(demoRoot, 'images.html'),
      },
    },
  },
});
