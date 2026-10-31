import { buildSpec } from '../build'
import { checkModel } from '../check'
import { toGlb } from '../export'
import type { ModelSpec } from '../schema'
import { validateSpec } from '../schema'

/** What one spec is expected to produce, so "complex" is measured, not asserted. */
export interface Target {
  /** Parts the spec should expand to once `array`/`mirror` are applied. */
  parts: number
  /** Triangles the spec should reach. */
  triangles: number
  /** Bounding box the spec should reach, in studs. */
  size: [number, number, number]
}

/**
 * `parts x triangles` a subject of this category should reach.
 *
 * A dragon and a pickaxe cannot be scored on the same raw numbers, so detail is
 * judged against what the subject is. Each budget is a quarter of what the
 * category's triangle limit could carry at its target part count, which keeps
 * the bar at "this is modelled" rather than "this is maximal".
 *
 * These are the numbers the prompt never states, and their absence is why a
 * "large, serpentine, 1:1 dragon" came back as 8 boxes.
 */
export const DENSITY_BUDGET: Record<string, number> = {
  prop: 480000,
  building: 720000,
  character: 100000,
  tool: 60000,
  accessory: 40000,
  text: 60000
}

export interface Measure {
  parts: number
  triangles: number
  size: number[]
  /** Errors and warnings `checkModel` reported, as `rule: message`. */
  issues: string[]
  /** Why the build threw, when it did. */
  rejected: string | null
  glb: number
}

export interface Score {
  name: string
  category: string
  measure: Measure | null
  points: { parts: number; triangles: number; size: number; detail: number; checks: number }
  total: number
}

const round = (value: number) => Math.round(value * 100) / 100

/** Ratio against a target, capped at 1. Over-target is not penalised. */
const ratio = (actual: number, target: number) => (target <= 0 ? 1 : Math.min(1, actual / target))

function measure(spec: ModelSpec, category: string, accessoryType?: string): Measure | null {
  try {
    const model = buildSpec(spec)
    const report = checkModel(model, { category, accessoryType })
    let glb = 0
    try {
      glb = toGlb(model, { name: spec.name }).length
    } catch {
      glb = 0
    }
    return {
      parts: model.parts.length,
      triangles: report.triangles,
      size: report.size,
      issues: report.issues.map((issue) => `${issue.level} ${issue.rule}: ${issue.message}`),
      rejected: null,
      glb
    }
  } catch (error) {
    return {
      parts: 0,
      triangles: 0,
      size: [0, 0, 0],
      issues: [],
      rejected: (error as Error).message,
      glb: 0
    }
  }
}

/**
 * Score one spec out of 100: 25 parts, 25 triangles, 20 size, 20 detail, 10 checks.
 *
 * The detail axis is `parts x triangles` against the category budget. It is what
 * makes the score discriminate instead of returning 100 for anything that merely
 * clears its own hand-written target: the `mythic-dragon-1-1` baseline scored
 * 8 x 8056 = 64 448 against a prop budget of 400 000, which is 16%.
 */
export function scoreSpec(
  name: string,
  spec: ModelSpec,
  category: string,
  target: Target,
  accessoryType?: string
): Score {
  const result = measure(spec, category, accessoryType)
  if (!result) {
    return {
      name,
      category,
      measure: null,
      points: { parts: 0, triangles: 0, size: 0, detail: 0, checks: 0 },
      total: 0
    }
  }

  const errors = result.issues.filter((issue) => issue.startsWith('error')).length
  const density = result.parts * result.triangles
  const budget = DENSITY_BUDGET[category] ?? 0
  const points = {
    parts: Math.round(25 * ratio(result.parts, target.parts)),
    triangles: Math.round(25 * ratio(result.triangles, target.triangles)),
    size: Math.round(
      (20 *
        (ratio(result.size[0], target.size[0]) +
          ratio(result.size[1], target.size[1]) +
          ratio(result.size[2], target.size[2]))) /
        3
    ),
    detail: Math.round(20 * ratio(density, budget)),
    checks: errors ? 0 : 10
  }

  return {
    name,
    category,
    measure: result,
    points,
    total: points.parts + points.triangles + points.size + points.detail + points.checks
  }
}

/** A fixed-width table so a run reads like a report, not a pile of assertions. */
export function report(scores: Score[]): string {
  const head = ['category', 'parts', 'tris', 'size (studs)', 'detail', 'score']
  const rows = scores.map((score) => {
    const m = score.measure
    const size = m ? m.size.map(round).join(' x ') : 'build failed'
    return [
      score.category,
      m ? `${m.parts}` : '-',
      m ? `${m.triangles}` : '-',
      size,
      `${score.points.detail}/20`,
      `${score.total}/100`
    ]
  })
  const width = head.map((_, index) =>
    Math.max(head[index].length, ...rows.map((row) => row[index].length))
  )
  const line = (cells: string[]) => cells.map((cell, index) => cell.padEnd(width[index])).join('  ')
  const total = scores.reduce((sum, score) => sum + score.total, 0)
  const failed = scores.filter((score) => score.measure?.rejected)
  const errors = scores.flatMap((score) =>
    (score.measure?.issues ?? []).filter((issue) => issue.startsWith('error'))
  )

  return [
    line(head),
    width.map((value) => '-'.repeat(value)).join('  '),
    ...rows.map(line),
    '',
    `total ${total}/${scores.length * 100}`,
    ...failed.map((score) => `rejected ${score.category}: ${score.measure?.rejected}`),
    ...errors.map((issue) => `error: ${issue}`)
  ].join('\n')
}

export { validateSpec }
