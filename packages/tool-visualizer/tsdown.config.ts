import { defineConfig } from 'tsdown'

// Node-half loader entry: the host Loader imports lib/index.js, and the
// package-invariants contract expects lib/invariant.js beside it.
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/invariant.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
