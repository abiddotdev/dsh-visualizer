/**
 * The visualizer authoring guide: gate rules, the universal contract, and
 * the per-type roster, composed into the plugin's system-prompt section.
 * Each block owns its own file, so one artifact type's guidance changes
 * without touching any other.
 * @module dsh-visualizer/guide
 */
import { CONTRACT } from './contract.ts'
import { GATES } from './gates.ts'
import { MODULE_GUIDES } from './modules/index.ts'
import type { GuideModule, ModuleGuide } from './types.ts'

export type { GuideModule, ModuleGuide } from './types.ts'
export { MODULE_GUIDES } from './modules/index.ts'

/** Module ids in roster order; the tool schema's enum and the canonical
 * ordering of a detail request's output. */
export const GUIDE_MODULE_IDS: readonly GuideModule[] = MODULE_GUIDES.map(guide => guide.module)

/**
 * Compose the system-prompt section text.
 * @returns the guide: gates, contract, and the module roster.
 */
export function composeGuideText(): string {
  return [
    '## When to render a visual',
    ...GATES,
    '',
    '## Authoring contract',
    ...CONTRACT,
    '',
    '## Artifact types',
    ...MODULE_GUIDES.map(guide => `- ${guide.module}: ${guide.summary}`),
  ].join('\n')
}

/**
 * Compose the detailed per-type recipe the `visualizer_guide` tool returns.
 * @param modules - requested artifact types; duplicates collapse, output
 * follows roster order.
 * @returns the requested modules' detail blocks.
 * @throws when a requested id is not in the roster.
 */
export function composeModuleDetail(modules: readonly string[]): string {
  const requested = new Set(modules)
  const selected = MODULE_GUIDES.filter(guide => requested.has(guide.module))
  if (selected.length !== requested.size) {
    const known = GUIDE_MODULE_IDS.join(', ')
    const unknown = [...requested].filter(id => !GUIDE_MODULE_IDS.includes(id as GuideModule))
    throw new Error(`unknown artifact type(s) ${unknown.join(', ')}; known types: ${known}`)
  }
  return selected
    .map(guide => [`## ${guide.module}`, ...guide.detail].join('\n'))
    .join('\n\n')
}
