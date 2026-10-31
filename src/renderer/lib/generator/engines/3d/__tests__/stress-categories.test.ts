import { describe, expect, it } from 'vitest'
import { validateSpec } from '../schema'
import type { Score } from './stress-score'
import { report, scoreSpec } from './stress-score'
import { CASES } from './stress-specs'

/**
 * Scores the engine on the most complex spec each category can carry.
 *
 * The specs are hand-written, not produced by a model, so a low score means the
 * engine could not build what was asked rather than that a model wrote a weak
 * spec. `target` in `stress-specs.ts` is what each spec should expand to, so
 * "complex" is measured instead of asserted.
 *
 * Baseline this exists to beat: a real prompt's `mythic-dragon-1-1`, at 8 parts,
 * 8 056 of 20 000 triangles, and 3.9 m for a 1:1 mythic dragon.
 */

const STUD_PER_METRE = 3.5714

const scores: Score[] = CASES.map((entry) =>
  scoreSpec(entry.name, entry.spec, entry.category, entry.target, entry.accessoryType)
)

describe('3D stress score', () => {
  it('reports a score per category', () => {
    const table = report(scores)
    console.log(`\n${table}\n`)
    expect(table).toContain('total ')
  })

  describe.each(CASES)('$name', ({ name, category, spec, target, accessoryType }) => {
    const score = scores.find((entry) => entry.name === name)!

    it('builds at all', () => {
      expect(score.measure?.rejected ?? null).toBeNull()
    })

    it('expands every array and mirror the spec asked for', () => {
      // The engine used to accept `array` on a primitive and build one part.
      // That is what turned this dragon into 720 triangles.
      expect(score.measure!.parts).toBeGreaterThanOrEqual(target.parts)
    })

    it('reaches the triangle target', () => {
      expect(score.measure!.triangles).toBeGreaterThanOrEqual(target.triangles)
    })

    it('reaches the size target', () => {
      const size = score.measure!.size
      size.forEach((value, axis) => {
        expect(value, `axis ${axis}`).toBeGreaterThanOrEqual(target.size[axis] * 0.9)
      })
    })

    it('has no error-level issue', () => {
      const errors = score.measure!.issues.filter((issue) => issue.startsWith('error'))
      expect(errors, errors.join('\n')).toEqual([])
    })

    it('exports a GLB', () => {
      expect(score.measure!.glb).toBeGreaterThan(0)
    })

    it('scores at least 85 out of 100', () => {
      expect(score.total, JSON.stringify(score.points)).toBeGreaterThanOrEqual(85)
    })

    it('declares the category it is scored as', () => {
      expect(spec.category).toBe(category)
      expect(accessoryType ? spec.accessoryType : undefined).toBe(accessoryType)
    })
  })

  it('scores 510 or better across all six categories', () => {
    const total = scores.reduce((sum, score) => sum + score.total, 0)
    expect(total).toBeGreaterThanOrEqual(510)
  })
})

describe('the dragon at 1:1', () => {
  const dragon = scores.find((entry) => entry.name === 'dragon')!
  const metres = (dragon.measure?.size[2] ?? 0) / STUD_PER_METRE

  it('is a 12 m creature, not a car', () => {
    // The baseline prompt produced 6.6 m for a "mythic dragon at 1:1".
    expect(metres).toBeGreaterThanOrEqual(11)
  })

  it('is longer than it is tall, like a serpent', () => {
    const [width, height, length] = dragon.measure!.size
    expect(length).toBeGreaterThan(height)
    expect(length).toBeGreaterThan(width)
  })

  it('beats the baseline that started this work', () => {
    expect(dragon.measure!.parts).toBeGreaterThan(8)
    expect(dragon.measure!.triangles).toBeGreaterThan(8056)
  })

  it('is one continuous body, not floating beads', () => {
    // The shipped dragon spaced 15 neck pieces 2.2 studs apart at 1.9 radius,
    // so the render showed beads where a neck should be. Every chain group is
    // marked, and the validator rejects a gap, so this asserts the spec it
    // builds from is the joined one.
    expect(validateSpec(CASES.find((entry) => entry.name === 'dragon')!.spec)).toEqual([])
    const chains = (CASES.find((entry) => entry.name === 'dragon')!.spec.parts as unknown[]).filter(
      (part) => (part as { chain?: boolean }).chain === true
    )
    expect(chains.length).toBeGreaterThanOrEqual(3)
  })

  it('scores far above the baseline prompt', () => {
    // The 8-box, 8056-triangle, 3.9 m dragon a real prompt produced. The score
    // has to separate that from a real 1:1 build, or it measures nothing.
    const baseline = {
      version: 1,
      name: 'mythic-dragon-1-1',
      category: 'prop',
      palette: { a: '#3f6b3a' },
      parts: Array.from({ length: 8 }, (_, index) => ({
        name: `P${index}`,
        type: 'box',
        color: 'a',
        size: [4.5, 4.5, 5.0],
        position: [0, 6 + (index % 2) * 2, -10 + index * 3.2]
      }))
    } as unknown as ModelSpec

    const before = scoreSpec('baseline', baseline, 'prop', {
      parts: 120,
      triangles: 18000,
      size: [17, 17, 42]
    })
    expect(before.total).toBeLessThan(40)
    expect(dragon.total).toBeGreaterThan(before.total + 50)
  })
})

describe('the apartment at 1:1', () => {
  const apartment = scores.find((entry) => entry.name === 'apartment')!
  const metres = apartment.measure!.size.map((value) => value / STUD_PER_METRE)

  it('is a real 10 x 8 x 3 m apartment', () => {
    expect(metres[0]).toBeGreaterThanOrEqual(9.5)
    expect(metres[2]).toBeGreaterThanOrEqual(7.5)
    expect(metres[1]).toBeGreaterThanOrEqual(2.8)
  })

  it('is furnished, not an empty box', () => {
    // 147 parts is what a shell plus furniture expands to; a shell alone is 8.
    expect(apartment.measure!.parts).toBeGreaterThan(100)
    expect(apartment.measure!.triangles).toBeGreaterThan(5000)
  })
})
