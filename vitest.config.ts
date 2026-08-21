import { defineConfig } from 'vitest/config'

// The specs carry their own `@vitest-environment jsdom` pragma; everything
// else stays on the node default. `@deepseek-ai/dsh-client-runtime/client`
// resolves through the vendored snapshot's package exports: types from
// lib/client/index.d.ts, the specs' assembler from the src TypeScript.
export default defineConfig({
  resolve: {
    alias: {},
  },
  ssr: {
    // Transform harness package deps through Vite so their CSS imports
    // (e.g. katex styles pulled in by ui-primitives) process instead of
    // failing Node's native importer.
    noExternal: [/@deepseek-ai\//],
  },
  test: {
    include: ['packages/*/tests/**/*.spec.{ts,tsx}'],
  },
})
