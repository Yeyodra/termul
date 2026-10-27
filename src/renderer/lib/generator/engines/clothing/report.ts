/**
 * The per-layer inventory shown to the model during review.
 *
 * Ported 1:1 from RobloxKit's clothing review layout builder
 * (`clothing-62l72JIa.js`, `function x`). It matters more than it looks: the
 * review image tells the model what the garment *looks* like, and this tells it
 * what it *built* and what is missing. Without it a repair round is guesswork.
 *
 * The leading newline is upstream's, and the review message concatenates this
 * straight after `facts`, so dropping it changes the prompt.
 */

import type { DesignIssue } from './check'
import type { ClothingDesign } from './schema'

/** The colour fields, printed in this fixed order and joined with `/`. */
const COLOR_FIELDS = ['color', 'color2', 'color3', 'from', 'to'] as const

const DEFAULT_XY = 0.5

function describeLayer(layer: Record<string, unknown>): string {
  const parts: string[] = [String(layer.kind), `on ${layer.target ?? 'all'}`]

  if (layer.text) parts.push(`"${layer.text}"`)
  if (layer.shape) parts.push(String(layer.shape))

  const colors = COLOR_FIELDS.map((field) => layer[field]).filter(Boolean)
  if (colors.length) parts.push(colors.join('/'))

  if (layer.x != null || layer.y != null) {
    parts.push(`at ${layer.x ?? DEFAULT_XY},${layer.y ?? DEFAULT_XY}`)
  }

  return parts.join(' ')
}

/**
 * Render the layer inventory, bottom to top, plus what is missing.
 *
 * `empty` comes from `checkDesign`; when it is empty the tail says every region
 * is painted, which is a stronger statement than staying silent.
 */
export function layerLayout(design: ClothingDesign, check: { empty?: string[] }): string {
  const layers = (design.layers ?? []) as unknown as Array<Record<string, unknown>>
  const listing = layers.map((layer, index) => `${index}. ${describeLayer(layer)}`).join('\n')

  const tail = check.empty?.length
    ? `\nEmpty regions (skin shows): ${check.empty.join(', ')}`
    : '\nEvery region is painted.'

  return `\nLayers (bottom to top):\n${listing}${tail}`
}

/** The `facts` line the review message carries. */
export function checkFacts(issues: DesignIssue[]): string {
  if (!issues.length) return 'It passes the checks.'
  return `\nChecks:\n- ${issues.map((issue) => `${issue.level}: ${issue.message}`).join('\n- ')}`
}
