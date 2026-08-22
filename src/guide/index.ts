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

export type { GuideModule, ModuleGuide } from './types.ts'
export { MODULE_GUIDES } from './modules/index.ts'

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
