import type { ModuleGuide } from '../types.ts'

/** Interactive artifact guidance. */
export const interactive: ModuleGuide = {
  module: 'interactive',
  summary: 'Dashboards, explainers, and small apps. HTML with the script placed last, computing from data embedded in the document; '
    + 'a button may call sendPrompt(text) to ask the agent a follow-up, and window.storage (async get/set/delete, keys like table:record_id, '
    + 'get rejects on a missing key) keeps state across renders of the same conversation.',
}
