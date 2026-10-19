import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const src = resolve(import.meta.dirname, 'src');
const outDir = resolve(import.meta.dirname, 'dist');

export default defineConfig(({ mode }) => ({
  root: src,
  publicDir: resolve(import.meta.dirname, 'public'),
  base: '',
  build: {
    outDir,
    emptyOutDir: true,
    target: 'chrome120',
    modulePreload: false,
    rollupOptions: {
      input: {
        background: resolve(src, 'background/index.ts'),
        sidepanel: resolve(src, 'sidepanel/index.html'),
        launcher: resolve(src, 'launcher/index.html'),
        options: resolve(src, 'options/index.html'),
        offscreen: resolve(src, 'offscreen/index.html'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
  plugins: [
    mode === 'development' && {
      name: 'dev-build-stamp',
      writeBundle() {
        writeFileSync(resolve(outDir, 'dev-build.txt'), String(Date.now()));
      },
    },
  ],
  test: {
    root: import.meta.dirname,
    include: ['tests/**/*.test.ts'],
  },
}));
