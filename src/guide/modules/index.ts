/**
 * The per-artifact-type roster of the visualizer guide. Add a file under
 * modules/, one row here, and a GuideModule literal in ../types.ts — no
 * other entry changes.
 * @module dsh-visualizer/guide/modules
 */
import type { ModuleGuide } from '../types.ts'
import { art } from './art.ts'
import { chart } from './chart.ts'
import { diagram } from './diagram.ts'
import { interactive } from './interactive.ts'
import { mockup } from './mockup.ts'

/** Roster of per-type guidance, in display order. */
export const MODULE_GUIDES: readonly ModuleGuide[] = [chart, diagram, mockup, interactive, art]
