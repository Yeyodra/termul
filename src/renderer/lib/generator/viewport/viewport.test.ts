/**
 * The pure parts of the viewport: view directions and the artifact registry.
 *
 * The WebGL surface is not covered here — jsdom has no GPU context — so it is
 * verified in the app. What is tested is the decision about *what* is drawn,
 * which is where the bugs that matter live (a wrong direction frames the model
 * from underneath, an unknown kind must fail loudly rather than draw nothing).
 */

import { describe, expect, it } from 'vitest'
import { type Artifact, buildArtifactScene } from './artifact'
import { VIEW_DIRECTIONS } from './core'

/** A stand-in for decoding an atlas, so the test needs no real image bytes. */
const stubImage = async (): Promise<CanvasImageSource> => document.createElement('canvas')

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

describe('buildArtifactScene', () => {
  it('refuses an artifact kind it has no builder for', async () => {
    await expect(
      buildArtifactScene({ kind: 'unknown' } as unknown as Artifact, stubImage)
    ).rejects.toThrow(/no viewport builder/)
  })
})

describe('a garment scene', () => {
  it('wraps the avatar in one group and disposes it', async () => {
    const scene = await buildArtifactScene(
      { kind: 'clothing', type: 'shirt', atlas: ATLAS, name: 'Royal Robe' },
      stubImage
    )
    expect(scene.objects).toHaveLength(1)
    expect(scene.label).toBe('Royal Robe')
    expect(() => scene.dispose()).not.toThrow()
  })

  it('labels an unnamed garment by its type and body', async () => {
    const scene = await buildArtifactScene(
      { kind: 'clothing', type: 'pants', atlas: ATLAS },
      stubImage
    )
    expect(scene.label).toBe('pants on the avatar')
  })

  it('surfaces a failed decode instead of showing an empty body', async () => {
    await expect(
      buildArtifactScene({ kind: 'clothing', type: 'shirt', atlas: ATLAS }, async () => {
        throw new Error('the garment atlas did not decode')
      })
    ).rejects.toThrow(/did not decode/)
  })
})
