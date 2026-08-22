/**
 * Gate rules: whether a visual belongs in the conversation at all, and what
 * carries it when it does.
 * @module dsh-visualizer/guide/gates
 */

/** Gate lines of the guide; the section's first block. */
export const GATES: readonly string[] = [
  'Never write HTML or SVG as prose or in a code block; the chat shows it as text, and only a visualizer call renders it.',
  'Call visualizer for visuals that live in the conversation: charts, diagrams, mockups, and interactive artifacts.',
  'Use write plus show_html instead when the document must persist as a workspace file or travel outside the conversation.',
  'When plain prose or a table answers as well, answer in prose; produce no visual nobody asked for.',
]
