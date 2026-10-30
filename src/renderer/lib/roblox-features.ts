/**
 * The generators a Roblox surface can show.
 *
 * Only clothing has an engine in this build; the rest are listed as `soon` so the
 * panel reads as a roadmap instead of a broken UI (D8). The picked feature is a
 * URL segment, so a page is bookmarkable and survives a refresh (D6).
 *
 * The Side panel and the page both resolve the feature from the same path, so
 * they cannot disagree about which one is open.
 */

export const ROBLOX_FEATURES = [
  { id: 'clothing', label: 'Clothing', ready: true },
  { id: '3d', label: '3D Generator', ready: false },
  { id: 'vfx', label: 'VFX', ready: false },
  { id: 'gfx', label: 'GFX', ready: false },
  { id: 'icon', label: 'Icon', ready: false },
  { id: 'sfx', label: 'SFX', ready: false },
  { id: 'animation', label: 'Animation', ready: false }
] as const

export type RobloxFeature = (typeof ROBLOX_FEATURES)[number]['id']

/** The feature `/roblox` alone opens. */
export const DEFAULT_ROBLOX_FEATURE: RobloxFeature = 'clothing'

export function isRobloxFeature(value: unknown): value is RobloxFeature {
  return typeof value === 'string' && ROBLOX_FEATURES.some((feature) => feature.id === value)
}

/**
 * The feature a `/roblox/<feature>` path names. Anything else — `/roblox`,
 * a trailing slash, an unknown segment, a query string — falls back to clothing
 * rather than rendering nothing.
 */
export function featureFromPath(pathname: string): RobloxFeature {
  const match = /^\/roblox\/?([^/?#]*)/.exec(pathname)
  const segment = match?.[1]
  return isRobloxFeature(segment) ? segment : DEFAULT_ROBLOX_FEATURE
}

export function featurePath(feature: RobloxFeature): string {
  return `/roblox/${feature}`
}

export function featureLabel(feature: RobloxFeature): string {
  return ROBLOX_FEATURES.find((entry) => entry.id === feature)?.label ?? feature
}

/**
 * How a garment kind is written in the UI.
 *
 * `record.kind` is the raw `item.json` value (`shirt`, `pants`, `tshirt`), so it
 * would otherwise show lower case in a row subtitle. RobloxKit maps the same
 * three kinds through a label table and shows `Shirt` / `Pants` / `T-Shirt`.
 */
const KIND_LABELS: Record<string, string> = {
  shirt: 'Shirt',
  pants: 'Pants',
  tshirt: 'T-Shirt'
}

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind
}
