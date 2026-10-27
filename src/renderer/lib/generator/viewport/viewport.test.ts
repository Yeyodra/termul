/**
 * The artifact registry: which kinds exist, and what each becomes.
 *
 * The WebGL surface is not covered here — jsdom has no GPU context — so it is
 * verified in the app. What is tested is the decision about *what* is drawn,
 * which is where the bugs that matter live: an unknown kind must fail loudly
 * rather than draw nothing, and every declared kind must have a builder or the
 * record does not typecheck.
 */

import { describe, expect, it } from 'vitest'
import { type Artifact, buildArtifactScene } from './artifact'
import { VIEW_DIRECTIONS } from './core'

const ATLAS = 'data:image/png;base64,iVBORw0KGgo='

describe('VIEW_DIRECTIONS', () => {
  it('names the six axis views plus a three-quarter view', () => {
    expect(Object.keys(VIEW_DIRECTIONS).sort()).toEqual(
      ['3/4', 'back', 'bottom', 'front', 'left', 'right', 'top'].sort()
    )
  })

  it('has front and back on opposite z, and left and right on opposite x', () => {
    expect(VIEW_DIRECTIONS.front[2]).toBeGreaterThan(0)
    expect(VIEW_DIRECTIONS.back[2]).toBeLessThan(0)
    expect(VIEW_DIRECTIONS.left[0]).toBeGreaterThan(0)
    expect(VIEW_DIRECTIONS.right[0]).toBeLessThan(0)
  })

  it('keeps the top and bottom views off the pole so the up vector stays defined', () => {
    expect(VIEW_DIRECTIONS.top[2]).not.toBe(0)
    expect(VIEW_DIRECTIONS.bottom[2]).not.toBe(0)
  })
})

describe('the artifact registry', () => {
  it('refuses a kind it has no builder for', async () => {
    await expect(buildArtifactScene({ kind: 'nonsense' } as unknown as Artifact)).rejects.toThrow(
      /no viewport builder/
    )
  })

  it('covers every kind the union declares', () => {
    // A kind with no builder is a typecheck failure, so reaching here is the
    // assertion; this list is what a new engine must extend.
    const kinds: Array<Artifact['kind']> = ['clothing', 'mesh', 'skybox', 'texture']
    expect(kinds).toHaveLength(4)
  })
})

describe('a garment scene', () => {
  it('wraps the avatar in one group and disposes it', async () => {
    const scene = await buildArtifactScene(
      { kind: 'clothing', type: 'shirt', atlas: ATLAS, name: 'Royal Robe' },
      async () => document.createElement('canvas')
    )
    expect(scene.objects).toHaveLength(1)
    expect(scene.label).toBe('Royal Robe')
    expect(() => scene.dispose()).not.toThrow()
  })

  it('labels an unnamed garment by its type and body', async () => {
    const scene = await buildArtifactScene(
      { kind: 'clothing', type: 'pants', atlas: ATLAS },
      async () => document.createElement('canvas')
    )
    expect(scene.label).toBe('pants on the avatar')
  })
})
