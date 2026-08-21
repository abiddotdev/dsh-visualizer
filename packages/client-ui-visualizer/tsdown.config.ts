/**
 * Self-contained build for the visualizer browser half. Reproduces the
 * DeepSeek Harness client-bundle artifact: a closure-factory CJS bundle that
 * calls window.__ModuleLoader__.load({id, factory}) and resolves externals
 * through the loader's injected require (the frozen module table). CSS
 * Modules compile through lightningcss into hashed class maps whose css text
 * auto-injects a <style data-plugin> tag at factory execution.
 *
 * The node half (lib/index.js, lib/invariant.js) is emitted first from
 * lib/types, then the browser bundle lands beside it as lib/client.js.
 */
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve as resolvePath, sep } from 'node:path'
import type { UserConfig, Plugin } from 'tsdown'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'

/** Package name stamped into the __ModuleLoader__.load handoff and style tags. */
const PLUGIN_ID = 'dsh-client-ui-visualizer'

/** Module specifiers the web shell seeds into the frozen module table. */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
] as const

/**
 * Documented temporary exemption: the snapshot-store engine still lives in
 * client-runtime; the lazy CJS table answers this require natively because
 * runtime is an immediately-tier row.
 */
const RUNTIME_STORE_EXEMPTION = '@deepseek-ai/dsh-client-runtime/client'

/** Externals resolved from the loader module table. */
const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES, RUNTIME_STORE_EXEMPTION]

/**
 * Wire/type layers a client bundle may inline: browser-safe contracts with no
 * runtime identity to share. Everything else under @deepseek-ai/* is either a
 * module-table entry (external) or a leak the purity gate rejects.
 */
const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|session|llm|tools|brand)(\/|$)/

/** Vendored framework libraries rescoped into @deepseek-ai: ordinary libraries, no shared identity. */
const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/

/** Generated descriptor/codec contribution with no shared runtime identity. */
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/

/** Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline. */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Resolve an emitted JS asset import against its source-tree counterpart. */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  const marker = `${sep}lib${sep}types${sep}`
  const boundary = emitted.indexOf(marker)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + marker.length))
}

/** Build-time mirror of the module-edge rules; a require the table cannot answer must inline. */
const purityGate: Plugin = {
  name: 'dsh-client-bundle-purity',
  resolveId(source: string) {
    if (!source.startsWith('@deepseek-ai/')) return null
    if (CLIENT_EXTERNALS.includes(source)) return null
    if (VENDORED_LIBRARY.test(source)) return null
    if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null
    throw new Error(
      `client bundle purity: "${source}" is not a platform module, an inline-safe wire layer, or a generated /remote contribution — `
      + 'cross-plugin value imports are forbidden; collaborate through cordis services',
    )
  },
}

/** Compile *.module.css into hashed class maps with self-injecting style tags. */
const cssModulesInline: Plugin = {
  name: 'dsh-css-modules-inline',
  resolveId(source: string, importer: string | undefined) {
    if (!source.endsWith('.module.css')) return null
    const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
    return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
  },
  async load(virtualId: string) {
    if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
    const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
    this.addWatchFile(fileId)
    const source = await readFile(fileId)
    const { code, exports: cssExports } = transform({
      filename: fileId,
      code: source,
      cssModules: { pattern: '[hash]_[local]' },
      minify: true,
    })
    const classMap: Record<string, string> = {}
    for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
    const tagId = `${PLUGIN_ID}/${basename(fileId)}`
    return [
      `const css = ${JSON.stringify(code.toString())};`,
      `const tagId = ${JSON.stringify(tagId)};`,
      'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
      '  const tag = document.createElement(\'style\');',
      `  tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};`,
      '  tag.dataset.pluginCss = tagId;',
      '  tag.textContent = css;',
      '  document.head.appendChild(tag);',
      '}',
      `export default ${JSON.stringify(classMap)};`,
    ].join('\n')
  },
}

/** Node-half loader entries bundled from tsc output in lib/types. */
const lib: UserConfig = {
  name: PLUGIN_ID,
  entry: ['lib/types/index.js', 'lib/types/invariant.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

/** Browser closure-factory artifact pinned to exactly lib/client.js. */
const client: UserConfig = {
  name: `${PLUGIN_ID}/client`,
  entry: { client: 'lib/types/client/index.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  // The webserver serves the factory at /plugins/<package>/client.js; the
  // closure-factory text is fetched by the browser loader, so the CJS content
  // under a .js name is intentional.
  outExtensions: () => ({ js: '.js' }),
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  plugins: [purityGate, cssModulesInline],
  // The factory's `exports` declarations ride the banner, not tsdown's
  // `intro` option: tsdown >= 0.22.3 silently drops `intro` (a Rollup-era
  // option), which emitted a factory body referencing a never-declared
  // `exports` and the browser loader failed with "exports is not defined".
  banner: 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(PLUGIN_ID)
    + ', factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
  footer: 'return module.exports; } });',
}

export default defineConfig([lib, client])
