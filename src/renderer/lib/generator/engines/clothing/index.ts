/**
 * The clothing engine: design JSON in, validated render plus a review
 * description out.
 *
 * Reference: `re/full-reverse/02-clothing/REPORT.md`.
 */
export { buildClothing, type ClothingBuildOptions, DesignRejected } from './build'
export {
  type Region,
  regionsFor,
  resolveTarget,
  SHEET_DIMENSIONS,
  SHEET_SIZE
} from './layout'
export { lerpColor, mulberry32, parseColor, patternField, valueNoise } from './pattern'
export { CLOTHING_SYSTEM_PROMPT } from './prompt'
export {
  coverage,
  distinctColors,
  type RenderedSheet,
  regionSummary,
  renderPixels,
  sheetSize
} from './render'
export {
  type ClothingDesign,
  type ClothingLayer,
  DESIGN_TYPES,
  type DesignType,
  EDGES,
  FONTS,
  LAYER_KINDS,
  LIMITS,
  normalizeDesign,
  regionIds,
  SHAPES,
  targetResolves,
  validateDesign
} from './schema'
