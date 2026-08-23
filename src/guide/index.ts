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

/** The ambient just-in-time nudge closing the roster: the pull ordering
 * lives in the always-visible section, not only in the guide tool's own
 * description. Rendered only when the guide tool is registered, so a
 * guideTool:false deployment never advertises a tool it omits. */
const JIT_NUDGE = 'Before your first render of a type in a conversation, pull its recipe with visualizer_guide.'

/**
 * Compose the system-prompt section text.
 * @param modules - artifact types the roster lists; defaults to every module.
 * @param guideTool - whether the `visualizer_guide` tool is registered; when
 * false the closing nudge is omitted with it.
 * @returns the guide: gates, contract, and the module roster.
 */
export function composeGuideText(
  modules: readonly GuideModule[] = GUIDE_MODULE_IDS,
  guideTool = true,
): string {
  const enabled = new Set<GuideModule>(modules)
  return [
    '## When to render a visual',
    ...GATES,
    '',
    '## Authoring contract',
    ...CONTRACT,
    '',
    '## Artifact types',
    ...MODULE_GUIDES.filter(guide => enabled.has(guide.module)).map(guide => `- ${guide.module}: ${guide.summary}`),
    ...(guideTool ? [JIT_NUDGE] : []),
  ].join('\n')
}

/**
 * Compose the detailed per-type recipe the `visualizer_guide` tool returns.
 * @param modules - requested artifact types; duplicates collapse, output
 * follows roster order.
 * @param available - artifact types this deployment serves; defaults to
 * every module. A requested type outside the set counts as unknown.
 * @returns the requested modules' detail blocks.
 * @throws when a requested id is not in the enabled set.
 */
export function composeModuleDetail(
  modules: readonly string[],
  available: readonly GuideModule[] = GUIDE_MODULE_IDS,
): string {
  const enabled = new Set<GuideModule>(available)
  const requested = new Set(modules)
  const selected = MODULE_GUIDES.filter(guide => requested.has(guide.module) && enabled.has(guide.module))
  if (selected.length !== requested.size) {
    const rejected = [...requested].filter(id => !enabled.has(id as GuideModule))
    throw new Error(`unknown or disabled artifact type(s) ${rejected.join(', ')}; enabled types: ${available.join(', ')}`)
  }
  return selected
    .map(guide => [`## ${guide.module}`, ...guide.detail].join('\n'))
    .join('\n\n')
}
