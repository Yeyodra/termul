import { describe, expect, it } from 'vitest'
import { regionsFor } from '../../layout'
import { rectUvs, segmentRect } from '../avatar'
import { POSES, poseJoints, r6Name, rigParts } from '../rig'

describe('rig', () => {
  it('gives R15 fifteen bones and R6 six', () => {
    expect(rigParts('R15')).toHaveLength(15)
    expect(rigParts('R6')).toHaveLength(6)
  })

  it('orders bones parent before child, so a group tree can be built in one pass', () => {
    const seen = new Set<string>()
    for (const part of rigParts('R15')) {
      if (part.parent) expect(seen.has(part.parent)).toBe(true)
      seen.add(part.part)
    }
  })

  it('folds every R15 bone onto a real R6 bone', () => {
    for (const part of rigParts('R15')) {
      expect(r6Name('R6', part.part)).toMatch(/^(Torso|Head|LeftArm|RightArm|LeftLeg|RightLeg)$/)
    }
  })

  it('passes R15 names through untouched', () => {
    expect(r6Name('R15', 'UpperTorso')).toBe('UpperTorso')
  })

  it('folds a pose onto R6 and drops bones R6 does not have', () => {
    const folded = poseJoints('R6', POSES.heroic)

    expect(folded.Torso).toEqual([-4, 0, 0])
    expect(folded.Head).toEqual([-6, -12, 0])
    expect(folded.LeftLowerArm).toBeUndefined()
  })

  it('keeps every bone for an R15 pose', () => {
    const joints = poseJoints('R15', POSES.heroic)
    expect(joints.LeftLowerArm).toEqual([-20, 0, -70])
  })
})

describe('rectUvs', () => {
  it('flips the v axis, because the atlas is authored top-down', () => {
    const [u0, v1, , , , v0] = rectUvs({ x: 0, y: 0, w: 585, h: 559 })

    expect(u0).toBe(0)
    expect(v1).toBe(1)
    expect(v0).toBe(0)
  })

  it('maps a torso-front rect to the right quadrant of the sheet', () => {
    const front = regionsFor('shirt').find((region) => region.id === 'torso_front')
    if (!front) throw new Error('the atlas has no torso_front')

    const [u0, vTop, u1, , , vBottom] = rectUvs(front)

    expect(u0).toBeCloseTo(231 / 585, 6)
    expect(u1).toBeCloseTo(359 / 585, 6)
    expect(vTop).toBeCloseTo(1 - 74 / 559, 6)
    expect(vBottom).toBeCloseTo(1 - 202 / 559, 6)
  })
})

describe('segmentRect', () => {
  const regions = regionsFor('shirt')

  it('slices the front face into stacked bands that cover it once', () => {
    const top = segmentRect(regions, 'front', 0, 0.45)
    const mid = segmentRect(regions, 'front', 0.45, 0.85)
    const bottom = segmentRect(regions, 'front', 0.85, 1)
    if (!top || !mid || !bottom) throw new Error('a shirt front should slice into three')

    expect(top.h + mid.h + bottom.h).toBeGreaterThanOrEqual(126)
    expect(top.y).toBeLessThan(mid.y)
    expect(mid.y).toBeLessThan(bottom.y)
    expect(bottom.y + bottom.h).toBeLessThanOrEqual(202)
  })

  it('never returns a zero-height slice', () => {
    for (const face of ['front', 'back', 'left', 'right']) {
      const slice = segmentRect(regions, face, 0.98, 1)
      expect(slice?.h).toBeGreaterThanOrEqual(1)
    }
  })

  it('answers null for a face the garment does not have', () => {
    expect(segmentRect([], 'front', 0, 1)).toBeNull()
  })
})
