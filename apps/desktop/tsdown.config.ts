import { defineConfig } from 'tsdown'

/** Bundle the Electron main (ESM) and sandboxed preload (CJS) processes. */
export default defineConfig([
  {
    entry: {
      index: 'src/main/index.ts',
      'plugin-cli': 'src/main/plugin-cli.ts',
    },
    outDir: 'dist/main',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: true,
    external: ['electron'],
  },
  {
    entry: { index: 'src/preload/index.ts' },
    outDir: 'dist/preload',
    format: ['cjs'],
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: true,
    external: ['electron'],
  },
])
