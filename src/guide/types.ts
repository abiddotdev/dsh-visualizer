/**
 * Types of the visualizer authoring guide: the per-artifact-type roster
 * entries the system-prompt section composes.
 * @module dsh-visualizer/guide/types
 */

/** Artifact types the guide roster covers; one file each under modules/. */
export type GuideModule = 'chart' | 'diagram' | 'mockup' | 'interactive' | 'art'

/**
 * One artifact type's roster entry. Each lives in its own module file so a
 * type's guidance is edited without touching any other's.
 */
export interface ModuleGuide {
  /** Roster name; matches one {@link GuideModule} literal. */
  readonly module: GuideModule
  /** One-line authoring guidance shown in the roster. */
  readonly summary: string
  /**
   * Detailed recipe the `visualizer_guide` tool returns for this type.
   * Follows the shared skeleton, in order: `### Mental model` (thinking
   * order before code), domain sections, `### Failure modes` (symptom
   * first, then cause and fix), `### Quick reference` (one-line
   * checklist). State measurements exactly and rules as never-conditions;
   * the recipe is pulled just-in-time, so depth costs nothing standing.
   */
  readonly detail: readonly string[]
}
