/**
 * The 3D engine: a JSON spec in, geometry and a review sheet out.
 *
 * Reference: `re/full-reverse/08-3d-polyforge/REPORT.md` (engine A, the spec
 * path) and `re/full-reverse/15-3d-full-system/` for the export/Studio path.
 *
 * Only the pieces that exist so far are exported; `build`, `check`, `sheet`,
 * `prompt`, `export` and `studio` join them as they land.
 */
export {
  BUDGET_LIMITS,
  buildModel,
  buildSpec,
  countOpenEdges,
  dropDegenerate,
  facesOutward,
  fitBudget,
  flipWinding,
  type Model,
  type ModelGroup,
  type ModelHealth,
  type ModelPart,
  ModelRejected,
  modelBounds,
  modelTriangles,
  type RepairResult,
  repairGeometry,
  signedVolume
} from './build'
export {
  ACCESSORY_BOUNDS,
  ATTACHMENT_OFFSETS,
  type CategoryReport,
  checkModel,
  checkRigBounds,
  HEAVY_TRIANGLES,
  LARGE_SURFACE,
  MESH_TRIANGLE_LIMIT,
  NEAR_LIMIT_TRIANGLES,
  openShellIssues,
  oppositeSide,
  type PartGroup,
  partGroups,
  type RuleIssue,
  rigJoints,
  TEXTURE_LIMIT,
  TRIANGLE_LIMIT,
  textureDetailIssues,
  validateAccessory
} from './check'
export {
  EXPR_FUNCTION_NAMES,
  EXPR_FUNCTIONS,
  evaluate,
  numberOr,
  numbersOr,
  type ParamValues
} from './expr'
export {
  ACCESSORY_TYPES,
  BOOLEAN_OPS,
  CATEGORIES,
  CONTAINER_TYPES,
  checkRig,
  EXTRA_LIMITS,
  LIMITS,
  type ModelSpec,
  NODE_TYPES,
  normalizeSpec,
  type PaletteEntry,
  type ParamSpec,
  PRIMITIVE_TYPES,
  paramValues,
  R6_JOINTS,
  R15_JOINTS,
  RIG_JOINTS,
  RIGS,
  SHAPES,
  type ShapeSpec,
  type SkeletonEntry,
  type SpecNode,
  TEMPLATE_IDS,
  type TextureSpec,
  validateSpec
} from './schema'
export {
  disposeRenderer,
  renderReviewSheets,
  renderThumbnail,
  SHEET1_BACKDROP,
  SHEET1_QUALITY,
  SHEET1_VIEWS,
  SHEET2_BACKDROP,
  SHEET2_CLOSEUPS,
  SHEET2_QUALITY,
  SHEET2_WALK,
  sheetCount,
  sheetLayout,
  TILE
} from './sheet'
