import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    target: 'es2020',
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'nexrad-l3-decoder',
    },
    outDir: 'dist/lib',
    emptyOutDir: true,
  },
});
